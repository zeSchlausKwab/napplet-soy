import { test, expect } from 'bun:test';
import { attachNappletHost } from './host';

test('retiring an account aborts resources and suppresses late replies even when request IDs are reused', async () => {
  const globals = ['window', 'localStorage', 'fetch'] as const;
  const descriptors = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  const sent: Record<string, unknown>[] = [];
  let listener: (event: MessageEvent) => void = () => {};
  const source = { postMessage: (message: Record<string, unknown>) => sent.push(message) };
  const requests: { signal: AbortSignal; resolve: (response: Response) => void }[] = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: (_: string, fn: typeof listener) => {
        listener = fn;
      },
      removeEventListener: () => {},
    },
  });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: (_: unknown, init: RequestInit) =>
      new Promise<Response>((resolve) => requests.push({ signal: init.signal!, resolve })),
  });
  const host = attachNappletHost({
    frame: { contentWindow: source } as unknown as HTMLIFrameElement,
    identity: 'verified-napplet',
    manifestId: 'a'.repeat(64),
    relays: [],
    pubkey: null,
    prompt: () => {},
    files: () => {},
  });
  const deliver = (data: Record<string, unknown>) =>
    listener({ data, source, origin: 'null' } as unknown as MessageEvent);
  try {
    host.updateIdentity('b'.repeat(64));
    expect(sent).toEqual([]); // No notifications before the mandatory handshake.
    deliver({ type: 'shell.ready' });
    deliver({ type: 'resource.bytes', id: 'reused', url: 'https://assets.example/file' });
    await Bun.sleep(0);
    expect(requests).toHaveLength(1);
    host.updateIdentity('c'.repeat(64));
    expect(requests[0].signal.aborted).toBe(true);
    expect(sent.slice(-2)).toMatchObject([
      { type: 'resource.bytes.error', id: 'reused' },
      { type: 'identity.changed', pubkey: 'c'.repeat(64) },
    ]);
    host.updateIdentity('c'.repeat(64));
    deliver({ type: 'shell.ready' });
    expect(sent.filter((m) => m.type === 'identity.changed')).toHaveLength(1);
    expect(sent.filter((m) => m.type === 'shell.init')).toHaveLength(1);
    deliver({ type: 'resource.bytes', id: 'reused', url: 'https://assets.example/new' });
    await Bun.sleep(0);
    requests[0].resolve(new Response('old account data'));
    await Bun.sleep(0);
    expect(sent.filter((m) => m.type === 'resource.bytes.result')).toHaveLength(0);
    expect(requests[1].signal.aborted).toBe(false);
    requests[1].resolve(new Response('new account data'));
    await Bun.sleep(0);
    const results = sent.filter((m) => m.type === 'resource.bytes.result');
    expect(results).toHaveLength(1);
    expect(await (results[0].blob as Blob).text()).toBe('new account data');
  } finally {
    host.close();
    globals.forEach((key, i) => {
      if (descriptors[i]) Object.defineProperty(globalThis, key, descriptors[i]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});
