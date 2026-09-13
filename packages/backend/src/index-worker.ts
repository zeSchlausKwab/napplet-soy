import { manifestBlocked } from '../../moderation/src/policy';
import { Database } from 'bun:sqlite';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PublicationRelays } from '../../publish/src/relay';
import { MAX_ARTIFACT_BYTES, sha256 } from '../../protocol/src';
import { validateManifest } from '../../protocol/src/manifest';
import { PREVIEW_PROFILE } from '../../protocol/src/preview';
import { RUNTIME_PROFILE, missingDomains } from '../../runtime/src/capabilities';
import { downloadArtifact } from './blossom';
import { discoverPreviewMetadata } from './preview-discovery';
import { indexPreviewImages } from './preview-images';
import { IndexStore, indexedProjection } from './index-store';

export type IndexConfig = {
  directory: string;
  relays: string[];
  hints?: string[];
  localBlossom?: string;
  release: string;
};
export function indexConfig(env = process.env): IndexConfig {
  if (!env.SPACE_INDEX_DIR) throw new Error('SPACE_INDEX_DIR is required');
  const relays = [...new Set((env.SPACE_INDEX_RELAYS ?? '').split(',').filter(Boolean))];
  if (!relays.length || relays.length > 8) throw new Error('Configure 1–8 index relays');
  const hints = env.SPACE_INDEX_HINTS
    ? [...new Set(env.SPACE_INDEX_HINTS.split(',').filter(Boolean))]
    : relays;
  if (!hints.length || hints.length > 8) throw new Error('Configure 1–8 relay hints');
  for (const value of [...relays, ...hints]) {
    const u = new URL(value);
    if (
      u.username ||
      u.password ||
      u.hash ||
      value.length > 256 ||
      !(
        u.protocol === 'wss:' ||
        (u.protocol === 'ws:' && ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname))
      )
    )
      throw new Error(
        'Index relays require wss:// or an explicitly configured loopback ws:// origin',
      );
  }
  const localBlossom = env.SPACE_INDEX_LOCAL_BLOSSOM || undefined;
  if (localBlossom) {
    const u = new URL(localBlossom);
    if (
      u.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]'].includes(u.hostname) ||
      u.origin !== localBlossom ||
      u.username ||
      u.password
    )
      throw new Error('Local Blossom override must be an exact numeric loopback HTTP origin');
  }
  return {
    directory: env.SPACE_INDEX_DIR,
    relays,
    hints,
    localBlossom,
    release: env.SPACE_RELEASE_ID ?? 'local',
  };
}

