import { expect, test } from 'bun:test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { BackendAccount } from './backend-account';
import { DynamicBackends } from '../../dynamic-backends/src/service';
import { encodeAddress } from '../../protocol/src';

async function fixture() {
  let now = Date.now();
  const creator = getPublicKey(generateSecretKey()),
    viewer = generateSecretKey(),
    pubkey = getPublicKey(viewer),
    actor = getPublicKey(generateSecretKey()),
    providerKey = generateSecretKey(),
    provider = getPublicKey(providerKey);
  const module = {
    napplet: encodeAddress({ kind: 35129, pubkey: creator, identifier: 'worlds-test' }),
    name: 'worlds',
  };
  const service = new DynamicBackends({
    provider,
    sign: async (event) => finalizeEvent(event, providerKey),
    source: async () => {
      throw new Error('No remote source in this fixture');
    },
    now: () => now,
  });
  // Register the real module and use the provider's real challenge/proof/session code.
  await service.provisionPreview(module, {
    source: {
      mode: 'local-preview',
      manifest: 'backend/backend.json',
      workspaceDigest: 'a'.repeat(64),
    },
    files: {
      'backend/backend.json': JSON.stringify({
        format: 'soy.backend/1',
        name: 'worlds',
        buildProfile: 'soy-ts-quickjs-v1',
        entry: 'backend/handler.ts',
        schemas: 'backend/schemas.json',
        stateVersion: 1,
        abi: 'soy-handler-v1',
      }),
      'backend/handler.ts': 'export async function handle() { return {}; }',
      'backend/schemas.json': JSON.stringify({
        version: 1,
        records: {},
        operations: {
          create: {
            effect: 'create',
            access: 'owner',
            account: true,
            input: { type: 'object', properties: {}, required: [], additionalProperties: false },
            output: { type: 'object', properties: {}, required: [], additionalProperties: false },
          },
        },
      }),
    },
  });
  let signatures = 0;
  const calls: string[] = [];
  const connection = {
    async tool(name: string, args: Record<string, unknown>) {
      calls.push(name);
      if (name === 'soy_backend_session_challenge') return service.sessionChallenge(actor, args);
      if (name === 'soy_backend_session_bind') return service.sessionBind(actor, args);
      throw new Error(`Unexpected tool: ${name}`);
    },
  };
  const host = (delay: number) =>
    new BackendAccount(
      {
        identity: `${creator}:35129:worlds-test`,
        pubkey,
        sign: async (_, template) => {
          signatures++;
          now += delay;
          return finalizeEvent(template, viewer);
        },
        signal: new AbortController().signal,
        consent: async () => true,
      },
      async () => actor,
      () => now,
    );
  const input = {
    target: { module, release: service.describe(actor, { module }).active },
    operation: 'create',
    requestId: crypto.randomUUID(),
    expiresAt: Math.floor(now / 1000) + 240,
    input: {},
  };
  return {
    service,
    connection,
    host,
    provider,
    actor,
    input,
    calls,
    signatures: () => signatures,
    now: () => now,
  };
}

test('account binding accepts human signing time, preserves the intent and reuses the session', async () => {
  const f = await fixture();
  try {
    const host = f.host(12000);
    const args = await host.arguments(f.connection, f.provider, 'soy_backend_invoke', f.input);
    expect(args).toMatchObject(f.input);
    expect(typeof args.session).toBe('string');
    const result = await f.service.invoke(f.actor, args);
    expect(result.ok).toBe(true);
    expect(await f.service.invoke(f.actor, args)).toEqual(result);
    expect(await host.arguments(f.connection, f.provider, 'soy_backend_invoke', f.input)).toEqual(
      args,
    );
    expect(f.signatures()).toBe(1);
    expect(f.calls).toEqual(['soy_backend_session_challenge', 'soy_backend_session_bind']);
  } finally {
    await f.service.close();
  }
});

test('invalid provider challenges report their cause before signing', async () => {
  const f = await fixture();
  try {
    await expect(
      f.host(0).arguments({ tool: async () => ({}) }, f.provider, 'soy_backend_invoke', f.input),
    ).rejects.toThrow('Backend provider returned an invalid account challenge');
    expect(f.signatures()).toBe(0);
  } finally {
    await f.service.close();
  }
});

for (const fault of ['expired', 'overlong', 'wrong-account'] as const) {
  test(`invalid ${fault} sessions stay rejected and do not poison retries`, async () => {
    const f = await fixture();
    try {
      const host = f.host(12000);
      const bad = {
        tool: async (name: string, args: Record<string, unknown>) => {
          const response = await f.connection.tool(name, args);
          if (name !== 'soy_backend_session_bind') return response;
          return {
            ...response,
            ...(fault === 'wrong-account'
              ? { account: '0'.repeat(64) }
              : { expiresAt: Math.floor(f.now() / 1000) + (fault === 'expired' ? 0 : 7200) }),
          };
        },
      };
      await expect(host.arguments(bad, f.provider, 'soy_backend_invoke', f.input)).rejects.toThrow(
        'Backend provider returned an invalid or expired account session',
      );
      expect(
        typeof (await host.arguments(f.connection, f.provider, 'soy_backend_invoke', f.input))
          .session,
      ).toBe('string');
      expect(f.signatures()).toBe(2);
    } finally {
      await f.service.close();
    }
  });
}
