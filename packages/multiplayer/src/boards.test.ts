import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { encodeAddress } from '../../protocol/src';
import { Boards, boardAuthorization } from './boards';
import { Rooms } from './rooms';
import { Database } from 'bun:sqlite';

test('score and attachment remain one winning run through retries, new records and restarts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-board-data-'));
  const key = generateSecretKey(),
    provider = 'a'.repeat(64),
    actor = 'b'.repeat(64);
  const definition = {
    napplet: encodeAddress({ kind: 35129, pubkey: getPublicKey(key), identifier: 'racer' }),
    board: 'track-classic-v1',
    title: 'Fastest',
    order: 'lowest' as const,
    minimum: 1,
    maximum: 100000,
    dataSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['car'],
      properties: { car: { type: 'string', maxLength: 40 } },
    },
  };
  const ref = { napplet: definition.napplet, board: definition.board };
  const authorization = finalizeEvent(boardAuthorization(provider, actor, definition), key);
  const file = join(root, 'scores.sqlite');
  let boards = new Boards(file, provider);
  try {
    expect(() =>
      boards.register(actor, {
        definition: { ...definition, dataSchema: { type: 'object' } },
        authorization,
      }),
    ).toThrow('signature');
    boards.register(actor, { definition, authorization });
    const best = boards.submit(actor, { ...ref, score: 42, data: { car: 'first' } }).own!;
    expect(best.hasData).toBe(true);
    expect(best).not.toHaveProperty('data');
    for (const score of [42, 50]) {
      boards.submit(actor, { ...ref, score, data: { car: 'ignored' } });
      expect(boards.read(actor, ref).own).toEqual(best);
      expect(boards.entry({ ...ref, actor, revision: best.revision }).entry).toMatchObject({
        score: 42,
        data: { car: 'first' },
      });
    }
    expect(() => boards.submit(actor, { ...ref, score: 1, data: { car: 42 } })).toThrow('data.car');
    expect(boards.read(actor, ref).own).toEqual(best);
    boards.submit(actor, { ...ref, score: 40, data: { car: 'improved' } });
    expect(boards.entry({ ...ref, actor, revision: best.revision })).toMatchObject({
      stale: true,
      entry: null,
    });
    const current = boards.entry({ ...ref, actor });
    expect(current.entry).toMatchObject({ score: 40, data: { car: 'improved' } });
    boards.close();
    boards = new Boards(file, provider);
    expect(boards.entry({ ...ref, actor })).toEqual(current);
    boards.register(actor, { definition, authorization });
    expect(boards.entry({ ...ref, actor })).toEqual(current);
    expect(boards.entry({ ...ref, actor: 'c'.repeat(64) })).toMatchObject({
      entry: null,
      stale: false,
    });
    const other = { ...definition, board: 'track-live-v1' };
    boards.provision(other);
    expect(boards.entry({ ...ref, board: other.board, actor }).entry).toBeNull();
    const changed = { ...definition, dataSchema: { type: 'object' } };
    expect(() =>
      boards.register(actor, {
        definition: changed,
        authorization: finalizeEvent(boardAuthorization(provider, actor, changed), key),
      }),
    ).toThrow('immutable');
  } finally {
    boards.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('existing SQLite scores migrate without resetting boards or scores', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-board-migrate-'));
  const file = join(root, 'scores.sqlite');
  const definition = {
    napplet: encodeAddress({ kind: 35129, pubkey: 'a'.repeat(64), identifier: 'legacy' }),
    board: 'old',
    title: 'Legacy',
    order: 'highest' as const,
    minimum: 0,
    maximum: 100,
  };
  const board = `35129:${'a'.repeat(64)}:legacy/old`,
    actor = 'b'.repeat(64);
  const db = new Database(file);
  db.exec(
    'CREATE TABLE boards (key TEXT PRIMARY KEY, definition TEXT NOT NULL); CREATE TABLE scores (board TEXT NOT NULL, actor TEXT NOT NULL, score REAL NOT NULL, name TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(board, actor));',
  );
  db.query('INSERT INTO boards VALUES (?, ?)').run(
    board,
    JSON.stringify({ ...definition, napplet: board.slice(0, -4) }),
  );
  db.query('INSERT INTO scores VALUES (?, ?, ?, ?, ?)').run(board, actor, 12, 'Legacy player', 123);
  db.close();
  let boards = new Boards(file);
  try {
    boards.provision(definition);
    const ref = { napplet: definition.napplet, board: 'old' };
    const migrated = boards.entry({ ...ref, actor }).entry!;
    expect(migrated).toMatchObject({ score: 12, data: null, updated: 123 });
    expect(migrated.revision).toMatch(/^[a-f0-9]{32}$/);
    boards.close();
    boards = new Boards(file);
    expect(boards.entry({ ...ref, actor }).entry).toEqual(migrated);
    boards.submit(actor, { ...ref, score: 15 });
    expect(boards.read(actor, ref).own).toMatchObject({ score: 15, hasData: false });
    expect(() => boards.submit(actor, { ...ref, score: 16, data: {} })).toThrow('no dataSchema');
  } finally {
    boards.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('leaderboard pages stay bounded with maximum attachments and escaped display names', () => {
  const boards = new Boards();
  const definition = {
    napplet: encodeAddress({ kind: 35129, pubkey: 'a'.repeat(64), identifier: 'large' }),
    board: 'all',
    title: 'Scores',
    order: 'highest' as const,
    minimum: 0,
    maximum: 1000,
    dataSchema: { type: 'object' },
  };
  const ref = { napplet: definition.napplet, board: 'all' };
  try {
    boards.provision(definition);
    for (let i = 0; i < 100; i++)
      boards.submit(i.toString(16).padStart(64, '0'), {
        ...ref,
        score: i,
        name: '\u0000'.repeat(40),
        data: { text: 'x'.repeat(8181) },
      });
    const actors: string[] = [];
    let offset: number | null = 0;
    do {
      const result = boards.read('0'.repeat(64), { ...ref, limit: 100, offset });
      const wire = JSON.stringify({
        structuredContent: result,
        content: [{ type: 'text', text: JSON.stringify(result) }],
      });
      expect(Buffer.byteLength(wire)).toBeLessThan(65535);
      expect(result.rows.every((row) => row.hasData && !('data' in row))).toBe(true);
      actors.push(...result.rows.map((row) => row.actor));
      offset = result.nextOffset;
    } while (offset !== null);
    expect(actors).toHaveLength(100);
    expect(new Set(actors).size).toBe(100);
  } finally {
    boards.close();
  }
});

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
