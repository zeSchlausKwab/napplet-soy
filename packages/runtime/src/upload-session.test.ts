import { test, expect } from 'bun:test';
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools';
import { NappletUploads } from './upload-session';
import { sha256 } from '../../protocol/src/artifact';

const key = new Uint8Array(32).fill(23),
  pubkey = getPublicKey(key);
test('UPLOAD uses viewer consent, signed hash/server auth, direct URLs and verified stored bytes', async () => {
  const old = globalThis.fetch;
  const sent: any[] = [],
    prompts: string[] = [],
    calls: { url: string; method?: string }[] = [];
  const bytes = new TextEncoder().encode('image fixture'),
    hash = await sha256(bytes);
  let signed = 0,
    allow = false,
    tamper = false;
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), method: init?.method });
    expect(init?.credentials).toBe('omit');
    expect(init?.redirect).toBe('error');
    if (init?.method === 'PUT') {
      const auth = JSON.parse(atob(new Headers(init.headers).get('Authorization')!.slice(6)));
      expect(verifyEvent(auth)).toBe(true);
      expect(auth.pubkey).toBe(pubkey);
      expect(auth.tags).toContainEqual(['server', 'storage.example']);
      expect(auth.tags).toContainEqual(['x', hash]);
      expect(auth.tags).toContainEqual(['t', 'upload']);
      return Response.json({
        sha256: hash,
        size: bytes.length,
        url: `https://storage.example/${hash}.png`,
      });
    }
    return new Response(tamper ? 'corrupted' : bytes);
  }) as typeof fetch;
  const abort = new AbortController();
  const uploads = new NappletUploads({
    pubkey,
    signal: abort.signal,
    servers: ['https://storage.example'],
    consent: async (value) => {
      prompts.push(value);
      return allow;
    },
    send: (m) => sent.push(m),
    sign: async (_pk, template) => {
      signed++;
      return finalizeEvent(template, key);
    },
  });
  const run = async () => {
    const initial = await uploads.handle({
      type: 'upload.upload',
      request: { data: new Blob([bytes], { type: 'image/png' }), filename: 'cover.png' },
    });
    expect(initial.result?.status).toBe('uploading');
    for (let i = 0; i < 100; i++) {
      const result = await uploads.handle({
        type: 'upload.status',
        uploadId: initial.result!.uploadId,
      });
      if (result.status?.status !== 'uploading') return result.status!;
      await Bun.sleep(5);
    }
    throw new Error('Upload did not settle');
  };
  try {
    expect((await run()).status).toBe('cancelled');
    expect(signed).toBe(0);
    expect(calls).toEqual([]);
    allow = true;
    const complete = await run();
    expect(complete).toMatchObject({
      status: 'complete',
      sha256: hash,
      size: bytes.length,
      url: `https://storage.example/${hash}.png`,
    });
    expect(complete.nip94).toContainEqual(['x', hash]);
    expect(prompts[1]).toContain('https://storage.example');
    expect(prompts[1]).toContain(pubkey);
    expect(sent.at(-1).status.status).toBe('complete');
    tamper = true;
    expect((await run()).status).toBe('failed');
    expect(sent.at(-1).status.error).toBe('upload verification failed');
    await expect(
      uploads.handle({
        type: 'upload.upload',
        request: { data: new ArrayBuffer(10 * 1024 * 1024 + 1) },
      }),
    ).rejects.toThrow('file too large');
    await expect(
      uploads.handle({ type: 'upload.status', uploadId: 'other-frame' }),
    ).rejects.toThrow('unknown upload');
  } finally {
    abort.abort();
    globalThis.fetch = old;
  }
});
test('UPLOAD identity retirement cancels pending consent without signing or fetching', async () => {
  let answer: (value: boolean) => void = () => {};
  let signs = 0;
  const sent: unknown[] = [],
    abort = new AbortController();
  const uploads = new NappletUploads({
    pubkey,
    signal: abort.signal,
    servers: ['https://storage.example'],
    consent: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
    send: (m) => sent.push(m),
    sign: async (_pk, t) => {
      signs++;
      return finalizeEvent(t, key);
    },
  });
  await uploads.handle({ type: 'upload.upload', request: { data: new Blob(['test']) } });
  await Bun.sleep(5);
  abort.abort();
  answer(true);
  await Bun.sleep(5);
  expect(signs).toBe(0);
  expect(sent).toEqual([]);
});
