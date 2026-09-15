import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  decodeAddress,
  encodeAddress,
  identityAddress,
  type SignedEvent,
} from '../../protocol/src';

export class CommunityError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export type Alias = {
  handle: string;
  slug: string;
  address: string;
  naddr: string;
  pubkey: string;
};
export class CommunityStore {
  readonly db: Database;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new Database(join(directory, 'community.sqlite'), { create: true });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS handles(handle TEXT PRIMARY KEY, pubkey TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS aliases(handle TEXT NOT NULL, slug TEXT NOT NULL, address TEXT NOT NULL, naddr TEXT NOT NULL, pubkey TEXT NOT NULL, PRIMARY KEY(handle,slug));
      CREATE INDEX IF NOT EXISTS aliases_address ON aliases(address);
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS social_events(id TEXT NOT NULL, scope TEXT NOT NULL, created INTEGER NOT NULL, event TEXT NOT NULL, PRIMARY KEY(scope,id));
      CREATE INDEX IF NOT EXISTS social_scope_v2 ON social_events(scope,created);
      CREATE INDEX IF NOT EXISTS social_recent ON social_events(created DESC,id);
      CREATE TABLE IF NOT EXISTS profiles(pubkey TEXT PRIMARY KEY, id TEXT NOT NULL, created INTEGER NOT NULL, event TEXT NOT NULL);
    `);
  }
  close() {
    this.db.close();
  }
  profile(pubkey: string): SignedEvent | null {
    const row = this.db.query('SELECT event FROM profiles WHERE pubkey=?').get(pubkey) as {
      event: string;
    } | null;
    return row ? JSON.parse(row.event) : null;
  }
  putProfile(event: SignedEvent) {
    const result = this.db.run(
      `INSERT INTO profiles VALUES(?,?,?,?) ON CONFLICT(pubkey) DO UPDATE SET
      id=excluded.id,created=excluded.created,event=excluded.event
      WHERE excluded.created>profiles.created OR (excluded.created=profiles.created AND excluded.id<profiles.id)`,
      [event.pubkey, event.id, event.created_at, JSON.stringify(event)],
    );
    if (result.changes)
      this.db.exec(
        'DELETE FROM profiles WHERE rowid IN (SELECT rowid FROM profiles ORDER BY created DESC,id LIMIT -1 OFFSET 10000)',
      );
  }
  aliases(address: string) {
    return this.db
      .query('SELECT * FROM aliases WHERE address=? ORDER BY handle,slug')
      .all(address) as Alias[];
  }
  creator(handle: string) {
    return this.db
      .query('SELECT * FROM aliases WHERE handle=? ORDER BY slug')
      .all(handle) as Alias[];
  }
  lookup(handle: string, slug: string) {
    return this.db
      .query('SELECT * FROM aliases WHERE handle=? AND slug=?')
      .get(handle, slug) as Alias | null;
  }
  claim(handle: string, slug: string, naddr: string, pubkey: string, nonce: string, now: number) {
    if (
      !/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/.test(handle) ||
      handle.length < 3 ||
      !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)
    )
      throw new CommunityError(
        'Use 3–32 characters for handles and 1–64 for slugs: lowercase letters, numbers and internal hyphens.',
      );
    if (['admin', 'space-lab', 'napplet', 'support', 'system', 'moderator'].includes(handle))
      throw new CommunityError('This handle is reserved.', 409);
    const identity = decodeAddress(naddr),
      address = identityAddress(identity);
    if (identity.pubkey !== pubkey)
      throw new CommunityError('Only the napplet author can claim its URL.', 403);
    const normalized = encodeAddress(identity);
    return this.db.transaction(() => {
      this.db.run('DELETE FROM requests WHERE expires < ?', [now]);
      if (this.db.query('SELECT id FROM requests WHERE id=?').get(nonce))
        throw new CommunityError('This signed request was already used.', 409);
      const owner = this.db.query('SELECT pubkey FROM handles WHERE handle=?').get(handle) as {
        pubkey: string;
      } | null;
      const existingHandle = this.db
        .query('SELECT handle FROM handles WHERE pubkey=?')
        .get(pubkey) as { handle: string } | null;
      if (
        (owner && owner.pubkey !== pubkey) ||
        (existingHandle && existingHandle.handle !== handle)
      )
        throw new CommunityError(
          'The handle is taken, or this account already has another handle.',
          409,
        );
      const old = this.lookup(handle, slug);
      if (old && old.address !== address)
        throw new CommunityError('This URL is permanently attached to another napplet.', 409);
      if (
        !old &&
        (this.creator(handle).length >= 128 ||
          (this.db.query('SELECT COUNT(*) AS n FROM aliases').get() as { n: number }).n >= 20000)
      )
        throw new CommunityError('The name registry limit has been reached.', 429);
      this.db.run('INSERT OR IGNORE INTO handles VALUES(?,?)', [handle, pubkey]);
      this.db.run('INSERT OR IGNORE INTO aliases VALUES(?,?,?,?,?)', [
        handle,
        slug,
        address,
        normalized,
        pubkey,
      ]);
      this.db.run('INSERT INTO requests VALUES(?,?)', [nonce, now + 120]);
      return this.lookup(handle, slug)!;
    })();
  }
  events(scope: string) {
    return (
      this.db
        .query('SELECT event FROM social_events WHERE scope=? ORDER BY created DESC,id LIMIT 2000')
        .all(scope) as { event: string }[]
    ).map((row) => JSON.parse(row.event) as SignedEvent);
  }
  put(scope: string, events: SignedEvent[]) {
    this.db.transaction(() => {
      const insert = this.db.prepare('INSERT OR IGNORE INTO social_events VALUES(?,?,?,?)');
      for (const e of events) insert.run(e.id, scope, e.created_at, JSON.stringify(e));
      // This is a bounded relay cache, not the authoritative event archive.
      this.db.run(
        'DELETE FROM social_events WHERE scope=? AND id NOT IN (SELECT id FROM social_events WHERE scope=? ORDER BY created DESC,id LIMIT 2000)',
        [scope, scope],
      );
      this.db.exec(
        'DELETE FROM social_events WHERE rowid IN (SELECT rowid FROM social_events ORDER BY created DESC,id LIMIT -1 OFFSET 50000)',
      );
    })();
  }
}
let cached: { directory: string; store: CommunityStore } | undefined;
export function communityStore() {
  const directory = process.env.SPACE_COMMUNITY_DIR;
  if (!directory)
    throw new CommunityError(
      'Community services are not configured. Restart with bun run dev after updating.',
      503,
    );
  if (cached?.directory !== directory) {
    cached?.store.close();
    cached = { directory, store: new CommunityStore(directory) };
  }
  return cached.store;
}
