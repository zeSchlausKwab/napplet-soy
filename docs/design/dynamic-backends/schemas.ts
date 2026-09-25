/**
 * Executable design draft, not registered CVM tools or a security implementation.
 * The implemented wire contract is packages/dynamic-backends/src/contracts.ts;
 * see docs/DYNAMIC-BACKENDS.md for profile differences and local-only rollout.
 * Schemas validate shape. Signature verification, authorization, resource limits,
 * transactions and build provenance enforcement remain service responsibilities.
 */
import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(128);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const requestId = z.string().uuid();
const principal = z.string().regex(/^nostr:[a-f0-9]{64}$/);
const moduleRef = z.strictObject({
  // Semantic NIP-19 validation and author extraction are also required.
  napplet: z
    .string()
    .regex(/^naddr1[023456789acdefghjklmnpqrstuvwxyz]+$/)
    .max(4096),
  name: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
});
const sourcePath = z
  .string()
  .min(1)
  .max(240)
  .regex(/^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/);
const source = z.strictObject({
  repository: z.string().regex(/^30617:[a-f0-9]{64}:.{1,128}$/),
  // A locator only; provider fetch policy must handle DNS/redirect/path safety.
  cloneUrl: z.string().url().startsWith('https://').max(2048),
  commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
  manifest: sourcePath,
});
const nostrProof = z.strictObject({
  id: hash,
  pubkey: hash,
  created_at: z.number().int().nonnegative(),
  kind: z.literal(1),
  tags: z.array(z.array(z.string().max(4096)).max(4)).max(8),
  content: z.string().max(16384),
  sig: z.string().regex(/^[a-f0-9]{128}$/),
});
const jsonObject = z.record(z.string(), z.json());
const moduleTarget = z.strictObject({
  type: z.literal('module'),
  module: moduleRef,
  release: hash,
});
const instanceTarget = z.strictObject({
  type: z.literal('instance'),
  module: moduleRef,
  release: hash,
  instance: id,
});

/** Proposed generic provider API, used through ordinary CVM tools/call. */
export const platform = {
  build: z.strictObject({
    module: moduleRef,
    source,
    buildProfile: z.literal('soy-ts-wasm-v1'),
    requestId,
    authorization: nostrProof,
  }),
  buildStatus: z.strictObject({ build: id }),
  activate: z.strictObject({
    module: moduleRef,
    release: hash,
    expectedActiveRelease: hash.nullable(),
    requestId,
    authorization: nostrProof,
  }),
  describe: z.strictObject({ module: moduleRef, release: hash.optional() }),
  disable: z.strictObject({
    module: moduleRef,
    expectedModuleRevision: revision,
    requestId,
    authorization: nostrProof,
  }),
  deleteRelease: z.strictObject({
    module: moduleRef,
    release: hash,
    requestId,
    authorization: nostrProof,
  }),
  purgePlan: z.strictObject({ target: instanceTarget, authorization: nostrProof }),
  purgeConfirm: z.strictObject({ plan: id, planHash: hash, requestId, authorization: nostrProof }),
  sessionChallenge: z.strictObject({ module: moduleRef, account: hash }),
  sessionBind: z.strictObject({ challenge: id, authorization: nostrProof }),
  invoke: z.strictObject({
    target: z.discriminatedUnion('type', [moduleTarget, instanceTarget]),
    operation: z.string().regex(/^[a-z][a-zA-Z0-9]{0,63}$/),
    requestId,
    // Service admission checks this against its clock and a bounded retry window.
    expiresAt: z.number().int().nonnegative(),
    // A locator bound to authenticated transport identity, not a bearer credential.
    session: id.optional(),
    input: jsonObject,
  }),
  changes: z.strictObject({
    target: instanceTarget,
    after: revision,
    limit: z.number().int().min(1).max(64),
    session: id.optional(),
  }),
};

export const buildReceipt = z.strictObject({
  version: z.literal('soy-build-receipt/1'),
  provider: hash,
  release: hash,
  module: moduleRef,
  source,
  sourceTreeDigest: hash,
  buildProfile: z.literal('soy-ts-wasm-v1'),
  builderImageDigest: hash,
  toolchainDigest: hash,
  dependencySetDigest: hash,
  manifestDigest: hash,
  schemaDigest: hash,
  abi: z.literal('soy-handler-v1'),
  runtimePolicyDigest: hash,
  artifact: z.strictObject({
    sha256: hash,
    bytes: z.number().int().positive(),
    url: z.string().url().startsWith('https://'),
  }),
  builtAt: z.number().int().nonnegative(),
});

/** Declarative build inputs committed with source; no arbitrary build command. */
export const backendManifest = z.strictObject({
  format: z.literal('soy.backend/1'),
  name: moduleRef.shape.name,
  buildProfile: z.literal('soy-ts-wasm-v1'),
  entry: sourcePath,
  schemas: sourcePath,
  stateVersion: z.number().int().min(1).max(65535),
  abi: z.literal('soy-handler-v1'),
});

