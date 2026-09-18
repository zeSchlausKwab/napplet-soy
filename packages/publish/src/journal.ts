import { videoInfoSchema, MAX_VIDEO_BYTES } from '../../protocol/src/preview-video';
import { Database } from 'bun:sqlite';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { eventSchema } from '../../protocol/src';
import { remixSchema } from '../../protocol/src/remix';
import type { Network } from '../../identity/src/signer';
import { PublishError, targetsSchema } from './config';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{40}$/);
const planSchema = z
  .object({
    network: z.enum(['public', 'local']),
    pubkey: hash,
    identifier: z.string().max(13),
    title: z.string().max(160),
    description: z.string().max(1000),
    license: z.string().max(100),
    requires: z.array(z.string().max(40)).max(32),
    topics: z.array(z.string().max(256)).max(32),
    servers: z.array(z.string().max(256)).max(9),
    targets: targetsSchema,
    files: z
      .array(
        z
          .object({
            path: z.string().max(200),
            hash,
            size: z
              .number()
              .int()
              .nonnegative()
              .max(40 * 1024 * 1024),
          })
          .strict(),
      )
      .max(128),
    artifactHash: hash,
    sourceBytes: z
      .number()
      .int()
      .nonnegative()
      .max(40 * 1024 * 1024),
    sourceCommit: commit,
    remix: remixSchema.optional(),
  })
  .strict();
export const jobSchema = z
  .object({
    version: z.literal(1),
    id: hash,
    fingerprint: hash,
    plan: planSchema,
    createdAt: z.number().int().nonnegative(),
    parent: hash.nullable(),
    baseCurrent: hash.nullable(),
    baseSource: hash.nullable(),
    sourceBaseCommit: commit.nullable(),
    baseAnnouncement: hash.nullable(),
    commit,
    archiveHash: hash,
    archiveBytes: z
      .number()
      .int()
      .nonnegative()
      .max(50 * 1024 * 1024),
    check: z.object({ profile: z.string().max(80), browser: z.string().max(80) }).strict(),
    releaseRefs: z.record(z.string().regex(/^refs\/tags\/release-[a-f0-9]{16}$/), commit),
    source: z.object({ announcement: eventSchema, state: eventSchema }).optional(),
    snapshot: eventSchema.optional(),
    current: eventSchema.optional(),
    preview: z
      .object({
        hash,
        bytes: z
          .number()
          .int()
          .positive()
          .max(5 * 1024 * 1024),
        descriptor: eventSchema.optional(),
      })
      .strict()
      .optional(),
    video: videoInfoSchema
      .extend({ hash, bytes: z.number().int().positive().max(MAX_VIDEO_BYTES) })
      .optional(),
    receipts: z
      .object({
        preview: z.boolean().optional(),
        video: z.boolean().optional(),
        descriptor: z.boolean().optional(),
        source: z.boolean(),
        artifact: z.boolean(),
        archive: z.boolean(),
        snapshot: z.boolean(),
        current: z.boolean(),
      })
      .strict(),
    mirrors: z.record(z.string(), z.boolean()),
    status: z.enum(['prepared', 'announced_pending_index']),
    website: z
      .object({
        checkedAt: z.number().int().nonnegative(),
        ready: z.boolean(),
        reason: z.enum(['ready', 'pending', 'unavailable', 'superseded']),
      })
      .strict()
      .optional(),
    error: z
      .object({
        code: z.string().max(80),
        stage: z.string().max(40),
        message: z.string().max(1000),
        retryable: z.boolean(),
      })
      .optional(),
  })
  .strict()
  .refine(
    (job) =>
      job.status !== 'announced_pending_index' ||
      ((!job.video || (!!job.preview && job.receipts.video === true)) &&
        !!job.source &&
        !!job.current &&
        !!job.snapshot &&
        (!job.preview ||
          (!!job.preview.descriptor &&
            job.receipts.preview === true &&
            job.receipts.descriptor === true)) &&
        Object.values(job.receipts).every(Boolean)),
    'Completed jobs require all publication evidence',
  );
export type PublishJob = z.infer<typeof jobSchema>;
const indexSchema = z
  .object({ version: z.literal(1), active: hash.nullable(), latest: hash.nullable() })
  .strict();

async function safeDirectory(path: string) {
  await mkdir(path, { recursive: false, mode: 0o700 }).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new PublishError(
      'JOURNAL_PATH',
      'Publication state must be a private regular directory.',
    );
}
async function readJson(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 512 * 1024) throw new Error();
    return JSON.parse(await file.readFile('utf8'));
  } finally {
    await file.close();
  }
}
async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + '\n');
    await file.sync();
    await file.close();
    await rename(temporary, path);
    const directory = await open(join(path, '..'), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await file.close();
    await rm(temporary, { force: true });
  }
}
export class Journal {
  readonly root: string;
  constructor(
    directory: string,
    readonly network: Network,
  ) {
    this.root = join(directory, '.napplet-space', network);
  }
  directory(id: string) {
    return join(this.root, hash.parse(id));
  }
  async index() {
    try {
      return indexSchema.parse(await readJson(join(this.root, 'index.json')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { version: 1 as const, active: null, latest: null };
      throw new PublishError(
        'JOURNAL_INVALID',
        'Publication index is damaged. Restore its backup; it was not overwritten.',
      );
    }
  }
  async load(id: string) {
    try {
      if ((await lstat(this.directory(id))).isSymbolicLink()) throw new Error();
      const job = jobSchema.parse(await readJson(join(this.directory(id), 'job.json')));
      if (
        job.id !== id ||
        job.plan.network !== this.network ||
        Object.keys(job.releaseRefs).length > 128
      )
        throw new Error();
      return job;
    } catch {
      throw new PublishError(
        'JOURNAL_INVALID',
        'Saved publication is missing or damaged. Restore the journal backup before retrying.',
      );
    }
  }
  async save(job: PublishJob) {
    await atomicJson(join(this.directory(job.id), 'job.json'), jobSchema.parse(job));
  }
  async select(active: string | null, latest: string | null) {
    await atomicJson(
      join(this.root, 'index.json'),
      indexSchema.parse({ version: 1, active, latest }),
    );
  }
  async lock<T>(fn: () => Promise<T>) {
    const parent = join(this.root, '..');
    await safeDirectory(parent);
    await safeDirectory(this.root);
    const path = join(parent, 'publish-lock.sqlite');
    if ((await lstat(path).catch(() => null))?.isSymbolicLink())
      throw new PublishError('JOURNAL_PATH', 'Publication lock cannot be a symlink.');
    const lock = new Database(path, { create: true });
    try {
      await chmod(path, 0o600);
      try {
        lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');
      } catch {
        throw new PublishError(
          'PUBLISH_BUSY',
          'Another publication is running in this project. Retry when it finishes.',
          'check',
          true,
        );
      }
      return await fn();
    } finally {
      lock.close();
    }
  }
}
