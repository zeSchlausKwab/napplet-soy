import { validatedVideo } from '../../protocol/src/preview-video';
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { verifiedEvent, type SignedEvent } from '../../protocol/src';
import { publicNapplet, type PublicNapplet } from './public-model';
import { validatedPreview } from '../../protocol/src/preview';
import { missingDomains } from '../../runtime/src/capabilities';

// NIP-01 replacement comes before NIP-5D package admission. An invalid new
// package still replaces the old package; duplicate/missing d tags cannot revive it.
export function manifestKey(event: SignedEvent) {
  if (event.kind === 5129) return event.id;
  if (event.kind === 15129) return `15129:${event.pubkey}:`;
  if (event.kind === 35129)
    return `35129:${event.pubkey}:${event.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`;
  throw new Error('Not a napplet manifest');
}
export const newerManifest = (a: SignedEvent, b: SignedEvent) =>
  a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);
export type IndexRow = {
  key: string;
  id: string;
  event: string;
  projection: string | null;
  retry_at: number;
  preview_at: number;
};

/** One durable projection shared by the worker and read-only web processes. */
export class IndexStore {
  private db: Database;
  constructor(
    readonly directory: string,
    readonly writable = false,
  ) {
    if (writable) mkdirSync(directory, { recursive: true });
    this.db = new Database(join(directory, 'catalog.sqlite'), {
      readonly: !writable,
      create: writable,
      strict: true,
    });
    this.db.exec('PRAGMA busy_timeout=5000');
    if (writable) {
      this.db.exec(`PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS records (
          key TEXT PRIMARY KEY, id TEXT UNIQUE NOT NULL, event TEXT NOT NULL,
          projection TEXT, retry_at INTEGER NOT NULL DEFAULT 0,
          preview_at INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS deletions (target TEXT NOT NULL, author TEXT NOT NULL,
          at INTEGER NOT NULL, PRIMARY KEY(target, author));
        CREATE INDEX IF NOT EXISTS artifact_hash ON records(json_extract(projection, '$.artifactHash'));`);
    }
  }
  close() {
    this.db.close();
  }
  rows() {
    return this.db.query<IndexRow, []>('SELECT * FROM records').all();
  }
  administrationRows() {
    return this.db
      .query<IndexRow, []>(
        `SELECT * FROM records
      ORDER BY json_extract(event, '$.created_at') DESC, id ASC LIMIT 2000`,
      )
      .all();
  }
  recent() {
    return this.db
      .query<IndexRow, []>(
        `SELECT * FROM records
    ORDER BY json_extract(event, '$.created_at') DESC, id ASC LIMIT 200`,
      )
      .all();
  }
  artifactRows(hash: string) {
    return this.db
      .query<IndexRow, [string]>(
        `SELECT * FROM records
      WHERE json_extract(projection, '$.artifactHash')=?`,
      )
      .all(hash);
  }
  due(now: number) {
    return this.db
      .query<IndexRow, [number, number]>(
        `SELECT * FROM records
      WHERE retry_at<=? OR preview_at<=? ORDER BY retry_at, id LIMIT 12`,
      )
      .all(now, now);
  }
  references() {
    return this.db
      .query<{ hash: string | null; preview: string | null; video: string | null }, []>(
        `SELECT
      json_extract(projection, '$.artifactHash') AS hash,
      json_extract(projection, '$.preview.hash') AS preview, json_extract(projection, '$.video.hash') AS video FROM records`,
      )
      .all();
  }
  invalidate() {
    this.db.exec('UPDATE records SET retry_at=0, preview_at=0');
  }
  removed(event: SignedEvent) {
    const expiry = event.tags.find((t) => t[0] === 'expiration')?.[1];
    if (expiry && /^\d+$/.test(expiry) && Number(expiry) <= Date.now() / 1000) return true;
    return !!this.db
      .query<{ target: string }, [string, string, string, number]>(
        'SELECT target FROM deletions WHERE (target=? OR target=?) AND author=? AND at>=? LIMIT 1',
      )
      .get(event.id, manifestKey(event), event.pubkey, event.created_at);
  }
  row(key: string) {
    return this.db.query<IndexRow, [string]>('SELECT * FROM records WHERE key=?').get(key);
  }
  revision(id: string) {
    return this.db.query<IndexRow, [string]>('SELECT * FROM records WHERE id=?').get(id);
  }
  state<T>(key: string): T | null {
    const row = this.db
      .query<{ value: string }, [string]>('SELECT value FROM state WHERE key=?')
      .get(key);
    return row ? (JSON.parse(row.value) as T) : null;
  }
  setState(key: string, value: unknown) {
    this.db.run('INSERT OR REPLACE INTO state VALUES (?, ?)', [key, JSON.stringify(value)]);
  }
  admit(input: unknown, now = Date.now()) {
    const event = verifiedEvent(input);
    if (event.created_at > now / 1000 + 600) throw new Error('Future event');
    if (event.kind === 5) {
      // Authenticated deletion markers are retained even when their target arrives later.
      const targets = [
        ...new Set(
          event.tags
            .filter(
              (t) =>
                (t[0] === 'e' && /^[a-f0-9]{64}$/.test(t[1])) ||
                (t[0] === 'a' && t[1]?.startsWith(`35129:${event.pubkey}:`)) ||
                (t[0] === 'a' && t[1] === `15129:${event.pubkey}:`),
            )
            .map((t) => t[1]),
        ),
      ];
      this.db.transaction(() => {
        for (const target of targets)
          this.db.run(
            `INSERT INTO deletions VALUES (?, ?, ?)
          ON CONFLICT(target, author) DO UPDATE SET at=max(at, excluded.at)`,
            [target, event.pubkey, event.created_at],
          );
        if (
          this.db.query<{ n: number }, []>('SELECT count(*) AS n FROM deletions').get()!.n > 10000
        )
          throw new Error('Index deletion capacity reached (10000)');
      })();
      return targets.length > 0;
    }
    const key = manifestKey(event);
    return this.db.transaction(() => {
      const old = this.row(key);
      if (old && !newerManifest(event, JSON.parse(old.event))) return false;
      if (
        !old &&
        this.db.query<{ n: number }, []>('SELECT count(*) AS n FROM records').get()!.n >= 10000
      )
        throw new Error(
          'Index event capacity reached (10000); increase capacity before continuing',
        );
      this.db.run(
        `INSERT INTO records (key, id, event) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET id=excluded.id, event=excluded.event,
        projection=NULL, retry_at=0, preview_at=0`,
        [key, event.id, JSON.stringify(event)],
      );
      return true;
    })();
  }
  project(id: string, entry: PublicNapplet | null, retryAt: number, previewAt: number) {
    this.db.run('UPDATE records SET projection=?, retry_at=?, preview_at=? WHERE id=?', [
      entry ? JSON.stringify(entry) : null,
      retryAt,
      previewAt,
      id,
    ]);
  }
}

// Re-derive signed data at the trust boundary. Disk metadata cannot change the
// author, artifact, capability requirements, or linked preview descriptor.
export async function indexedProjection(row: IndexRow, relays: string[]) {
  try {
    const entry = await publicNapplet(JSON.parse(row.event), relays);
    if (row.id !== entry.revisionId || row.key !== manifestKey(entry.manifest)) return null;
    const saved = row.projection ? (JSON.parse(row.projection) as PublicNapplet) : null;
    if (saved?.revisionId === entry.revisionId && saved.artifactHash === entry.artifactHash) {
      entry.bytes = saved.bytes;
      entry.video = validatedVideo(entry.manifest, saved.video);
      entry.preview = validatedPreview(entry.manifest, saved.preview);
      entry.availability = missingDomains(entry.domains).length
        ? 'host-required'
        : saved.availability === 'ready'
          ? 'ready'
          : 'unavailable';
    }
    return entry;
  } catch {
    return null;
  }
}
