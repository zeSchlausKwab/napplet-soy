import { z } from 'zod';
import { HOST_REQUESTS, RUNTIME_DOMAINS } from './capabilities';
import { scopedStorage } from './storage';
import { NappletFiles, type ExportFile } from './filesystem';
import { PlaybackNostr } from '../../nostr/src/playback';
import { WorkQueue } from './work-queue';

export type HostPrompt = {
  kind: 'link' | 'save';
  value: string;
  answer: (accepted: boolean) => void;
};
export type HostOptions = {
  frame: HTMLIFrameElement;
  identity: string;
  manifestId: string;
  relays: string[];
  pubkey: string | null;
  prompt: (prompt: HostPrompt | null) => void;
  files: (files: ExportFile[]) => void;
};
const envelope = z
  .object({
    type: z
      .string()
      .regex(/^[a-z]+\.[A-Za-z]+$/)
      .max(80),
    id: z.string().max(128).optional(),
  })
  .passthrough();

/** A single frame session. Caller supplies verified identity; messages cannot change it. */
export function attachNappletHost(options: HostOptions) {
  const source = options.frame.contentWindow;
  let alive = true,
    initialized = false,
    calls = 0,
    windowStart = Date.now();
  // Frame budgets and concurrency survive account changes.
  const resourceQueue = new WorkQueue(4, 16);
  let resourceCalls = 0,
    resourceBytes = 0;
  const send = (message: Record<string, unknown>) => {
    if (alive) source?.postMessage(message, '*');
  };
  // The iframe/handshake outlive account scopes. Each request captures its scope;
  // retiring it settles promises and prevents delayed results reaching a new user.
  const createAccount = (pubkey: string | null) => {
    let active = true;
    const requests = new Set<(error: Error) => void>();
    const sendScoped = (message: Record<string, unknown>) => {
      if (active) send(message);
    };
    let answer: ((accepted: boolean) => void) | undefined;
    const lifetime = new AbortController();
    const resources = new Map<string, AbortController>();
    const nostr = new PlaybackNostr(options.relays, sendScoped, () => pubkey);
    const files = new NappletFiles(sendScoped, (value) => {
      if (active && alive) options.files(value);
    });
    const store = scopedStorage(
      localStorage,
      `${options.identity}:${pubkey ?? 'guest'}`,
      crypto.randomUUID(),
    );
    const choose = (kind: HostPrompt['kind'], value: string) =>
      new Promise<boolean>((resolve) => {
        if (answer || !alive || !active) {
          resolve(false);
          return;
        }
        const timer = setTimeout(() => complete(false), 25000);
        const complete = (accepted: boolean) => {
          if (answer !== complete) return;
          clearTimeout(timer);
          answer = undefined;
          options.prompt(null);
          resolve(alive && active && accepted);
        };
        answer = complete;
        options.prompt({ kind, value, answer: complete });
      });
    const resource = async (input: unknown, signal: AbortSignal) => {
      const request = z
        .object({
          url: z.string().max(4096),
          servers: z.array(z.string().max(2048)).max(8).optional(),
        })
        .strict()
        .parse(input);
      if (++resourceCalls > 60 || resourceBytes >= 128 * 1024 * 1024)
        throw new Error('quota-exceeded');
      return resourceQueue.run(signal, async () => {
        const response = await fetch('/api/resources', {
          method: 'POST',
          credentials: 'omit',
          signal,
          headers: { 'Content-Type': 'application/json', 'X-Space-Host': '1' },
          body: JSON.stringify({ manifest: options.manifestId, ...request }),
        });
        if (!response.ok) throw new Error((await response.json()).error ?? 'network-error');
        const blob = await response.blob();
        resourceBytes += blob.size;
        if (blob.size > 10 * 1024 * 1024 || resourceBytes > 128 * 1024 * 1024)
          throw new Error('quota-exceeded');
        return { blob, mime: blob.type };
      });
    };
    const handle = async (message: Record<string, unknown>) => {
      const type = String(message.type),
        [domain, action] = type.split('.');
      if (domain === 'storage') return store(message);
      if (domain === 'fs') return files.handle(message, (name) => choose('save', name));
      if (domain === 'identity') return nostr.identity(action);
      if (domain === 'relay' || domain === 'outbox') return nostr.handle(message);
      if (domain === 'common') return nostr.common(message);
      if (type === 'theme.get')
        return {
          theme: {
            title: 'Napplet Space',
            colors: { background: '#f8f6ed', text: '#292d23', primary: '#72ac98' },
          },
        };
      if (type === 'link.open') {
        const url = new URL(z.string().max(4096).parse(message.url));
        if (url.protocol !== 'https:' || url.username || url.password) return { status: 'denied' };
        return { status: (await choose('link', url.href)) ? 'opened' : 'denied' };
      }
      if (type === 'resource.info')
        return {
          info: {
            schemes: ['data', 'https', 'blossom'].map((scheme) => ({ scheme, enabled: true })),
            maxBytes: 10 * 1024 * 1024,
            maxUrls: 16,
            maxServers: 8,
          },
        };
      if (type === 'resource.bytes' || type === 'resource.bytesMany') {
        const id = String(message.id);
        if (resources.has(id) || resources.size >= 16) throw new Error('quota-exceeded');
        const controller = new AbortController();
        resources.set(id, controller);
        const signal = AbortSignal.any([controller.signal, lifetime.signal]);
        try {
          if (type === 'resource.bytes')
            return await resource(
              { url: message.url, ...(message.servers ? { servers: message.servers } : {}) },
              signal,
            );
          const inputs = z
            .array(
              z
                .object({
                  url: z.string().max(4096),
                  servers: z.array(z.string().max(2048)).max(8).optional(),
                })
                .strict(),
            )
            .min(1)
            .max(16)
            .parse(message.requests);
          // Sequential bulk delivery avoids multiplying the per-frame concurrent request cap.
          const items = [];
          for (const input of inputs) {
            try {
              items.push({ ok: true, url: input.url, ...(await resource(input, signal)) });
            } catch (error) {
              items.push({
                ok: false,
                url: input.url,
                error: error instanceof Error ? error.message : 'network-error',
              });
            }
          }
          return { items };
        } finally {
          resources.delete(id);
        }
      }
      throw new Error('Unsupported operation');
    };
    return {
      pubkey,
      requests,
      handle,
      send: sendScoped,
      cancel: (id: string) => resources.get(id)?.abort(),
      resetBudget: () => {
        resourceCalls = 0;
      },
      close: (reason: string) => {
        for (const fail of requests) fail(new Error(reason));
        requests.clear();
        answer?.(false);
        // close() synchronously notifies live subscriptions; late query completions
        // are suppressed once this scope becomes inactive below.
        nostr.close();
        active = false;
        lifetime.abort();
        resources.clear();
      },
    };
  };
  let account = createAccount(options.pubkey);
  const listener = (event: MessageEvent) => {
    if (!alive || event.source !== source || event.origin !== 'null') return;
    const parsed = envelope.safeParse(event.data);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === 'shell.ready') {
      if (initialized) return;
      initialized = true;
      send({ type: 'shell.init', capabilities: { domains: [...RUNTIME_DOMAINS] }, services: [] });
      return;
    }
    if (!initialized || !message.id || !HOST_REQUESTS.has(message.type)) return;
    const scope = account;
    // NAP-IDENTITY requires this basic snapshot to succeed without an error
    // field, even when asynchronous services have exhausted their quota.
    if (message.type === 'identity.getPublicKey') {
      send({ type: 'identity.getPublicKey.result', id: message.id, pubkey: scope.pubkey ?? '' });
      return;
    }
    if (message.type === 'resource.cancel') {
      scope.cancel(message.id);
      return;
    }
    let size: number;
    try {
      size = JSON.stringify(message).length;
    } catch {
      return;
    }
    if (size > 360000) return;
    if (Date.now() - windowStart >= 60000) {
      windowStart = Date.now();
      calls = 0;
      scope.resetBudget();
    }
    const failure = (error: unknown) => {
      const detail =
        error instanceof z.ZodError
          ? 'Invalid request'
          : error instanceof Error
            ? error.message
            : 'Request failed';
      if (message.type.startsWith('resource.'))
        scope.send({
          type: `${message.type}.error`,
          id: message.id,
          error: [
            'quota-exceeded',
            'too-large',
            'unsupported-scheme',
            'blocked-by-policy',
            'timeout',
            'network-error',
          ].includes(detail)
            ? detail
            : 'blocked-by-policy',
          message: detail,
        });
      else {
        scope.send({
          type: `${message.type}.result`,
          id: message.id,
          ok: false,
          error:
            message.type.startsWith('fs.') && error instanceof z.ZodError ? 'invalid-data' : detail,
        });
        if (message.type.endsWith('.subscribe'))
          scope.send({
            type: `${message.type.split('.')[0]}.closed`,
            subId: message.subId,
            reason: detail,
          });
      }
    };
    if (++calls > 600 || scope.requests.size >= 32) {
      failure(new Error('Request quota exceeded'));
      return;
    }
    scope.requests.add(failure);
    void scope
      .handle(message)
      .then((result) => scope.send({ type: `${message.type}.result`, id: message.id, ...result }))
      .catch(failure)
      .finally(() => scope.requests.delete(failure));
  };
  window.addEventListener('message', listener);
  return {
    updateIdentity(pubkey: string | null) {
      if (!alive || account.pubkey === pubkey) return;
      account.close('Identity changed');
      options.files([]);
      account = createAccount(pubkey);
      if (initialized) send({ type: 'identity.changed', pubkey: pubkey ?? '' });
    },
    close() {
      if (!alive) return;
      alive = false;
      window.removeEventListener('message', listener);
      account.close('Player closed');
      options.files([]);
    },
  };
}
