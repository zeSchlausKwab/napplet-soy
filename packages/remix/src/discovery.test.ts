import { expect, test } from 'bun:test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { discoverRemix } from './discovery';

function relay(reply: (send: (message: unknown[]) => void, id: string) => void) {
  let closed = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, server) =>
      server.upgrade(request) ? undefined : new Response('', { status: 404 }),
    websocket: {
      message(socket, raw) {
        const message = JSON.parse(String(raw));
        if (message[0] === 'REQ') reply((m) => socket.send(JSON.stringify(m)), message[1]);
      },
      close() {
        closed++;
      },
    },
  });
  return {
    url: `ws://127.0.0.1:${server.port}`,
    close: () => server.stop(true),
    closed: () => closed,
  };
}

test('remix discovery verifies and matches events despite an unavailable relay', async () => {
  const signer = generateSecretKey();
  const event = finalizeEvent(
    { kind: 35129, created_at: 1, content: '', tags: [['d', 'wanted']] },
    signer,
  );
  const unrelated = finalizeEvent({ ...event, tags: [['d', 'unrelated']] }, signer);
  const future = finalizeEvent(
    { ...event, created_at: Math.floor(Date.now() / 1000) + 3600 },
    signer,
  );
  const good = relay((send, id) => {
    for (const candidate of [unrelated, { ...event, content: 'forged' }, future, event, event])
      send(['EVENT', id, candidate]);
    send(['EOSE', id]);
  });
  const refused = relay((send, id) => send(['CLOSED', id, 'private relay detail must not leak']));
  try {
    expect(
      await discoverRemix(
        { kinds: [35129], authors: [event.pubkey], '#d': ['wanted'] },
        [refused.url, good.url],
        AbortSignal.timeout(2000),
      ),
    ).toEqual(event);
  } finally {
    good.close();
    refused.close();
  }
});

test('remix discovery distinguishes completed absence from a failed lookup', async () => {
  const empty = relay((send, id) => send(['EOSE', id]));
  const refused = relay((send, id) => send(['CLOSED', id, 'private relay detail must not leak']));
  try {
    await expect(
      discoverRemix({ ids: ['a'.repeat(64)] }, [empty.url], AbortSignal.timeout(2000)),
    ).rejects.toMatchObject({ code: 'REMIX_NOT_FOUND' });
    await expect(
      discoverRemix({ ids: ['a'.repeat(64)] }, [refused.url], AbortSignal.timeout(2000)),
    ).rejects.toMatchObject({ code: 'REMIX_RELAYS_UNAVAILABLE' });
  } finally {
    empty.close();
    refused.close();
  }
});

test('an exact verified release does not wait for a silent fallback relay', async () => {
  const event = finalizeEvent(
    { kind: 5129, created_at: 1, content: '', tags: [] },
    generateSecretKey(),
  );
  let queried!: () => void;
  const started = new Promise<void>((resolve) => {
    queried = resolve;
  });
  const silent = relay(() => queried());
  const good = relay((send, id) => {
    void started.then(() => send(['EVENT', id, event]));
  });
  try {
    expect(
      await discoverRemix({ ids: [event.id] }, [silent.url, good.url], AbortSignal.timeout(2000)),
    ).toEqual(event);
    const deadline = AbortSignal.timeout(1000);
    while ((!silent.closed() || !good.closed()) && !deadline.aborted) await Bun.sleep(5);
    expect(silent.closed()).toBe(1);
    expect(good.closed()).toBe(1);
  } finally {
    silent.close();
    good.close();
  }
});

test('named lookups wait for the newer version from another relay', async () => {
  const signer = generateSecretKey();
  const old = finalizeEvent(
    { kind: 35129, created_at: 1, content: '', tags: [['d', 'versioned']] },
    signer,
  );
  const latest = finalizeEvent({ ...old, created_at: 2 }, signer);
  let queried!: () => void;
  const started = new Promise<void>((resolve) => {
    queried = resolve;
  });
  const first = relay((send, id) => {
    send(['EVENT', id, old]);
    send(['EOSE', id]);
    queried();
  });
  const second = relay((send, id) => {
    void started.then(() => {
      send(['EVENT', id, latest]);
      send(['EOSE', id]);
    });
  });
  try {
    expect(
      await discoverRemix(
        { kinds: [35129], authors: [old.pubkey], '#d': ['versioned'] },
        [first.url, second.url],
        AbortSignal.timeout(2000),
      ),
    ).toEqual(latest);
  } finally {
    first.close();
    second.close();
  }
});

test('remix cancellation closes an in-flight relay and also rejects an already cancelled lookup', async () => {
  const controller = new AbortController();
  const waiting = relay(() => controller.abort());
  try {
    await expect(
      discoverRemix({ ids: ['a'.repeat(64)] }, [waiting.url], controller.signal),
    ).rejects.toMatchObject({ code: 'REMIX_CANCELLED' });
    await expect(
      discoverRemix({ ids: ['a'.repeat(64)] }, [waiting.url], controller.signal),
    ).rejects.toMatchObject({ code: 'REMIX_CANCELLED' });
    // Wait for the actual peer to observe close; no arbitrary timing assertion.
    const deadline = AbortSignal.timeout(1000);
    while (!waiting.closed() && !deadline.aborted) await Bun.sleep(5);
    expect(waiting.closed()).toBe(1);
  } finally {
    waiting.close();
  }
});
