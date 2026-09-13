import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import type { EventTemplate } from 'nostr-tools';
import { createBlossom, type BlossomConfig } from '../../services/blossom/server';
import { blossomAuthorization, uploadBlob } from '../../packages/blossom/src/client';
import { blossomOrigin, type BlobDescriptor } from '../../packages/blossom/src/protocol';
import { sha256 } from '../../packages/protocol/src';
import { initializePolicy, readPolicy, updatePolicy } from '../../packages/moderation/src/policy';

let service: Awaited<ReturnType<typeof createBlossom>>;
let directory: string;
let origin: string;
let config: BlossomConfig;
const owner = new PrivateKeySigner();
const other = new PrivateKeySigner();
const stranger = new PrivateKeySigner();
const bytes = new TextEncoder().encode('<!doctype html><h1>Blossom round trip</h1>');
const hash = await sha256(bytes);
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'napplet-blossom-'));
  config = {
    directory,
    origin: 'http://127.0.0.1:19348',
    local: true,
    port: 0,
    instance: 'test',
    build: 'test',
  };
  service = await createBlossom(config);
  origin = `http://127.0.0.1:${service.server.port}`;
});
afterEach(async () => {
  await service?.close(true);
  await rm(directory, { recursive: true, force: true });
});
async function put(data = bytes, signer = owner, expected?: string, authorization?: string) {
  const digest = expected ?? (await sha256(data));
  return fetch(`${origin}/upload`, {
    method: 'PUT',
    body: data,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-SHA-256': digest,
      Authorization:
        authorization ?? (await blossomAuthorization(signer, 'upload', origin, digest)),
    },
  });
}
async function list(signer = owner, query = '') {
  return fetch(`${origin}/list/${await signer.getPublicKey()}${query}`, {
    headers: { Authorization: await blossomAuthorization(signer, 'list', origin) },
  });
}
async function remove(signer = owner, digest = hash) {
  return fetch(`${origin}/${digest}`, {
    method: 'DELETE',
    headers: {
      Authorization: await blossomAuthorization(signer, 'delete', origin, digest),
    },
  });
}
test('operator blocks close direct blob/range/conditional reads and future uploads, while preserving deletion', async () => {
  const original = process.env.SPACE_MODERATION_FILE;
  try {
    process.env.SPACE_MODERATION_FILE = join(directory, 'moderation.json');
    initializePolicy(process.env.SPACE_MODERATION_FILE);
    const actor = await owner.getPublicKey();
    const change = (
      type: 'hash' | 'pubkey',
      target: string,
      action: 'block' | 'unblock' = 'block',
    ) =>
      updatePolicy(
        { type, target, action, reason: 'Service test', revision: readPolicy().revision },
        actor,
        crypto.randomUUID().replaceAll('-', '').repeat(2),
      );
    expect((await put()).status).toBe(201);
    change('hash', hash);
    for (const headers of [{}, { Range: 'bytes=0-10' }, { 'If-None-Match': `"${hash}"` }] as Record<
      string,
      string
    >[]) {
      const response = await fetch(`${origin}/${hash}`, { headers });
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect((await put()).status).toBe(403);
    change('hash', hash, 'unblock');
    expect((await fetch(`${origin}/${hash}`)).status).toBe(200);
    change('pubkey', actor);
    expect((await fetch(`${origin}/${hash}`)).status).toBe(404);
    expect((await put(new TextEncoder().encode('new upload'))).status).toBe(403);
    expect((await remove()).status).toBe(204);
  } finally {
    if (original === undefined) delete process.env.SPACE_MODERATION_FILE;
    else process.env.SPACE_MODERATION_FILE = original;
  }
});
async function token(change: (event: EventTemplate) => void, legacy = false) {
  const now = Math.floor(Date.now() / 1000);
  const template: EventTemplate = {
    kind: 24242,
    created_at: now - 1,
    content: 'Upload my napplet',
    tags: [
      ['t', 'upload'],
      ['expiration', String(now + 300)],
      ['server', '127.0.0.1'],
      ['x', hash],
    ],
  };
  change(template);
  return `Nostr ${Buffer.from(JSON.stringify(await owner.signEvent(template))).toString(legacy ? 'base64' : 'base64url')}`;
}

test('signed PUT works without preflight; shared uploader verifies exact bytes and descriptor', async () => {
  const first = await uploadBlob({ origin, bytes, type: 'text/html', signer: owner, local: true });
  expect(first.created).toBe(true);
  expect(first.descriptor).toMatchObject({
    sha256: hash,
    size: bytes.length,
    type: 'text/html',
    url: `${config.origin}/${hash}.html`,
  });
  const again = await uploadBlob({ origin, bytes, type: 'text/html', signer: owner, local: true });
  expect(again.created).toBe(false);
  expect(again.descriptor).toEqual(first.descriptor);
  for (const suffix of ['', '.html', '.png']) {
    const response = await fetch(`${origin}/${hash}${suffix}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-disposition')).toStartWith('attachment;');
    expect(response.headers.get('content-security-policy')).toContain('sandbox;');
    expect(await response.bytes()).toEqual(bytes);
  }
});
test('each uploader owns a claim; deleting one claim keeps shared bytes', async () => {
  expect((await put()).status).toBe(201);
  expect((await put(bytes, other)).status).toBe(200);
  expect((await remove(stranger)).status).toBe(403);
  expect((await remove()).status).toBe(204);
  expect(await (await list()).json()).toEqual([]);
  expect((await fetch(`${origin}/${hash}`)).status).toBe(200);
  expect((await remove(other)).status).toBe(204);
  expect((await fetch(`${origin}/${hash}`)).status).toBe(404);
});
test('authorization checks signature, action, time, server, hash, and canonical encoding', async () => {
  const invalid: Array<(e: EventTemplate) => void> = [
    (e) => {
      e.kind = 1;
    },
    (e) => {
      e.content = ' ';
    },
    (e) => {
      e.created_at += 10000;
    },
    (e) => {
      e.tags[0][1] = 'delete';
    },
    (e) => {
      e.tags[1][1] = '1';
    },
    (e) => {
      e.tags[2][1] = 'another.example';
    },
    (e) => {
      e.tags[2][1] = 'http://127.0.0.1';
    },
    (e) => {
      e.tags[3][1] = '0'.repeat(64);
    },
    (e) => {
      e.tags.pop();
    },
    (e) => {
      e.tags.push(['expiration', '999999999999']);
    },
  ];
  for (const change of invalid)
    expect((await put(bytes, owner, hash, await token(change))).status).toBe(401);
  const valid = await token(() => {});
  const event = JSON.parse(Buffer.from(valid.slice(6), 'base64url').toString());
  event.content += 'tampered';
  for (const auth of [
    '',
    'Nostr !!!!',
    `${valid}.`,
    `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64url')}`,
  ])
    expect((await put(bytes, owner, hash, auth)).status).toBe(401);
  expect(await readdir(join(directory, 'blobs'))).toEqual([]);
  // BUD-11 permits an unscoped token. Legacy base64 clients remain interoperable.
  expect(
    (
      await put(
        bytes,
        owner,
        hash,
        await token((e) => {
          e.tags = e.tags.filter((t) => t[0] !== 'server');
        }, true),
      )
    ).status,
  ).toBe(201);
});
test('a mismatched body cannot create a descriptor or ownership claim', async () => {
  const response = await put(new TextEncoder().encode('wrong'), owner, hash);
  expect(response.status).toBe(409);
  expect(response.headers.get('access-control-allow-origin')).toBe('*');
  expect(await readdir(join(directory, 'incoming'))).toEqual([]);
  expect(await readdir(join(directory, 'blobs'))).toEqual([]);
  expect(await (await list()).json()).toEqual([]);
});
test('HEAD preflight and byte-range reads support browser asset and video loading', async () => {
  const preflight = await fetch(`${origin}/upload`, {
    method: 'HEAD',
    headers: {
      Authorization: await blossomAuthorization(owner, 'upload', origin, hash),
      'X-SHA-256': hash,
      'X-Content-Type': 'text/html',
      'X-Content-Length': String(bytes.length),
    },
  });
  expect(preflight.status).toBe(200);
  expect((await list()).status).toBe(200);
  await put();
  const head = await fetch(`${origin}/${hash}`, { method: 'HEAD' });
  expect(head.headers.get('content-length')).toBe(String(bytes.length));
  expect((await head.bytes()).length).toBe(0);
  for (const [range, expected] of [
    ['bytes=0-4', bytes.slice(0, 5)],
    ['bytes=-4', bytes.slice(-4)],
    ['bytes=5-', bytes.slice(5)],
  ] as const) {
    const r = await fetch(`${origin}/${hash}`, { headers: { Range: range } });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toEndWith(`/${bytes.length}`);
    expect(await r.bytes()).toEqual(expected);
  }
  for (const range of ['bytes=999-', 'bytes=0-2,4-6', 'bytes=-0', 'bytes=-99999999999999999999']) {
    const r = await fetch(`${origin}/${hash}`, { headers: { Range: range } });
    expect(r.status).toBe(416);
    expect(r.headers.get('content-range')).toBe(`bytes */${bytes.length}`);
  }
  expect(
    (await fetch(`${origin}/${hash}`, { headers: { 'If-None-Match': `"${hash}"` } })).status,
  ).toBe(304);
  const full = await fetch(`${origin}/${hash}`, {
    headers: { Range: 'bytes=0-4', 'If-Range': 'another' },
  });
  expect(full.status).toBe(200);
  expect(await full.bytes()).toEqual(bytes);
  const options = await fetch(`${origin}/upload`, { method: 'OPTIONS' });
  expect(options.status).toBe(204);
  expect(options.headers.get('access-control-allow-headers')).toContain('Authorization');
});
test('owner listing paginates deterministically even when timestamps are equal', async () => {
  for (const data of ['first', 'second', 'third']) await put(new TextEncoder().encode(data));
  const all: BlobDescriptor[] = await (await list()).json();
  expect(all).toHaveLength(3);
  const seen: string[] = [];
  let cursor = '';
  for (let i = 0; i < 4; i++) {
    const page: BlobDescriptor[] = await (
      await list(owner, `?limit=1${cursor ? `&cursor=${cursor}` : ''}`)
    ).json();
    if (!page.length) break;
    seen.push(page[0].sha256);
    cursor = page[0].sha256;
  }
  expect(seen).toEqual(all.map((b) => b.sha256));
  expect((await list(owner, `?cursor=${'0'.repeat(64)}`)).status).toBe(400);
  const denied = await fetch(`${origin}/list/${await owner.getPublicKey()}`, {
    headers: { Authorization: await blossomAuthorization(other, 'list', origin) },
  });
  expect(denied.status).toBe(403);
});
test('concurrent uploads cannot overrun the committed global quota', async () => {
  await service.close();
  service = await createBlossom({
    ...config,
    limits: { maxTotal: 12, maxBlob: 10, maxOwner: 100 },
  });
  origin = `http://127.0.0.1:${service.server.port}`;
  const responses = await Promise.all(
    ['abcdefgh', 'ijklmnop'].map((s) => put(new TextEncoder().encode(s))),
  );
  expect(responses.map((r) => r.status).sort()).toEqual([201, 507]);
  expect(await readdir(join(directory, 'incoming'))).toEqual([]);
  expect(await readdir(join(directory, 'blobs'))).toHaveLength(1);
});
test('size and owner limits refuse uploads without leaving partial bytes', async () => {
  await service.close();
  service = await createBlossom({ ...config, limits: { maxBlob: 10, maxOwner: 5 } });
  origin = `http://127.0.0.1:${service.server.port}`;
  expect((await put(new TextEncoder().encode('123456'))).status).toBe(403);
  const tooLarge = await put();
  expect(tooLarge.status).toBe(413);
  expect(tooLarge.headers.get('access-control-allow-origin')).toBe('*');
  expect(await readdir(join(directory, 'incoming'))).toEqual([]);
});
test('metadata and bytes survive restart; startup reclaims incomplete and orphaned files', async () => {
  const initial: BlobDescriptor = await (await put()).json();
  await service.close();
  await Bun.write(join(directory, 'incoming', 'abcdef.part'), 'interrupted');
  await Bun.write(join(directory, 'blobs', '0'.repeat(64)), 'uncommitted');
  service = await createBlossom(config);
  origin = `http://127.0.0.1:${service.server.port}`;
  expect(await (await list()).json()).toEqual([initial]);
  expect(await (await fetch(`${origin}/${hash}`)).bytes()).toEqual(bytes);
  expect(await readdir(join(directory, 'incoming'))).toEqual([]);
  expect(await readdir(join(directory, 'blobs'))).toEqual([hash]);
  await unlink(service.store.path(hash));
  expect((await fetch(`${origin}/${hash}`)).status).toBe(404);
  expect((await put()).status).toBe(200);
  expect(await (await fetch(`${origin}/${hash}`)).bytes()).toEqual(bytes);
});
test('one process owns each data directory and the lock releases on close', async () => {
  await expect(createBlossom(config)).rejects.toThrow('already in use');
  await service.close();
  service = await createBlossom(config);
  expect(service.server.port).toBeGreaterThan(0);
});
test('empty and binary blobs retain their exact hash and length', async () => {
  for (const data of [new Uint8Array(), crypto.getRandomValues(new Uint8Array(65536))]) {
    const result = await uploadBlob({
      origin,
      bytes: data,
      type: 'application/octet-stream',
      signer: owner,
      local: true,
    });
    expect(result.descriptor.size).toBe(data.length);
    expect(result.descriptor.sha256).toBe(await sha256(data));
  }
});
test('fixture upload profile rejects DNS names, remote servers, paths and credentials', () => {
  for (const target of [
    'https://blossom.example',
    'http://localhost',
    'http://127.0.0.1.evil.test',
    'http://127.0.0.1/upload',
    'http://user@127.0.0.1',
  ])
    expect(() => blossomOrigin(target, true)).toThrow();
});
