import { request } from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { publicIp, publicLookup, publicResourceUrl } from './blossom';
import ipaddr from 'ipaddr.js';
import { openAudioInNode } from './audio-stream-node';

export const AUDIO_MAX_BYTES = 128 * 1024 ** 2;
export const AUDIO_MAX_MS = 2 * 60 * 60 * 1000;
export type AudioStream = { mime: string; body: ReadableStream<Uint8Array> };

export function audioUrl(input: string) {
  const url = publicResourceUrl(input);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(host) && !publicIp(host)) throw new Error('source blocked');
  return url;
}

/** Only directly decodable audio, never playlists, HTML or arbitrary upstream MIME. */
export function audioMime(bytes: Uint8Array) {
  const ascii = new TextDecoder().decode(bytes.slice(0, 16));
  if (
    ascii.startsWith('ID3') ||
    (bytes[0] === 255 &&
      (bytes[1] & 224) === 224 &&
      (bytes[1] & 24) !== 8 &&
      (bytes[1] & 6) !== 0 &&
      (bytes[2] & 240) !== 240)
  )
    return 'audio/mpeg';
  if (ascii.startsWith('OggS')) return 'audio/ogg';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') return 'audio/wav';
  throw new Error('unsupported audio format');
}

export function openAudioStream(url: URL, signal: AbortSignal): Promise<AudioStream> {
  // The VPS's baseline Bun has the same guarded-lookup TLS bug as resource downloads.
  return typeof Bun !== 'undefined' && Bun.version === '1.3.8'
    ? openAudioInNode(url, signal)
    : typeof Bun !== 'undefined'
      ? openAudioStreamBun(url, signal)
      : openAudioStreamNative(url, signal);
}

function resolveAudioAddress(url: URL) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(hostname)) return Promise.resolve(hostname);
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('audio DNS timed out')), 5000);
    publicLookup(hostname, {}, (error, address) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(address as string);
    });
  });
}

/** Bun's Node HTTPS adapter stalls live bodies. Native fetch streams to a validated
 * IP literal, preserving Host/SNI and verifying the original certificate hostname. */
export async function openAudioStreamBun(
  url: URL,
  signal: AbortSignal,
  redirects = 0,
  dependencies = { resolve: resolveAudioAddress, fetch: globalThis.fetch },
): Promise<AudioStream> {
  audioUrl(url.href);
  const lifetime = new AbortController();
  const connection = setTimeout(() => lifetime.abort(), 15000);
  const deadline = setTimeout(() => lifetime.abort(), AUDIO_MAX_MS);
  const close = () => {
    clearTimeout(connection);
    clearTimeout(deadline);
    lifetime.abort();
  };
  const combined = AbortSignal.any([signal, lifetime.signal]);
  try {
    const address = await dependencies.resolve(url);
    // Validate the actual destination again even if a future resolver changes.
    if (!publicIp(address)) throw new Error('source blocked');
    const target = new URL(url);
    target.hostname = address.includes(':') ? `[${address}]` : address;
    const response = await dependencies.fetch(target, {
      signal: combined,
      redirect: 'manual',
      credentials: 'omit',
      keepalive: false,
      decompress: false,
      headers: {
        Host: url.host,
        Accept: 'audio/*',
        'Accept-Encoding': 'identity',
        'User-Agent': 'napplet-soy-audio/1',
      },
      tls: {
        serverName: url.hostname,
        rejectUnauthorized: true,
        checkServerIdentity: (
          _hostname: string,
          certificate: Parameters<typeof checkServerIdentity>[1],
        ) => checkServerIdentity(url.hostname, certificate),
      },
    });
    clearTimeout(connection);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      close();
      const location = response.headers.get('Location');
      if (!location || redirects >= 3) throw new Error('audio redirect refused');
      return openAudioStreamBun(
        audioUrl(new URL(location, url).href),
        signal,
        redirects + 1,
        dependencies,
      );
    }
    if (
      response.status !== 200 ||
      !response.body ||
      Number(response.headers.get('Content-Length')) > AUDIO_MAX_BYTES ||
      (response.headers.has('Content-Encoding') &&
        response.headers.get('Content-Encoding') !== 'identity')
    ) {
      await response.body?.cancel();
      throw new Error('audio response refused');
    }
    const reader = response.body.getReader();
    return await sniffAudio(
      {
        read: async () => {
          const idle = setTimeout(() => lifetime.abort(), 30000);
          try {
            return await reader.read();
          } finally {
            clearTimeout(idle);
          }
        },
        cancel: async () => {
          close();
          await reader.cancel();
        },
      },
      signal,
      close,
    );
  } catch (error) {
    close();
    throw error;
  }
}