export const invocationResult = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    release: hash,
    requestId,
    revision,
    result: jsonObject,
  }),
  z.strictObject({
    ok: z.literal(false),
    release: hash,
    requestId,
    error: z.strictObject({
      code: z.enum([
        'BAD_INPUT',
        'ACCOUNT_REQUIRED',
        'FORBIDDEN',
        'NOT_FOUND',
        'CONFLICT',
        'IDEMPOTENCY_CONFLICT',
        'RELEASE_MISMATCH',
        'DISABLED',
        'QUOTA_EXCEEDED',
        'DEADLINE_EXCEEDED',
        'RETRY_WINDOW_EXPIRED',
        'RESYNC_REQUIRED',
        'INTERNAL',
      ]),
      message: z.string().max(512),
      retryable: z.boolean(),
      currentRevision: revision.optional(),
    }),
  }),
]);

// These are MiniCraft's rules, not generic provider limits.
const xz = z.number().int().min(0).max(255);
const y = z.number().int().min(0).max(127);
const chunkPosition = z.strictObject({
  x: z.number().int().min(0).max(31),
  y: z.number().int().min(0).max(15),
  z: z.number().int().min(0).max(31),
});
const block = z.enum(['air', 'stone', 'dirt', 'grass', 'wood', 'glass', 'sand', 'water']);
const solidBlock = block.exclude(['air']);
const coordinate = { x: xz, y, z: xz };
const count = z.number().int().min(0).max(65535);
const committed = z.strictObject({
  revision,
  chunkRevision: revision,
  inventoryRevision: revision.nullable(),
});

/** Persisted record shapes. Read projections must apply ACLs, not expose these wholesale. */
export const minicraftState = {
  world: z.strictObject({
    schemaVersion: z.literal(1),
    id,
    release: hash,
    revision,
    name: z.string().min(1).max(64),
    owner: principal,
    seed: z.number().int().min(0).max(4294967295),
    mode: z.enum(['creative', 'survival']),
    visibility: z.enum(['public', 'members']),
    building: z.enum(['members', 'everyone']),
    guestsMayBuild: z.boolean(),
    size: z.strictObject({ x: z.literal(256), y: z.literal(128), z: z.literal(256) }),
    chunkSize: z.literal(8),
  }),
  chunk: z.strictObject({
    schemaVersion: z.literal(1),
    position: chunkPosition,
    revision,
    // Fixed palette indexes in x + 8*(z + 8*y) order. Generation fills missing chunks.
    blocks: z.array(z.number().int().min(0).max(7)).length(512),
  }),
  member: z.strictObject({ principal, role: z.enum(['builder', 'viewer']), revision }),
  inventory: z.strictObject({
    schemaVersion: z.literal(1),
    principal,
    revision,
    blocks: z.strictObject({
      stone: count,
      dirt: count,
      grass: count,
      wood: count,
      glass: count,
      sand: count,
      water: count,
    }),
  }),
};

/** Application methods advertised by describe. The provider performs a second validation. */
export const minicraft = {
  createWorld: {
    scope: 'module',
    effect: 'create',
    identity: 'account',
    input: minicraftState.world.pick({
      name: true,
      seed: true,
      mode: true,
      visibility: true,
      building: true,
      guestsMayBuild: true,
    }),
    output: z.strictObject({ instance: id, release: hash, revision }),
  },
  readWorld: {
    scope: 'instance',
    effect: 'query',
    identity: 'policy',
    input: z.strictObject({}),
    output: minicraftState.world,
  },
  readChunks: {
    scope: 'instance',
    effect: 'query',
    identity: 'policy',
    input: z.strictObject({ positions: z.array(chunkPosition).min(1).max(8) }),
    output: z.strictObject({ atRevision: revision, chunks: z.array(minicraftState.chunk).max(8) }),
  },
  placeBlock: {
    scope: 'instance',
    effect: 'command',
    identity: 'policy',
    input: z.strictObject({ ...coordinate, block: solidBlock, expectedChunkRevision: revision }),
    output: committed,
  },
  removeBlock: {
    scope: 'instance',
    effect: 'command',
    identity: 'policy',
    input: z.strictObject({ ...coordinate, expectedChunkRevision: revision }),
    output: committed,
  },
  readMyInventory: {
    scope: 'instance',
    effect: 'query',
    identity: 'account',
    input: z.strictObject({}),
    output: minicraftState.inventory,
  },
  setMember: {
    scope: 'instance',
    effect: 'command',
    identity: 'account',
    input: z.strictObject({
      principal,
      role: z.enum(['builder', 'viewer']).nullable(),
      expectedMembershipRevision: revision,
    }),
    output: z.strictObject({ revision, membershipRevision: revision }),
  },
} as const;

/** No remote $refs. This conversion is for design review/export, not schema admission. */
export function jsonSchemaCatalog() {
  const json = (schema: z.ZodType) => z.toJSONSchema(schema, { target: 'draft-2020-12' });
  return {
    status: 'design-draft-not-deployed',
    platform: Object.fromEntries(
      Object.entries(platform).map(([name, schema]) => [name, json(schema)]),
    ),
    buildReceipt: json(buildReceipt),
    backendManifest: json(backendManifest),
    invocationResult: json(invocationResult),
    state: Object.fromEntries(
      Object.entries(minicraftState).map(([name, schema]) => [name, json(schema)]),
    ),
    minicraft: Object.fromEntries(
      Object.entries(minicraft).map(([name, { input, output, ...metadata }]) => [
        name,
        { ...metadata, inputSchema: json(input), outputSchema: json(output) },
      ]),
    ),
  };
}
