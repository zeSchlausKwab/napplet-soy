import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import type { EventTemplate } from 'nostr-tools';
import fixtures from '../data/catalog.json';
import { sha256, encodeAddress } from '../../protocol/src';
import { adminResponse } from './admin-response';
import {
  blocked,
  initializePolicy,
  manifestBlocked,
  readPolicy,
  updatePolicy,
  type ModerationAction,
} from '../../moderation/src/policy';
import { artifact, gallery, playableManifest, resolveNapplet } from './catalog';
import { ogResponse } from './og';
import { previewResponse } from './previews';

const admin = new PrivateKeySigner(),
  outsider = new PrivateKeySigner();
const actor = await admin.getPublicKey();
const original = { ...process.env };
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'napplet-moderation-'));
  process.env.SPACE_MODERATION_FILE = join(directory, 'policy.json');
  process.env.SPACE_ADMIN_PUBKEYS = actor;
  process.env.SPACE_SITE_ORIGIN = 'https://napplet.example';
  delete process.env.SPACE_INDEX_DIR;
  delete process.env.SPACE_PUBLICDEV;
  initializePolicy(process.env.SPACE_MODERATION_FILE);
});
afterEach(async () => {
  for (const name of [
    'SPACE_MODERATION_FILE',
    'SPACE_ADMIN_PUBKEYS',
    'SPACE_SITE_ORIGIN',
    'SPACE_INDEX_DIR',
    'SPACE_PUBLICDEV',
  ]) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
  await rm(directory, { recursive: true, force: true });
});
const fixture = fixtures[0];
const action = (): ModerationAction => ({
  action: 'block',
  type: 'address',
  target: fixture.naddr,
  reason: 'Test policy',
  revision: readPolicy().revision,
});
async function signed(body?: string, change?: (e: EventTemplate) => void, signer = admin) {
  const event: EventTemplate = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags: [
      ['u', 'https://napplet.example/api/admin'],
      ['method', body ? 'POST' : 'GET'],
      ['nonce', crypto.randomUUID()],
    ],
  };
  if (body) event.tags.push(['payload', await sha256(body)]);
  change?.(event);
  return `Nostr ${Buffer.from(JSON.stringify(await signer.signEvent(event))).toString('base64')}`;
}
function request(token?: string, body?: string, url = 'https://napplet.example/api/admin') {
  return new Request(url, {
    method: body ? 'POST' : 'GET',
    headers: { ...(token ? { Authorization: token } : {}), 'Content-Type': 'application/json' },
    body,
  });
}
test('admin access requires an allowlisted signature and binds URL, method, time and payload', async () => {
  const body = JSON.stringify(action());
  expect((await adminResponse(request())).status).toBe(401);
  expect((await adminResponse(request(await signed(undefined, undefined, outsider)))).status).toBe(
    403,
  );
  for (const change of [
    (e: EventTemplate) => {
      e.created_at -= 61;
    },
    (e: EventTemplate) => {
      e.created_at += 31;
    },
    (e: EventTemplate) => {
      e.tags[0][1] = 'https://evil.example/api/admin';
    },
    (e: EventTemplate) => {
      e.tags[1][1] = 'DELETE';
    },
    (e: EventTemplate) => {
      e.tags.push(['u', 'https://napplet.example/api/admin']);
    },
  ])
    expect((await adminResponse(request(await signed(body, change), body))).status).toBe(401);
  expect(
    (await adminResponse(request(await signed(body), body.replace('Test policy', 'Tampered'))))
      .status,
  ).toBe(401);
  expect(
    (
      await adminResponse(
        request(await signed(), undefined, 'https://napplet.example/api/admin?extra=1'),
      )
    ).status,
  ).toBe(401);
  const valid = await signed();
  const forged = JSON.parse(Buffer.from(valid.slice(6), 'base64').toString());
  forged.sig = '0'.repeat(128);
  expect(
    (
      await adminResponse(
        request(`Nostr ${Buffer.from(JSON.stringify(forged)).toString('base64')}`),
      )
    ).status,
  ).toBe(401);
  expect(readPolicy().revision).toBe(0);
});
test('signed policy changes survive reload, reject replay/stale updates, and audit reversible blocks', async () => {
  const body = JSON.stringify(action()),
    token = await signed(body);
  expect((await adminResponse(request(token, body))).status).toBe(200);
  expect((await adminResponse(request(token, body))).status).toBe(409);
  expect((await adminResponse(request(await signed(body), body))).status).toBe(409);
  initializePolicy(process.env.SPACE_MODERATION_FILE!);
  const read = await adminResponse(request(await signed()));
  const state = await read.json();
  expect(state.rules).toHaveLength(1);
  expect(state.audit[0]).toMatchObject({ actor, action: 'block', revision: 1 });
  const undo = JSON.stringify({ ...action(), action: 'unblock', reason: 'Reviewed and restored' });
  expect((await adminResponse(request(await signed(undo), undo))).status).toBe(200);
  expect(readPolicy().rules).toHaveLength(0);
  expect(readPolicy().audit).toHaveLength(2);
});
test('naddr blocks preserve exact identifiers including trailing whitespace and root identities', () => {
  for (const [kind, identifier] of [
    [35129, 'with space '],
    [15129, ''],
  ] as const) {
    const target = encodeAddress({ kind, pubkey: fixture.pubkey, identifier });
    updatePolicy({ ...action(), target }, actor, String(kind).padStart(64, '0'));
    initializePolicy(process.env.SPACE_MODERATION_FILE!);
    expect(blocked('address', `${kind}:${fixture.pubkey}:${identifier}`)).toBe(true);
  }
});
test('blocking a napplet closes gallery, named/address/snapshot, source, player and cached preview paths', async () => {
  expect(await playableManifest(fixture.current.id)).not.toBeNull();
  const imageURL = `https://napplet.example/api/og/${fixture.snapshot.id}`;
  expect((await ogResponse(fixture.snapshot.id, new Request(imageURL))).status).toBe(200);
  updatePolicy(action(), actor, 'a'.repeat(64));
  expect(
    (await gallery({ tag: '', q: '', sort: 'curated' })).some((n) => n.slug === fixture.slug),
  ).toBe(false);
  for (const lookup of [
    { type: 'named', creator: '@space-lab', slug: fixture.slug },
    { type: 'address', naddr: fixture.naddr },
    { type: 'snapshot', id: fixture.snapshot.id },
  ] as const)
    expect(await resolveNapplet(lookup)).toBeNull();
  expect(await artifact(fixture.artifactHash)).toBeNull();
  expect(await playableManifest(fixture.current.id)).toBeNull();
  expect(await playableManifest(fixture.snapshot.id)).toBeNull();
  expect((await ogResponse(fixture.snapshot.id, new Request(imageURL))).status).toBe(404);
  expect((await previewResponse(fixture.snapshot.id, new Request(imageURL))).status).toBe(404);
  updatePolicy({ ...action(), action: 'unblock' }, actor, 'b'.repeat(64));
  expect(await playableManifest(fixture.current.id)).not.toBeNull();
});
test('blocking one event preserves an unblocked snapshot that shares its artifact', async () => {
  updatePolicy({ ...action(), type: 'event', target: fixture.current.id }, actor, '1'.repeat(64));
  expect(await playableManifest(fixture.current.id)).toBeNull();
  expect(await playableManifest(fixture.snapshot.id)).not.toBeNull();
  expect(await artifact(fixture.artifactHash)).not.toBeNull();
  updatePolicy({ ...action(), type: 'event', target: fixture.snapshot.id }, actor, '2'.repeat(64));
  expect(await artifact(fixture.artifactHash)).toBeNull();
});
test('author and hash rules apply to new manifests, snapshot links are author-bound, unreadable policy fails closed', async () => {
  updatePolicy({ ...action(), type: 'pubkey', target: fixture.pubkey }, actor, 'c'.repeat(64));
  expect(manifestBlocked({ ...fixture.current, id: 'd'.repeat(64) })).toBe(true);
  updatePolicy(
    { ...action(), type: 'pubkey', target: fixture.pubkey, action: 'unblock' },
    actor,
    'd'.repeat(64),
  );
  updatePolicy(action(), actor, 'e'.repeat(64));
  expect(manifestBlocked({ ...fixture.snapshot, pubkey: await outsider.getPublicKey() })).toBe(
    false,
  );
  updatePolicy({ ...action(), type: 'hash', target: fixture.artifactHash }, actor, 'f'.repeat(64));
  expect(manifestBlocked(fixture.current)).toBe(true);
  await writeFile(process.env.SPACE_MODERATION_FILE!, '{broken');
  expect(() => blocked('hash', fixture.artifactHash)).toThrow('unavailable');
  expect((await adminResponse(request(await signed()))).status).toBe(503);
});
