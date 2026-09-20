import { test, expect } from 'bun:test';
import { finalizeEvent, getPublicKey, nip19 } from 'nostr-tools';
import { NappletActions, signExact, type ActionIO } from './action-session';
import { LIST_SUPPORT, mutateList } from './action-contracts';
import type { SignedEvent } from '../../protocol/src';

const key = new Uint8Array(32).fill(21),
  pubkey = getPublicKey(key),
  other = getPublicKey(new Uint8Array(32).fill(22));
const event = (kind = 3, tags = [['p', other]], content = '') =>
  finalizeEvent({ kind, tags, content, created_at: Math.floor(Date.now() / 1000) - 30 }, key);
function fixture(base?: SignedEvent) {
  let current = base,
    accepts = true,
    signs = 0,
    failRead = false,
    failPublish = false;
  const published: SignedEvent[] = [],
    prompts: string[] = [];
  const abort = new AbortController();
  const io: ActionIO = {
    query: async (_filters, _signal, complete) => {
      expect(complete).toBe(true);
      if (failRead) throw new Error('list-unavailable');
      return current ? [current] : [];
    },
    publish: async (e) => {
      published.push(e);
      if (failPublish) throw new Error('offline');
      current = e;
    },
  };
  const session = new NappletActions({
    pubkey,
    signal: abort.signal,
    relays: ['wss://relay.example'],
    io,
    sign: async (_pk, template) => {
      signs++;
      return finalizeEvent(template, key);
    },
    consent: async (description) => {
      prompts.push(description);
      return accepts;
    },
  });
  return {
    session,
    abort,
    published,
    prompts,
    get signs() {
      return signs;
    },
    io,
    set current(v: SignedEvent | undefined) {
      current = v;
    },
    set accepts(v: boolean) {
      accepts = v;
    },
    set failRead(v: boolean) {
      failRead = v;
    },
    set failPublish(v: boolean) {
      failPublish = v;
    },
  };
}
const follow = { type: 'common.follow', pubkeys: [nip19.npubEncode(pubkey)] };
test('follow preserves unrelated tags/content; denied or unreadable lists never sign; no-op is idempotent', async () => {
  const original = event(
    3,
    [
      ['p', other, 'wss://hint.example', 'friend'],
      ['client', 'another-client'],
    ],
    '{"legacy":true}',
  );
  const f = fixture(original);
  try {
    f.accepts = false;
    expect(await f.session.handle(follow)).toMatchObject({ ok: false, error: 'user-denied' });
    expect(f.signs).toBe(0);
    f.accepts = true;
    f.failRead = true;
    expect(await f.session.handle(follow)).toMatchObject({ ok: false, error: 'list-unavailable' });
    expect(f.signs).toBe(0);
    f.failRead = false;
    expect(await f.session.handle(follow)).toMatchObject({ ok: true });
    expect(f.published[0].tags).toEqual([...original.tags, ['p', pubkey]]);
    expect(f.published[0].content).toBe(original.content);
    expect(await f.session.handle(follow)).toMatchObject({ ok: true, skipped: 1 });
    expect(f.signs).toBe(1);
    expect(f.prompts[0]).toContain(pubkey);
    expect(f.prompts[0]).toContain('wss://relay.example');
  } finally {
    f.session.close();
  }
});
test('a failed publication retries the identical signed event; concurrent list changes abort before signing', async () => {
  const f = fixture(event());
  try {
    f.failPublish = true;
    expect(await f.session.handle(follow)).toMatchObject({ error: 'publish-failed' });
    f.failPublish = false;
    expect(await f.session.handle(follow)).toMatchObject({ ok: true });
    expect(f.published[0].id).toBe(f.published[1].id);
    expect(f.signs).toBe(1);
  } finally {
    f.session.close();
  }
  const g = fixture(event());
  let reads = 0;
  g.io.query = async () => [
    ++reads === 1
      ? event()
      : event(3, [
          ['p', other],
          ['p', pubkey],
        ]),
  ];
  try {
    expect(await g.session.handle(follow)).toMatchObject({ error: 'list-changed-retry' });
    expect(g.signs).toBe(0);
  } finally {
    g.session.close();
  }
});
test('late consent or signing cannot publish after account cancellation; altered signer templates are rejected', async () => {
  let finish: (allow: boolean) => void = () => {};
  let signed = 0,
    published = 0;
  const abort = new AbortController();
  const session = new NappletActions({
    pubkey,
    signal: abort.signal,
    relays: [],
    io: {
      query: async () => [],
      publish: async () => {
        published++;
      },
    },
    sign: async (_pk, template) => {
      signed++;
      return finalizeEvent(template, key);
    },
    consent: () =>
      new Promise((r) => {
        finish = r;
      }),
  });
  const result = session.handle(follow);
  await Bun.sleep(0);
  abort.abort();
  finish(true);
  expect(await result).toMatchObject({ ok: false });
  await Bun.sleep(0);
  expect(signed).toBe(0);
  expect(published).toBe(0);
  session.close();
  await expect(
    signExact(
      async (_pk, t) => finalizeEvent({ ...t, content: 'changed' }, key),
      pubkey,
      { kind: 7, tags: [], content: '+', created_at: 1 },
      new AbortController().signal,
    ),
  ).rejects.toThrow('signer-mismatch');
});
test('LISTS preserves opaque private data, rejects partial private removals, and handles NIP-65 markers', () => {
  expect(LIST_SUPPORT.every((s) => s.privateItems === false)).toBe(true);
  const base = event(
    10000,
    [
      ['word', 'spam'],
      ['unknown', 'keep'],
    ],
    'opaque-encrypted-content',
  );
  const request = { list: { kind: 10000 }, items: [{ itemType: 'word' as const, value: 'spam' }] };
  expect(() => mutateList(request, base, true)).toThrow('private-items-unsupported');
  const result = mutateList(
    { ...request, items: [{ ...request.items[0], visibility: 'public' }] },
    base,
    true,
  );
  expect(result.tags).toEqual([['unknown', 'keep']]);
  expect(result.content).toBe(base.content);
  expect(() =>
    mutateList(
      { ...request, items: [{ itemType: 'pubkey', value: pubkey, visibility: 'private' }] },
      base,
      false,
    ),
  ).toThrow('private-items-unsupported');
  const relays = event(10002, [
    ['r', 'wss://relay.example'],
    ['client', 'keep'],
  ]);
  expect(
    mutateList(
      {
        list: { kind: 10002 },
        items: [{ itemType: 'relay', value: 'wss://relay.example/', marker: 'read' }],
      },
      relays,
      true,
    ).tags,
  ).toEqual([
    ['r', 'wss://relay.example', 'write'],
    ['client', 'keep'],
  ]);
  expect(
    mutateList(
      { list: { kind: 10002 }, items: [{ itemType: 'relay', value: 'wss://relay.example/' }] },
      relays,
      false,
    ).skipped,
  ).toBe(1);
  expect(() =>
    mutateList(
      {
        list: { kind: 30000 },
        items: [{ itemType: 'pubkey', value: pubkey }],
        options: { create: true },
      },
      undefined,
      false,
    ),
  ).toThrow('missing-identifier');
});
test('COMMON reactions/reports resolve signed targets and use NIP-25/NIP-56 tags', async () => {
  const target = event(35129, [['d', 'demo']]);
  const f = fixture();
  f.io.query = async () => [target];
  try {
    expect(
      await f.session.handle({
        type: 'common.react',
        targetEventId: target.id,
        reaction: 'many words',
      }),
    ).toMatchObject({ error: 'invalid-reaction' });
    expect(
      await f.session.handle({ type: 'common.react', targetEventId: target.id, reaction: '🚀' }),
    ).toMatchObject({ ok: true });
    expect(f.published[0].tags).toEqual([
      ['e', target.id],
      ['p', pubkey],
      ['k', '35129'],
      ['a', `35129:${pubkey}:demo`],
    ]);
    expect(
      await f.session.handle({
        type: 'common.report',
        target: { type: 'event', id: target.id },
        reason: 'spam',
        text: 'Spam here',
      }),
    ).toMatchObject({ ok: true });
    expect(f.published[1]).toMatchObject({
      kind: 1984,
      content: 'Spam here',
      tags: [
        ['e', target.id, 'spam'],
        ['p', pubkey],
      ],
    });
    expect(
      await f.session.handle({
        type: 'common.report',
        target: { type: 'event', id: target.id, pubkey: other },
        reason: 'spam',
        text: '',
      }),
    ).toMatchObject({ error: 'invalid-target' });
  } finally {
    f.session.close();
  }
});