// This exception belongs to operator configuration, never to arbitrary event
// URLs. Only GET /<verified-hash> on this exact origin may reach local services.
export async function indexDownload(
  servers: string[],
  hash: string,
  signal: AbortSignal,
  localOrigin?: string,
) {
  // The operator's local CAS is a cache for every author, including manifests
  // without hints. The event still cannot choose a local destination or path.
  if (localOrigin) {
    try {
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid hash');
      const response = await fetch(`${localOrigin}/${hash}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
        redirect: 'error',
      });
      if (
        !response.ok ||
        !response.body ||
        Number(response.headers.get('content-length')) > MAX_ARTIFACT_BYTES
      )
        throw new Error('Blob unavailable');
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_ARTIFACT_BYTES) throw new Error('Blob too large');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const bytes = new Uint8Array(Buffer.concat(chunks));
      if ((await sha256(bytes)) !== hash) throw new Error('Hash mismatch');
      return bytes;
    } catch {
      /* Continue with safe public signed hints. */
    }
  }
  return downloadArtifact(servers, hash, signal);
}

export class IndexWorker {
  readonly store: IndexStore;
  private lock: Database;
  constructor(readonly config: IndexConfig) {
    this.store = new IndexStore(config.directory, true);
    this.lock = new Database(join(config.directory, 'writer.sqlite'), { create: true });
    try {
      this.lock.exec('BEGIN EXCLUSIVE');
    } catch {
      this.lock.close();
      this.store.close();
      throw new Error('Another index worker owns this directory');
    }
  }
  close() {
    this.lock.close();
    this.store.close();
  }
  async collect(read: PublicationRelays['read'], now = Date.now()) {
    const errors: string[] = [];
    for (const relay of this.config.relays)
      for (const kind of [5, 35129, 15129, 5129]) {
        const cursor = `cursor:${relay}:${kind}`;
        const full = this.store.state<number>(`full:${cursor}`) ?? 0;
        const since = now - full >= 3600000 ? null : this.store.state<number>(cursor);
        let until = Math.floor(now / 1000);
        try {
          // Descending pages overlap the last timestamp so ties are never skipped.
          // A saturated second is reported; its cursor is deliberately not advanced.
          for (let page = 0; ; page++) {
            if (page >= 100) throw new Error('Catch-up page capacity reached');
            const events = await read(relay, {
              kinds: [kind],
              limit: 200,
              until,
              ...(since === null ? {} : { since: Math.max(0, since - 600) }),
            });
            for (const event of events) this.store.admit(event, now);
            if (events.length < 200) break;
            const oldest = Math.min(...events.map((event) => event.created_at));
            if (oldest >= until)
              throw new Error('Relay page saturated within one second; catch-up incomplete');
            until = oldest;
          }
          this.store.setState(cursor, Math.floor(now / 1000));
          if (since === null) this.store.setState(`full:${cursor}`, now);
        } catch (error) {
          errors.push(
            `${relay} kind ${kind}: ${error instanceof Error ? error.message : 'discovery failed'}`,
          );
        }
      }
    return errors;
  }
  async hydrate(
    signal: AbortSignal,
    options: {
      download?: typeof downloadArtifact;
      metadata?: typeof discoverPreviewMetadata;
      now?: number;
    } = {},
  ) {
    const now = options.now ?? Date.now();
    const profile = `${RUNTIME_PROFILE}:${PREVIEW_PROFILE}`;
    const changed = this.store.state<string>('profile') !== profile;
    if (changed) this.store.invalidate();
    const directory = join(this.config.directory, 'artifacts');
    await mkdir(directory, { recursive: true });
    const queue = await Promise.all(
      this.store
        .due(now)
        .filter((row) => !manifestBlocked(JSON.parse(row.event)))
        .map(async (row) => ({
          row,
          entry: this.store.removed(JSON.parse(row.event))
            ? null
            : await indexedProjection(row, this.config.hints ?? this.config.relays),
        })),
    );
    const retained = new Set([
      ...this.store.references().map((r) => r.hash),
      ...queue.map(({ entry }) => entry?.artifactHash),
    ]);
    let usedBytes = 0;
    for (const name of await readdir(directory)) {
      if (!/^[a-f0-9]{64}\.html$/.test(name)) continue;
      if (!retained.has(name.slice(0, -5))) await rm(join(directory, name));
      else usedBytes += (await stat(join(directory, name))).size;
    }
    let capacity = false;
    // Sequential reservations keep the total disk budget exact; each job has a deadline.
    for (const { row, entry } of queue) {
      if (signal.aborted) break;
      if (!entry) {
        this.store.project(row.id, null, now + 3600000, now + 3600000);
        continue;
      }
      const needsArtifact = changed || row.retry_at <= now;
      if (needsArtifact && !missingDomains(entry.domains).length) {
        try {
          const file = Bun.file(join(directory, `${entry.artifactHash}.html`));
          let data: Uint8Array | undefined;
          if ((await file.exists()) && file.size <= MAX_ARTIFACT_BYTES) {
            const bytes = new Uint8Array(await file.arrayBuffer());
            if ((await sha256(bytes)) === entry.artifactHash) data = bytes;
          }
          if (!data) {
            if (usedBytes + MAX_ARTIFACT_BYTES > 1024 ** 3) {
              capacity = true;
              throw new Error('Artifact cache capacity reached');
            }
            const manifest = await validateManifest(entry.manifest);
            data = await (
              options.download ??
              ((servers, hash, s) => indexDownload(servers, hash, s, this.config.localBlossom))
            )(
              manifest.servers,
              entry.artifactHash,
              AbortSignal.any([signal, AbortSignal.timeout(12000)]),
            );
            if (data.length > MAX_ARTIFACT_BYTES || (await sha256(data)) !== entry.artifactHash)
              throw new Error('Hash mismatch');
            new TextDecoder('utf-8', { fatal: true }).decode(data);
            const temporary = `${file.name}.${crypto.randomUUID()}.tmp`;
            await Bun.write(temporary, data);
            await rename(temporary, file.name!);
            usedBytes += data.length;
          }
          new TextDecoder('utf-8', { fatal: true }).decode(data);
          entry.bytes = data.length;
          entry.availability = 'ready';
        } catch {
          entry.availability = 'unavailable';
          entry.bytes = null;
        }
      }
      // Save playback before optional image work, so a slow descriptor cannot delay opening.
      this.store.project(
        row.id,
        entry,
        now + (entry.availability === 'ready' ? 300000 : 30000),
        row.preview_at,
      );
    }
    const previews = queue.filter(({ entry, row }) => entry && (changed || row.preview_at <= now));
    if (previews.length && !signal.aborted) {
      try {
        const previewSignal = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
        const entries = previews.map(({ entry }) => entry!);
        const previous = entries.map((entry) => ({ ...entry }));
        const metadata = await (options.metadata ?? discoverPreviewMetadata)(
          entries.map((e) => e.manifest),
          this.config.relays,
          previewSignal,
        );
        await indexPreviewImages(this.config.directory, entries, metadata, previewSignal, {
          previous,
        });
      } catch {
        /* Keep existing validated previews when discovery is offline. */
      }
      for (const { entry, row } of previews) {
        const current = this.store.revision(row.id);
        if (current) this.store.project(row.id, entry, current.retry_at, now + 900000);
      }
    }
    const previewHashes = new Set(this.store.references().map((r) => r.preview));
    let previewBytes = 0;
    const previewsDirectory = join(this.config.directory, 'previews');
    for (const file of await readdir(previewsDirectory).catch(() => [] as string[])) {
      if (!/^[a-f0-9]{64}\.png$/.test(file)) continue;
      const path = join(previewsDirectory, file),
        size = (await stat(path)).size;
      if (!previewHashes.has(file.slice(0, -4)) || previewBytes + size > 256 * 1024 ** 2)
        await rm(path);
      else previewBytes += size;
    }
    this.store.setState('profile', profile);
    return capacity ? ['Artifact cache capacity reached (1 GiB)'] : [];
  }
  async run(signal: AbortSignal) {
    const relays = new PublicationRelays(signal);
    try {
      while (!signal.aborted) {
        const errors = await this.collect(relays.read.bind(relays));
        errors.push(...(await this.hydrate(signal)));
        this.store.setState('health', {
          checkedAt: Date.now(),
          release: this.config.release,
          relays: this.config.hints ?? this.config.relays,
          errors,
        });
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve();
          const finish = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', finish);
            resolve();
          };
          const timer = setTimeout(finish, 5000);
          signal.addEventListener('abort', finish, { once: true });
        });
      }
    } finally {
      relays.close();
    }
  }
}
