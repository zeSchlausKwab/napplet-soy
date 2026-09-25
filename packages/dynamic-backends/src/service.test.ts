import { test, expect } from 'bun:test';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeAddress } from '../../protocol/src';
import { DynamicBackends } from './service';
import { authorizationTemplate, PROFILE, type Source } from './contracts';
import { compileHandler, executeHandler, type RuntimeContext } from './runtime';
import { buildArtifact, type BuildInput } from './build';
import { gitSourceLoader } from './build';
import { admitSchemas } from './schema';

const author = generateSecretKey(),
  player = generateSecretKey(),
  providerKey = generateSecretKey();
const provider = getPublicKey(providerKey),
  actor = getPublicKey(generateSecretKey()),
  visitor = getPublicKey(generateSecretKey());
const module = {
  napplet: encodeAddress({ kind: 35129, pubkey: getPublicKey(author), identifier: 'minicraft' }),
  name: 'worlds',
};
const source: Source = {
  repository: `30617:${getPublicKey(author)}:minicraft`,
  cloneUrl: 'https://git.example/minicraft.git',
  commit: 'a'.repeat(40),
  manifest: 'backend/backend.json',
};
async function fixture(): Promise<BuildInput> {
  const files: Record<string, string> = {};
  for (const name of ['backend.json', 'handler.ts', 'schemas.json'])
    files[`backend/${name}`] = await readFile(
      new URL(`../fixtures/minicraft/${name}`, import.meta.url),
      'utf8',
    );
  return { source, files };
}
function signed(
  operation: string,
  input: Record<string, unknown>,
  key = author,
  transport = actor,
) {
  const args = { ...input, requestId: crypto.randomUUID() };
  return {
    ...args,
    authorization: finalizeEvent(authorizationTemplate(provider, transport, operation, args), key),
  };
}
async function build(service: DynamicBackends) {
  const job = await service.build(
    actor,
    signed('build', { module, source, buildProfile: PROFILE }),
  );
  for (let i = 0; i < 100; i++) {
    const status = service.buildStatus(actor, { build: job.build });
    if (status.status === 'failed') throw new Error(JSON.stringify(status));
    if (status.status === 'ready') return status.release as string;
    await Bun.sleep(20);
  }
  throw new Error('Build did not finish');
}
function session(service: DynamicBackends, transport = actor, account = player) {
  const challenge = service.sessionChallenge(transport, { module, account: getPublicKey(account) });
  return service.sessionBind(transport, {
    challenge: challenge.challenge,
    authorization: finalizeEvent(challenge.proof, account),
  }).session;
}
const createInput = {
  name: 'Our world',
  seed: 123,
  mode: 'survival',
  visibility: 'public',
  building: 'everyone',
  guestsMayBuild: false,
};
function intent(
  release: string,
  operation: string,
  input: unknown,
  instance?: string,
  binding?: string,
) {
  return {
    target: { module, release, ...(instance ? { instance } : {}) },
    operation,
    requestId: crypto.randomUUID(),
    expiresAt: Math.floor(Date.now() / 1000) + 240,
    input,
    ...(binding ? { session: binding } : {}),
  };
}
const context: RuntimeContext = {
  actor,
  principal: `guest:${actor}`,
  account: null,
  owner: '',
  instance: 'test',
  release: 'a'.repeat(64),
  operation: 'probe',
  requestId: crypto.randomUUID(),
  now: 1,
};

test('real isolated compiler and WASM worker have no ambient host capabilities and enforce budgets', async () => {
  const code = await compileHandler(
    'export async function handle(ctx: any) { await ctx.state.set("x", "y", {n: 1}); return { value: await ctx.state.get("x", "y"), fetch: typeof fetch, process: typeof process, require: typeof require }; }',
  );
  const calls: string[] = [];
  const result = await executeHandler(code, context, {}, (method) => {
    calls.push(method);
    return method === 'get' ? { n: 1 } : null;
  });
  // Bun folds `typeof require` to "function" during transpilation; it grants no loader.
  expect(result).toMatchObject({ value: { n: 1 }, fetch: 'undefined', process: 'undefined' });
  expect(
    await executeHandler(
      'export function handle(){return {require:typeof globalThis.require};}',
      context,
      {},
      () => null,
    ),
  ).toEqual({ require: 'undefined' });
  expect(calls).toEqual(['set', 'get']);
  await expect(
    compileHandler('import x from "node:fs"; export function handle(){return x}'),
  ).rejects.toThrow('self-contained');
  await expect(compileHandler('export function nope() {}')).rejects.toThrow(
    'Export function handle',
  );
  await expect(
    executeHandler('export function handle(){while(true){}}', context, {}, () => null),
  ).rejects.toThrow();
  await expect(
    executeHandler(
      'export function handle(){let a=[];while(true)a.push(new Array(10000).fill("x"));}',
      context,
      {},
      () => null,
    ),
  ).rejects.toThrow();
  await expect(
    executeHandler(
      'export async function handle(ctx){for(let i=0;i<1000;i++)await ctx.state.get("x","y");return {};}',
      context,
      {},
      () => null,
    ),
  ).rejects.toThrow('budget');
}, 15000);

