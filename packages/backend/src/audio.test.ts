import { expect, test } from 'bun:test';
import { createAudioResponder } from './audio-response';
import { audioMime, audioUrl, openAudioStreamNative, openAudioStreamBun } from './audio-stream';
import type { publicLookup } from './blossom';

const origin = 'http://localhost:12345',
  manifest = 'a'.repeat(64);
const hostHeaders = { Origin: origin, 'X-Space-Host': '1', 'Content-Type': 'application/json' };
const lookup: typeof publicLookup = (_host, _opts, callback) => callback(null, '93.184.215.14', 4);
const prepare = (url = 'https://radio.example/live.mp3', headers = hostHeaders) =>
  new Request(`${origin}/api/media`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ manifest, url }),
  });
test('audio source policy rejects local networks and sniffs bytes independently of MIME hints', async () => {
  for (const url of [
    'http://example.org/a',
    'https://127.0.0.1/a',
    'https://[::1]/a',
    'https://10.0.0.1/a',
    'https://example.org:8080/a',
    'https://user:pass@example.org/a',
  ])
    expect(() => audioUrl(url)).toThrow();
  await expect(
    openAudioStreamNative(new URL('https://127.0.0.1'), new AbortController().signal),
  ).rejects.toThrow();
  expect(audioMime(new TextEncoder().encode('ID3\0\0\0\0\0'))).toBe('audio/mpeg');
  expect(audioMime(new TextEncoder().encode('RIFF1234WAVEfmt '))).toBe('audio/wav');
  for (const input of ['<html>fake audio</html>', '#EXTM3U', '<svg />'])
    expect(() => audioMime(new TextEncoder().encode(input))).toThrow();
});
test('stream tickets require host admission and stream before EOF; cancellation frees the upstream', async () => {
  let allowed = true,
    cancelled = false,
    opened = 0;
  const respond = createAudioResponder(
    async (id) => allowed && id === manifest,
    async (_url, signal) => {
      opened++;
      signal.addEventListener('abort', () => {
        cancelled = true;
      });
      return {
        mime: 'audio/mpeg',
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('ID3 audio prefix'));
          },
          cancel() {
            cancelled = true;
          },
        }),
      };
    },
    lookup,
  );
  expect((await respond(prepare(undefined, { ...hostHeaders, Origin: 'null' }))).status).toBe(403);
  const { url } = await (await respond(prepare())).json();
  expect(opened).toBe(0);
  expect((await respond(new Request(origin + url))).status).toBe(403);
  const get = () =>
    respond(
      new Request(origin + url, {
        headers: { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Dest': 'audio' },
      }),
    );
  const response = await get();
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('ID3 audio prefix');
  await reader.cancel();
  expect(cancelled).toBe(true);
  allowed = false;
  expect((await get()).status).toBe(404);
  allowed = true;
  expect(
    (await respond(new Request(origin + url, { method: 'DELETE', headers: hostHeaders }))).status,
  ).toBe(204);
  expect((await get()).status).toBe(404);
});
test('DNS policy failure creates no ticket and excessive retained tickets are bounded', async () => {
  const denied: typeof lookup = (_h, _o, cb) => cb(new Error('Private network destination'), '', 4);
  expect((await createAudioResponder(async () => true, undefined, denied)(prepare())).status).toBe(
    403,
  );
  const respond = createAudioResponder(async () => true, undefined, lookup);
  for (let i = 0; i < 8; i++) expect((await respond(prepare())).status).toBe(200);
  expect((await respond(prepare())).status).toBe(429);
});

test('Bun streaming pins the destination and TLS name, delivers later chunks and rejects unsafe redirects', async () => {
  let requested: URL | undefined,
    options: any,
    cancelled = false,
    chunk = 0;
  const fetcher = (async (url: URL, init: unknown) => {
    requested = url;
    options = init;
    return new Response(
      new ReadableStream<Uint8Array>({
        async pull(controller) {
          await Bun.sleep(2);
          const bytes = new Uint8Array(4096);
          if (!chunk++) bytes.set(new TextEncoder().encode('ID3'));
          controller.enqueue(bytes);
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
  }) as unknown as typeof fetch;
  const result = await openAudioStreamBun(
    new URL('https://radio.example/live'),
    new AbortController().signal,
    0,
    {
      resolve: async () => '93.184.215.14',
      fetch: fetcher,
    },
  );
  expect(requested!.hostname).toBe('93.184.215.14');
  expect(options.headers.Host).toBe('radio.example');
  expect(options.tls.serverName).toBe('radio.example');
  expect(options.tls.rejectUnauthorized).toBe(true);
  expect(
    options.tls.checkServerIdentity('93.184.215.14', {
      subjectaltname: 'DNS:radio.example',
      subject: {},
    }),
  ).toBeUndefined();
  expect(
    options.tls.checkServerIdentity('93.184.215.14', {
      subjectaltname: 'DNS:elsewhere.example',
      subject: {},
    }),
  ).toBeInstanceOf(Error);
  const reader = result.body.getReader();
  for (let i = 0; i < 3; i++) expect((await reader.read()).value?.length).toBe(4096);
  await reader.cancel();
  expect(cancelled).toBe(true);
  expect(options.signal.aborted).toBe(true);
  let fetches = 0;
  await expect(
    openAudioStreamBun(new URL('https://radio.example/live'), new AbortController().signal, 0, {
      resolve: async () => '93.184.215.14',
      fetch: (async () => {
        fetches++;
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://127.0.0.1/private' },
        });
      }) as unknown as typeof fetch,
    }),
  ).rejects.toThrow('source blocked');
  expect(fetches).toBe(1);
  await expect(
    openAudioStreamBun(new URL('https://radio.example/live'), new AbortController().signal, 0, {
      resolve: async () => '127.0.0.1',
      fetch: fetcher,
    }),
  ).rejects.toThrow('source blocked');
});
