import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { encodeAddress } from '../../protocol/src';
import { Boards, boardAuthorization } from './boards';
import { Rooms } from './rooms';

test('board registration proves creator, provider and caller; retries and restart preserve best scores', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-board-'));
  const secret = generateSecretKey(),
    owner = getPublicKey(secret),
    provider = 'a'.repeat(64),
    actor = 'b'.repeat(64);
  const definition = {
    napplet: encodeAddress({ kind: 35129, pubkey: owner, identifier: 'test' }),
    board: 'season-1',
    title: 'Score',
    order: 'highest' as const,
    minimum: 0,
    maximum: 10000,
  };
  const proof = finalizeEvent(boardAuthorization(provider, actor, definition), secret);
  let boards = new Boards(join(root, 'boards.sqlite'), provider);
  try {
    expect(() => boards.register(owner, { definition, authorization: proof })).toThrow('signature');
    expect(() =>
      boards.register(actor, {
        definition: { ...definition, maximum: 20000 },
        authorization: proof,
      }),
    ).toThrow('signature');
    const registered = boards.register(actor, { definition, authorization: proof });
    expect(boards.register(actor, { definition, authorization: proof })).toEqual(registered);

    const ref = { napplet: definition.napplet, board: definition.board };
    boards.submit(actor, { ...ref, score: 20, name: 'Guest' });
    boards.submit(actor, { ...ref, score: 10, name: 'Ignored' });
    boards.submit(actor, { ...ref, score: 20, name: 'Ignored retry' });
    expect(boards.read(actor, ref).rows).toHaveLength(1);
    expect(boards.read(actor, ref).own).toMatchObject({ score: 20, name: 'Guest' });
    expect(() => boards.submit(actor, { ...ref, score: 1e10 })).toThrow('range');
    boards.close();
    boards = new Boards(join(root, 'boards.sqlite'), provider);
    expect(boards.read(actor, ref).own).toMatchObject({ score: 20 });
    const changed = { ...definition, order: 'lowest' as const };
    expect(() =>
      boards.register(actor, {
        definition: changed,
        authorization: finalizeEvent(boardAuthorization(provider, actor, changed), secret),
      }),
    ).toThrow('immutable');
    const remix = {
      ...definition,
      napplet: encodeAddress({
        kind: 35129,
        pubkey: getPublicKey(generateSecretKey()),
        identifier: 'test',
      }),
    };
    expect(() =>
      boards.register(actor, {
        definition: remix,
        authorization: finalizeEvent(boardAuthorization(provider, actor, remix), secret),
      }),
    ).toThrow('signature');
  } finally {
    boards.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('named rooms keep remaining members, bound admission, separate protocols and expire leases', () => {
  let now = 100000;
  const service = new Rooms(() => now, 2, 3);
  const napplet = encodeAddress({ kind: 35129, pubkey: 'a'.repeat(64), identifier: 'room' });
  const args = { napplet, protocol: 'game-v1', capacity: 3, name: 'Friends', listed: true };
  const room = service.create('a', args);
  service.access('b', { room: room.room }, true);
  service.access('c', { room: room.room }, true);
  expect(() => service.access('d', { room: room.room }, true)).toThrow('full');
  service.leave('a', { room: room.room });
  expect(service.access('b', { room: room.room }, false).peers).toEqual(['b', 'c']);
  expect(service.list({ napplet, protocol: 'game-v2' }).rooms).toHaveLength(0);
  now += 61000;
  expect(service.list({ napplet, protocol: 'game-v1' }).rooms).toHaveLength(0);
});