test('source builds repeat, and signed management rejects a different owner, operation or transport', async () => {
  const input = await fixture();
  const one = await buildArtifact(input),
    two = await buildArtifact(input);
  expect(one).toEqual(two);
  const service = new DynamicBackends({
    provider,
    sign: async (event) => finalizeEvent(event, providerKey),
    source: async () => input,
  });
  try {
    await expect(
      service.build(actor, signed('build', { module, source, buildProfile: PROFILE }, player)),
    ).rejects.toThrow('signature');
    await expect(
      service.build(visitor, signed('build', { module, source, buildProfile: PROFILE })),
    ).rejects.toThrow('signature');
    const release = await build(service);
    service.activate(actor, signed('activate', { module, release, expectedActiveRelease: null }));
    const described = service.describe(visitor, { module });
    expect(described.release).toBe(release);
    expect(JSON.parse(described.receipt!.content).materials.source.commit).toBe(source.commit);
    expect(() =>
      service.deleteRelease(actor, signed('deleteRelease', { module, release })),
    ).toThrow('referenced');
  } finally {
    await service.close();
  }
}, 15000);

test('worlds survive restart; inventory and blocks commit once; ACL, conflict, release pinning and reviewed purge hold', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-world-test-'));
  let input = await fixture();
  const options = {
    path: join(root, 'worlds.sqlite'),
    provider,
    sign: async (event: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(event, providerKey),
    source: async () => input,
  };
  let service = new DynamicBackends(options);
  try {
    const release = await build(service);
    service.activate(actor, signed('activate', { module, release, expectedActiveRelease: null }));
    const binding = session(service);
    await expect(
      service.invoke(actor, intent(release, 'createWorld', createInput)),
    ).rejects.toThrow('account');
    const created = await service.invoke(
      actor,
      intent(release, 'createWorld', createInput, undefined, binding),
    );
    const world = created.instance as string;
    const place = intent(
      release,
      'placeBlock',
      { x: 1, y: 1, z: 1, block: 'stone', expectedChunkRevision: 0 },
      world,
      binding,
    );
    const placed = await service.invoke(actor, place);
    expect(await service.invoke(actor, place)).toEqual(placed);
    await expect(
      service.invoke(actor, { ...place, input: { ...(place.input as object), x: 2 } }),
    ).rejects.toThrow('different input');
    await expect(
      service.invoke(visitor, { ...place, requestId: crypto.randomUUID() }),
    ).rejects.toThrow('session');
    await expect(
      service.invoke(visitor, intent(release, 'placeBlock', place.input, world)),
    ).rejects.toThrow('permission');
    const readBag = () =>
      service.invoke(actor, intent(release, 'readMyInventory', {}, world, binding));
    expect((await readBag()).result).toEqual({ revision: 1, blocks: [63, 64, 64, 64, 64, 64, 64] });
    const concurrent = await Promise.allSettled(
      [2, 3].map((x) =>
        service.invoke(
          actor,
          intent(
            release,
            'placeBlock',
            { x, y: 1, z: 1, block: 'stone', expectedChunkRevision: 1 },
            world,
            binding,
          ),
        ),
      ),
    );
    expect(concurrent.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((await readBag()).result).toEqual({ revision: 2, blocks: [62, 64, 64, 64, 64, 64, 64] });
    await service.close();
    service = new DynamicBackends(options);
    expect((await readBag()).result).toEqual({ revision: 2, blocks: [62, 64, 64, 64, 64, 64, 64] });
    const different = await service.invoke(
      actor,
      intent(
        release,
        'createWorld',
        { ...createInput, visibility: 'members', building: 'members' },
        undefined,
        binding,
      ),
    );
    await expect(
      service.invoke(visitor, intent(release, 'readWorld', {}, different.instance as string)),
    ).rejects.toThrow('access');
    expect(
      (
        await service.invoke(
          actor,
          intent(release, 'readMyInventory', {}, different.instance as string, binding),
        )
      ).result,
    ).toEqual({ revision: 0, blocks: [64, 64, 64, 64, 64, 64, 64] });
    input = {
      ...input,
      files: {
        ...input.files,
        'backend/handler.ts':
          input.files['backend/handler.ts'].replace('Our world', 'New world') +
          '\n// next release\n',
      },
      source: { ...source, commit: source.commit },
    };
    // A changed manifest is included in provenance even if the compiler strips comments.
    input.files['backend/backend.json'] = input.files['backend/backend.json'].replace(
      '"stateVersion": 1',
      '"stateVersion": 2',
    );
    const next = await build(service);
    expect(next).not.toBe(release);
    service.activate(
      actor,
      signed('activate', { module, release: next, expectedActiveRelease: release }),
    );
    await expect(
      service.invoke(actor, intent(next, 'readWorld', {}, world, binding)),
    ).rejects.toThrow('pinned');
    expect(
      (await service.invoke(actor, intent(release, 'readWorld', {}, world, binding))).result,
    ).toHaveProperty('name', 'Our world');
    const target = { module, release, instance: world };
    expect(service.changes(visitor, { target, after: 0 }).changes.length).toBe(3);
    expect(() => service.purgePlan(visitor, { target, session: binding })).toThrow('session');
    const plan = service.purgePlan(actor, { target, session: binding });
    const removed = service.purgeConfirm(actor, {
      target,
      plan: plan.plan,
      planHash: plan.planHash,
      session: binding,
    });
    expect(removed.deleted).toBe(true);
    expect(
      service.purgeConfirm(actor, {
        target,
        plan: plan.plan,
        planHash: plan.planHash,
        session: binding,
      }),
    ).toEqual(removed);
    await expect(
      service.invoke(actor, intent(release, 'readWorld', {}, world, binding)),
    ).rejects.toThrow('unavailable');
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
}, 25000);

test('unapproved sources and unbounded schemas fail before a compiler or network call', async () => {
  await expect(gitSourceLoader(['https://git.example'])(source)).rejects.toThrow(
    'author-qualified',
  );
  await expect(gitSourceLoader([])(source)).rejects.toThrow('not admitted');
  const input = await fixture();
  const schema = JSON.parse(input.files['backend/schemas.json']);
  schema.records.worlds.properties.name = { type: 'string' };
  expect(() => admitSchemas(schema)).toThrow('bounded maxLength');
});

test('query writes, invalid outputs, stale purge plans and revoked account proofs preserve state', async () => {
  let input = await fixture();
  const original = input.files['backend/handler.ts'];
  input.files['backend/handler.ts'] = original
    .replace(
      "if (ctx.operation === 'readWorld') return world;",
      "if (ctx.operation === 'readWorld') { await ctx.state.set('worlds', 'meta', {...world, name: 'altered'}); return world; }",
    )
    .replace(
      'return { chunkRevision: record.revision };',
      'return { chunkRevision: record.revision, invalid: true };',
    );
  // The formatted fixture may span lines; make sure this actually exercises both faults.
  expect(input.files['backend/handler.ts']).toContain('invalid: true');
  expect(input.files['backend/handler.ts']).toContain("name: 'altered'");
  const service = new DynamicBackends({
    provider,
    sign: async (event) => finalizeEvent(event, providerKey),
    source: async () => input,
  });
  try {
    const release = await build(service);
    service.activate(actor, signed('activate', { module, release, expectedActiveRelease: null }));
    const binding = session(service);
    const create = intent(release, 'createWorld', createInput, undefined, binding);
    const created = await service.invoke(actor, create),
      instance = created.instance as string;
    await expect(
      service.invoke(actor, intent(release, 'readWorld', {}, instance, binding)),
    ).rejects.toThrow('Queries cannot');
    await expect(
      service.invoke(
        actor,
        intent(
          release,
          'placeBlock',
          { x: 0, y: 0, z: 0, block: 'stone', expectedChunkRevision: 0 },
          instance,
          binding,
        ),
      ),
    ).rejects.toThrow('Undeclared field');
    expect(
      (await service.invoke(actor, intent(release, 'readMyInventory', {}, instance, binding)))
        .result,
    ).toEqual({ revision: 0, blocks: [64, 64, 64, 64, 64, 64, 64] });
    const target = { module, release, instance };
    expect(service.changes(actor, { target, after: 0, session: binding }).revision).toBe(1);
    const stale = service.purgePlan(actor, { target, session: binding });
    await service.invoke(
      actor,
      intent(
        release,
        'setMember',
        { principal: `nostr:${getPublicKey(author)}`, role: 'builder' },
        instance,
        binding,
      ),
    );
    expect(() =>
      service.purgeConfirm(actor, {
        target,
        plan: stale.plan,
        planHash: stale.planHash,
        session: binding,
      }),
    ).toThrow('changed since');
    const plan = service.purgePlan(actor, { target, session: binding });
    expect(
      service.purgeConfirm(actor, {
        target,
        plan: plan.plan,
        planHash: plan.planHash,
        session: binding,
      }).deleted,
    ).toBe(true);
    await expect(service.invoke(actor, create)).rejects.toThrow('purged world');
    service.revokeSession(actor, { session: binding });
    await expect(
      service.invoke(actor, intent(release, 'createWorld', createInput, undefined, binding)),
    ).rejects.toThrow('revoked');
  } finally {
    await service.close();
  }
}, 15000);