/** Streaming, DNS-bound HTTPS transport. The prefix is sniffed before any bytes escape. */
export async function openAudioStreamNative(
  url: URL,
  signal: AbortSignal,
  redirects = 0,
): Promise<AudioStream> {
  audioUrl(url.href);
  const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const req = request(
      url,
      {
        signal,
        lookup: publicLookup,
        rejectUnauthorized: true,
        agent: false,
        headers: {
          Accept: 'audio/*',
          'Accept-Encoding': 'identity',
          'User-Agent': 'napplet-soy-audio/1',
        },
      },
      resolve,
    );
    req.setTimeout(15000, () => req.destroy(new Error('audio connection timed out')));
    req.on('error', reject);
    req.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
    response.destroy();
    if (redirects >= 3 || !response.headers.location) throw new Error('audio redirect refused');
    return openAudioStreamNative(
      audioUrl(new URL(response.headers.location, url).href),
      signal,
      redirects + 1,
    );
  }
  if (
    response.statusCode !== 200 ||
    Number(response.headers['content-length']) > AUDIO_MAX_BYTES ||
    (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')
  ) {
    response.destroy();
    throw new Error('audio response refused');
  }
  const timer = setTimeout(
    () => response.destroy(new Error('audio session limit reached')),
    AUDIO_MAX_MS,
  );
  response.setTimeout(30000, () => response.destroy(new Error('audio stream timed out')));
  response.once('close', () => clearTimeout(timer));
  // This path runs in Node (including the legacy VPS worker), not Bun's HTTPS adapter.
  const iterator = response[Symbol.asyncIterator]();
  const reader = {
    read: () => iterator.next() as Promise<IteratorResult<Uint8Array>>,
    cancel: async () => {
      response.destroy();
      await iterator.return?.();
    },
  };
  return sniffAudio(reader, signal, () => response.destroy());
}

async function sniffAudio(
  reader: {
    read: () => Promise<{ done?: boolean; value?: Uint8Array }>;
    cancel: () => Promise<unknown>;
  },
  signal: AbortSignal,
  close: () => void,
): Promise<AudioStream> {
  let prefix = new Uint8Array(0);
  try {
    while (prefix.length < 16) {
      const next = await reader.read();
      if (next.done || !next.value) throw new Error('empty audio stream');
      const merged = new Uint8Array(prefix.length + next.value.length);
      merged.set(prefix);
      merged.set(next.value, prefix.length);
      prefix = merged;
    }
    const mime = audioMime(prefix);
    let size = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = prefix.length ? { value: prefix, done: false } : await reader.read();
          prefix = new Uint8Array(0);
          if (next.done) {
            close();
            controller.close();
            return;
          }
          size += next.value!.length;
          if (size > AUDIO_MAX_BYTES) throw new Error('audio byte limit reached');
          controller.enqueue(next.value!);
        } catch (error) {
          close();
          await reader.cancel().catch(() => {});
          if (signal.aborted) controller.close();
          else controller.error(error);
        }
      },
      cancel: async () => {
        close();
        await reader.cancel().catch(() => {});
      },
    });
    return { mime, body };
  } catch (error) {
    close();
    await reader.cancel().catch(() => {});
    throw error;
  }
}
