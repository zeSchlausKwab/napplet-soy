import { Database } from 'bun:sqlite';
import { mkdir, readdir, open, rename, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  BlossomError,
  HASH,
  extension,
  type BlobDescriptor,
} from '../../packages/blossom/src/protocol';

type BlobRow = { hash: string; size: number; type: string; uploaded: number };
export type StoreLimits = {
  maxBlob: number;
  maxTotal: number;
  maxOwner: number;
  maxBlobs: number;
  maxClaims: number;
};
export class BlobStore {
  private db: Database;
  private ownership: Database;
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private constructor(
    readonly directory: string,
    readonly origin: string,
    readonly limits: StoreLimits,
  ) {
    // A separate SQLite transaction holds an OS-managed process lock for this data
    // directory. Crash recovery needs no PID-file deletion or stale-lock guesswork.
    this.ownership = new Database(join(directory, 'process.sqlite'), { create: true });
    try {
      this.ownership.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');
    } catch {
      this.ownership.close();
      throw new Error('Blossom data directory is already in use');
    }
    try {
      this.db = new Database(join(directory, 'index.sqlite'), { create: true, strict: true });
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS blobs(hash TEXT PRIMARY KEY, size INTEGER NOT NULL, type TEXT NOT NULL, uploaded INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS owners(hash TEXT REFERENCES blobs(hash) ON DELETE CASCADE, pubkey TEXT NOT NULL, PRIMARY KEY(hash,pubkey));
        CREATE INDEX IF NOT EXISTS owner_pubkeys ON owners(pubkey);`);
    } catch (error) {
      this.ownership.close();
      throw error;
    }
  }
  static async open(directory: string, origin: string, limits: StoreLimits) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const store = new BlobStore(directory, origin, limits);
    try {
      await mkdir(join(directory, 'blobs'), { recursive: true, mode: 0o700 });
      await mkdir(join(directory, 'incoming'), { recursive: true, mode: 0o700 });
      // Before accepting requests, remove only uncommitted files owned by this store.
      for (const file of await readdir(join(directory, 'incoming')))
        if (/^[a-f0-9-]+\.part$/.test(file)) await unlink(join(directory, 'incoming', file));
      for (const file of await readdir(join(directory, 'blobs')))
        if (HASH.test(file) && !store.lookup(file)) await unlink(store.path(file));
      await store.syncDirectory('.');
      return store;
    } catch (error) {
      store.close();
      throw error;
    }
  }
  path(hash: string) {
    if (!HASH.test(hash)) throw new BlossomError(400, 'Invalid blob hash');
    return join(this.directory, 'blobs', hash);
  }
  lookup(hash: string) {
    return this.db.query<BlobRow, [string]>('SELECT * FROM blobs WHERE hash=?').get(hash);
  }
  owners(hash: string) {
    return this.db
      .query<{ pubkey: string }, [string]>('SELECT pubkey FROM owners WHERE hash=?')
      .all(hash)
      .map((row) => row.pubkey);
  }
  private owns(pubkey: string, hash: string) {
    return !!this.db.query('SELECT 1 FROM owners WHERE pubkey=? AND hash=?').get(pubkey, hash);
  }
  descriptor(row: BlobRow): BlobDescriptor {
    return {
      url: `${this.origin}/${row.hash}.${extension(row.type)}`,
      sha256: row.hash,
      size: row.size,
      type: row.type,
      uploaded: row.uploaded,
    };
  }
  checkQuota(pubkey: string, hash: string, size: number) {
    if (size > this.limits.maxBlob) throw new BlossomError(413, 'Blob exceeds size limit');
    const existing = this.lookup(hash);
    if (!existing) {
      const usage = this.db
        .query<{ bytes: number; count: number }, []>(
          'SELECT COALESCE(SUM(size),0) AS bytes,COUNT(*) AS count FROM blobs',
        )
        .get()!;
      if (usage.bytes + size > this.limits.maxTotal || usage.count >= this.limits.maxBlobs)
        throw new BlossomError(507, 'Server storage quota reached');
    }
    if (!this.owns(pubkey, hash)) {
      const usage = this.db
        .query<{ bytes: number; count: number }, [string]>(
          'SELECT COALESCE(SUM(b.size),0) AS bytes,COUNT(*) AS count FROM blobs b JOIN owners o ON b.hash=o.hash WHERE o.pubkey=?',
        )
        .get(pubkey)!;
      const claims = this.db
        .query<{ count: number }, []>('SELECT COUNT(*) AS count FROM owners')
        .get()!.count;
      if (
        usage.bytes + size > this.limits.maxOwner ||
        usage.count >= 1000 ||
        claims >= this.limits.maxClaims
      )
        throw new BlossomError(403, 'Upload ownership quota reached');
    }
  }
  private async serial<T>(operation: () => Promise<T>) {
    if (this.closed) throw new BlossomError(503, 'Storage is shutting down');
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {});
    return result;
  }
  /** Bytes reach a synced temporary file before entering the serialized metadata commit. */
  async upload(request: Request, pubkey: string, expected: string, size: number, type: string) {
    const temporary = join(this.directory, 'incoming', `${randomUUID()}.part`);
    const handle = await open(temporary, 'wx', 0o600);
    const hash = createHash('sha256');
    let received = 0;
    const reader = request.body?.getReader();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20000)]);
    let abort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      abort = () => {
        reject(new BlossomError(408, 'Upload timed out or was cancelled'));
        void reader?.cancel().catch(() => {});
      };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
    // Rejection may happen during a disk write; retain a handler until the next race.
    void aborted.catch(() => {});
    try {
      if (reader)
        while (true) {
          const part = await Promise.race([reader.read(), aborted]);
          if (part.done) break;
          received += part.value.byteLength;
          if (received > size || received > this.limits.maxBlob)
            throw new BlossomError(413, 'Upload exceeds declared size');
          hash.update(part.value);
          await handle.writeFile(part.value);
        }
      if (signal.aborted) throw new BlossomError(408, 'Upload cancelled');
      if (received !== size) throw new BlossomError(400, 'Upload length mismatch');
      if (hash.digest('hex') !== expected) throw new BlossomError(409, 'Upload hash mismatch');
      await handle.sync();
      return await this.serial(async () => {
        this.checkQuota(pubkey, expected, size);
        const previous = this.lookup(expected);
        // All mutations share this queue. Rename can safely repair a missing or
        // corrupt existing file with the newly verified exact same hash bytes.
        await rename(temporary, this.path(expected));
        await this.syncDirectory('blobs');
        const row: BlobRow = previous ?? {
          hash: expected,
          size,
          type,
          uploaded: Math.floor(Date.now() / 1000),
        };
        try {
          this.db.transaction(() => {
            this.db
              .query('INSERT OR IGNORE INTO blobs(hash,size,type,uploaded) VALUES (?,?,?,?)')
              .run(row.hash, row.size, row.type, row.uploaded);
            this.db
              .query('INSERT OR IGNORE INTO owners(hash,pubkey) VALUES (?,?)')
              .run(expected, pubkey);
          })();
        } catch (error) {
          if (!previous) await unlink(this.path(expected));
          throw error;
        }
        return { descriptor: this.descriptor(row), created: !previous };
      });
    } finally {
      signal.removeEventListener('abort', abort);
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
      await handle.close();
      await unlink(temporary).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
  async remove(pubkey: string, hash: string) {
    return this.serial(async () => {
      if (!this.lookup(hash)) throw new BlossomError(404, 'Blob not found');
      if (!this.owns(pubkey, hash))
        throw new BlossomError(403, 'Only an uploader can remove their blob');
      const removeBytes = this.db.transaction(() => {
        this.db.query('DELETE FROM owners WHERE hash=? AND pubkey=?').run(hash, pubkey);
        if (this.db.query('SELECT 1 FROM owners WHERE hash=? LIMIT 1').get(hash)) return false;
        this.db.query('DELETE FROM blobs WHERE hash=?').run(hash);
        return true;
      })();
      // Hide the row first. A crash before unlink leaves a harmless orphan, which
      // startup cleans. Never leave a committed descriptor pointing at deleted bytes.
      if (removeBytes) {
        await unlink(this.path(hash)).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
        await this.syncDirectory('blobs');
      }
    });
  }
  list(pubkey: string, limit: number, cursor?: string) {
    const after = cursor
      ? this.db
          .query<BlobRow, [string, string]>(
            'SELECT b.* FROM blobs b JOIN owners o ON b.hash=o.hash WHERE o.pubkey=? AND b.hash=?',
          )
          .get(pubkey, cursor)
      : null;
    if (cursor && !after) throw new BlossomError(400, 'Unknown list cursor');
    return this.db
      .query<BlobRow, [string, number, number, string, number]>(
        `SELECT b.* FROM blobs b JOIN owners o ON b.hash=o.hash WHERE o.pubkey=? AND (b.uploaded<? OR (b.uploaded=? AND b.hash>?)) ORDER BY b.uploaded DESC,b.hash ASC LIMIT ?`,
      )
      .all(
        pubkey,
        after?.uploaded ?? Number.MAX_SAFE_INTEGER,
        after?.uploaded ?? Number.MAX_SAFE_INTEGER,
        after?.hash ?? '',
        limit,
      )
      .map((row) => this.descriptor(row));
  }
  async available(row: BlobRow) {
    try {
      return (await stat(this.path(row.hash))).size === row.size;
    } catch {
      return false;
    }
  }
  private async syncDirectory(name: string) {
    const directory = await open(join(this.directory, name), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  async drain() {
    await this.tail;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
    this.ownership.close();
  }
}
