import { Database } from 'bun:sqlite';
import { z } from 'zod';
import { verifyEvent, type NostrEvent } from 'nostr-tools';
import { decodeAddress, identityAddress } from '../../protocol/src';

import {
  boardRef,
  boardDefinition,
  boardRegister,
  boardSubmit,
  boardRead,
  boardAuthorization,
  type BoardDefinition,
} from './contracts';
export { boardRegister, boardSubmit, boardRead, boardAuthorization } from './contracts';

function reference(input: z.infer<typeof boardRef>) {
  const address = decodeAddress(input.napplet);
  return { owner: address.pubkey, key: `${identityAddress(address)}/${input.board}` };
}

/** Casual, client-reported personal bests. No score is represented as server-validated gameplay. */
export class Boards {
  private db: Database;
  constructor(
    path = ':memory:',
    private provider = '',
    private now = Date.now,
    private maxBoards = 1000,
    private maxPlayers = 1000,
  ) {
    this.db = new Database(path, { create: true });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS boards (key TEXT PRIMARY KEY, definition TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scores (board TEXT NOT NULL, actor TEXT NOT NULL, score REAL NOT NULL, name TEXT NOT NULL,
        updated INTEGER NOT NULL, PRIMARY KEY(board, actor));`);
  }
  register(actor: string, input: unknown) {
    const { definition, authorization } = boardRegister.parse(input);
    if (definition.minimum > definition.maximum) throw new Error('Invalid score range');
    const { owner, key } = reference(definition);
    const proof = authorization as NostrEvent;
    const expected = boardAuthorization(this.provider, actor, definition, this.now());
    try {
      if (
        !verifyEvent(proof) ||
        proof.pubkey !== owner ||
        proof.kind !== expected.kind ||
        Math.abs(proof.created_at - expected.created_at) > 300 ||
        proof.content !== expected.content ||
        JSON.stringify(proof.tags) !== JSON.stringify(expected.tags)
      )
        throw new Error();
    } catch {
      throw new Error('Creator signature required for this provider, caller and board definition');
    }
    return this.provision(definition);
  }
  /** Operator-only bootstrap for an isolated local preview; never exposed as an MCP tool. */
  provision(definition: BoardDefinition) {
    definition = boardDefinition.parse(definition);
    if (definition.minimum > definition.maximum) throw new Error('Invalid score range');
    const { key } = reference(definition);
    const canonical = JSON.stringify({
      ...definition,
      napplet: identityAddress(decodeAddress(definition.napplet)),
    });
    this.db.transaction(() => {
      const existing = this.db
        .query<{ definition: string }, [string]>('SELECT definition FROM boards WHERE key=?')
        .get(key);
      if (existing) {
        if (existing.definition !== canonical)
          throw new Error(
            'Board rules are immutable; use a new board ID for a new season or rules',
          );
        return;
      }
      if (
        this.db.query<{ count: number }, []>('SELECT count(*) AS count FROM boards').get()!.count >=
        this.maxBoards
      )
        throw new Error('Board capacity reached');
      this.db.query('INSERT INTO boards VALUES (?, ?)').run(key, canonical);
    })();
    return { version: 1, board: key, trust: 'client-reported' };
  }
  private definition(key: string) {
    const row = this.db
      .query<{ definition: string }, [string]>('SELECT definition FROM boards WHERE key=?')
      .get(key);
    if (!row)
      throw new Error('Board is not registered. Run soyli backend sync with the creator identity.');
    return JSON.parse(row.definition) as BoardDefinition;
  }
  submit(actor: string, input: unknown) {
    const args = boardSubmit.parse(input),
      { key } = reference(args),
      definition = this.definition(key);
    if (args.score < definition.minimum || args.score > definition.maximum)
      throw new Error('Score outside board range');
    this.db.transaction(() => {
      const previous = this.db
        .query<{ score: number }, [string, string]>(
          'SELECT score FROM scores WHERE board=? AND actor=?',
        )
        .get(key, actor);
      if (
        previous &&
        (definition.order === 'highest'
          ? previous.score >= args.score
          : previous.score <= args.score)
      )
        return;
      if (
        !previous &&
        this.db
          .query<{ count: number }, [string]>('SELECT count(*) AS count FROM scores WHERE board=?')
          .get(key)!.count >= this.maxPlayers
      )
        throw new Error('Board player capacity reached');
      this.db
        .query(
          'INSERT INTO scores VALUES (?, ?, ?, ?, ?) ON CONFLICT(board,actor) DO UPDATE SET score=excluded.score,name=excluded.name,updated=excluded.updated',
        )
        .run(key, actor, args.score, args.name, this.now());
    })();
    return this.read(actor, { napplet: args.napplet, board: args.board, limit: 20 });
  }
  read(actor: string, input: unknown) {
    const args = boardRead.parse(input),
      { key } = reference(args),
      definition = this.definition(key);
    const order = definition.order === 'highest' ? 'DESC' : 'ASC';
    const rows = this.db
      .query(
        `SELECT actor,score,name,updated FROM scores WHERE board=? ORDER BY score ${order},updated ASC,actor ASC LIMIT ?`,
      )
      .all(key, args.limit);
    const own = this.db
      .query('SELECT actor,score,name,updated FROM scores WHERE board=? AND actor=?')
      .get(key, actor);
    return {
      version: 1,
      board: key,
      title: definition.title,
      order: definition.order,
      trust: 'client-reported',
      rows,
      own,
    };
  }
  close() {
    this.db.close();
  }
}
