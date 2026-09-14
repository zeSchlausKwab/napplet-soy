import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { discoveryTarget, type DiscoveryTarget } from '../../protocol/src/discovery';
import { blocked } from '../../moderation/src/policy';

export type DiscoveryState = 'queued' | 'searching' | 'found' | 'missing' | 'failed';
export type DiscoveryJob = { key: string; target: string; state: DiscoveryState; updated: number };

/** Separate bounded inbox: HTTP workers never write the catalog itself. */
export class DiscoveryQueue {
  private db: Database;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new Database(join(directory, 'discovery.sqlite'), { create: true, strict: true });
    this.db.exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS jobs (key TEXT PRIMARY KEY, target TEXT NOT NULL,
        state TEXT NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS budget (minute INTEGER PRIMARY KEY, requests INTEGER NOT NULL);`);
  }
  close() {
    this.db.close();
  }
  get(key: string) {
    return this.db.query<DiscoveryJob, [string]>('SELECT * FROM jobs WHERE key=?').get(key);
  }
  request(input: string, now = Date.now()) {
    const target = discoveryTarget(input);
    if (targetBlocked(target)) throw new Error('This napplet is unavailable');
    return this.db.transaction(() => {
      const old = this.get(target.key);
      if (old && now - old.updated < (['queued', 'searching'].includes(old.state) ? 60000 : 300000))
        return old;
      this.db.run('DELETE FROM jobs WHERE updated<?', [now - 3600000]);
      const minute = Math.floor(now / 60000);
      this.db.run('DELETE FROM budget WHERE minute<?', [minute - 1]);
      this.db.run(
        'INSERT INTO budget VALUES (?, 1) ON CONFLICT(minute) DO UPDATE SET requests=requests+1',
        [minute],
      );
      if (
        this.db
          .query<{ requests: number }, [number]>('SELECT requests FROM budget WHERE minute=?')
          .get(minute)!.requests > 20 ||
        (!old && this.db.query<{ n: number }, []>('SELECT count(*) AS n FROM jobs').get()!.n >= 256)
      )
        throw new Error('Discovery is busy; try again shortly');
      this.db.run('INSERT OR REPLACE INTO jobs VALUES (?, ?, ?, ?)', [
        target.key,
        JSON.stringify(target),
        'queued',
        now,
      ]);
      return this.get(target.key)!;
    })();
  }
  take(now = Date.now()) {
    return this.db.transaction(() => {
      const job = this.db
        .query<DiscoveryJob, [number]>(
          "SELECT * FROM jobs WHERE state='queued' OR (state='searching' AND updated<?) ORDER BY updated LIMIT 1",
        )
        .get(now - 60000);
      if (job) this.finish(job.key, 'searching', now);
      return job;
    })();
  }
  finish(key: string, state: DiscoveryState, now = Date.now()) {
    this.db.run('UPDATE jobs SET state=?, updated=? WHERE key=?', [state, now, key]);
  }
}
export function targetBlocked(target: DiscoveryTarget) {
  return target.type === 'snapshot'
    ? blocked('event', target.id)
    : blocked('address', target.key) || blocked('pubkey', target.key.split(':')[1]);
}
