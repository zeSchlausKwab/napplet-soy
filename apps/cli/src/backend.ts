import { join } from 'node:path';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { PrivateKeySigner } from '@contextvm/sdk/signer';
import { Accounts } from '../../../packages/identity/src/accounts';
import type { CreatorSigner, Network } from '../../../packages/identity/src/signer';
import { encodeAddress } from '../../../packages/protocol/src';
import {
  projectSchema,
  projectIdentity,
  resolveTargets,
} from '../../../packages/publish/src/config';
import { regularFile } from '../../../packages/publish/src/project';
import {
  CvmConnection,
  validateProvider,
  type BackendProvider,
} from '../../../packages/multiplayer/src/client';
import { boardAuthorization } from '../../../packages/multiplayer/src/contracts';
import { startBackend } from '../../../packages/multiplayer/src/service';
import { startLocalBackendRelay } from '../../../packages/multiplayer/src/local-relay';

const developmentAuthor = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
async function publicFile(path: string, bytes: Uint8Array | string) {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o644 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function backendProject(directory: string, creator?: string) {
  let raw: Uint8Array;
  try {
    raw = await regularFile(directory, 'napplet.json', 16384);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
  const project = projectSchema.parse(JSON.parse(new TextDecoder().decode(raw)));
  if (!project.backend) return undefined;
  const pubkey = creator ?? project.creator?.pubkey ?? developmentAuthor;
  const napplet = encodeAddress({ kind: 35129, pubkey, identifier: projectIdentity(project) });
  const context = {
    version: 1,
    napplet,
    provider: project.backend.provider,
    boards: project.backend.boards.map((b) => b.board),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(context, null, 2) + '\n');
  let previous: Uint8Array | undefined;
  try {
    previous = await regularFile(directory, 'soy-backend.json', 16384);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (!previous || !Buffer.from(previous).equals(Buffer.from(bytes)))
    await publicFile(join(directory, 'soy-backend.json'), bytes);
  return { project, napplet, pubkey };
}
export async function resolveBackendProvider(directory: string, network: Network) {
  const project = projectSchema.parse(
    JSON.parse(new TextDecoder().decode(await regularFile(directory, 'napplet.json', 16384))),
  );
  if (!project.backend) throw new Error('Add backend: { boards: [] } to napplet.json first.');
  const target = resolveTargets(project, network);
  if (project.backend.provider)
    return validateProvider(project.backend.provider, network === 'local' ? [target.relay] : []);
  const response = await fetch(`${target.site}/.well-known/napplet.json`, {
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  if (!response.ok || Number(response.headers.get('Content-Length') ?? 0) > 16384)
    throw new Error('Default backend unavailable; set backend.provider in napplet.json.');
  const text = await response.text();
  if (text.length > 16384) throw new Error('Invalid backend discovery');
  return validateProvider(JSON.parse(text).backend, network === 'local' ? [target.relay] : []);
}
export async function syncBackend(
  directory: string,
  network: Network,
  accounts: Pick<Accounts, 'current' | 'signer'>,
  signerOptions = {},
  prepare = true,
) {
  const config = projectSchema.parse(
    JSON.parse(new TextDecoder().decode(await regularFile(directory, 'napplet.json', 16384))),
  );
  if (!config.backend) return { boards: 0 };
  const account = await accounts.current();
  if (!account)
    throw new Error('Select a creator with soyli account create or connect before backend sync.');
  if (config.creator?.pubkey !== account.pubkey)
    throw new Error(
      'Backend creator differs from the selected account. Run soyli backend init, then rebuild before publishing.',
    );
  const provider = await resolveBackendProvider(directory, network);
  if (!config.backend.provider) {
    if (!prepare)
      throw new Error('Pin the backend before publishing: soyli backend sync, then soyli build.');
    config.backend.provider = provider;
    await publicFile(join(directory, 'napplet.json'), JSON.stringify(config, null, 2) + '\n');
    await backendProject(directory, account.pubkey);
  }
  const expected = encodeAddress({
    kind: 35129,
    pubkey: account.pubkey,
    identifier: projectIdentity(config),
  });
  const context = JSON.parse(
    new TextDecoder().decode(await regularFile(directory, 'soy-backend.json', 16384)),
  );
  if (
    context.napplet !== expected ||
    JSON.stringify(context.provider) !== JSON.stringify(config.backend.provider)
  )
    throw new Error('Backend configuration changed. Run soyli build before publishing.');
  const prepared = await backendProject(directory, account.pubkey);
  if (!prepared) return { boards: 0 };
  const transportSigner = new PrivateKeySigner(),
    actor = await transportSigner.getPublicKey();
  const connection = new CvmConnection(provider, transportSigner);
  let signer: CreatorSigner | undefined;
  try {
    const definitions = prepared.project.backend!.boards;
    if (definitions.length) signer = await accounts.signer({ ...signerOptions, kinds: [1] });
    for (const board of definitions) {
      const definition = { ...board, napplet: prepared.napplet };
      await connection.tool('soy_board_register', {
        definition,
        authorization: await signer!.signEvent(
          boardAuthorization(provider.pubkey, actor, definition),
        ),
      });
    }
    return { provider, napplet: prepared.napplet, boards: definitions.length };
  } finally {
    await signer?.close();
    await connection.close();
  }
}
export async function initBackend(
  directory: string,
  network: Network,
  accounts: Pick<Accounts, 'current'>,
) {
  const config = projectSchema.parse(
    JSON.parse(new TextDecoder().decode(await regularFile(directory, 'napplet.json', 16384))),
  );
  const account = await accounts.current();
  if (account && config.creator && config.creator.pubkey !== account.pubkey)
    throw new Error(
      'Select this project’s creator account before backend init. Existing board namespaces are not reassigned.',
    );
  if (account) config.creator = { pubkey: account.pubkey, network };
  config.backend ??= { boards: [] };
  await publicFile(join(directory, 'napplet.json'), JSON.stringify(config, null, 2) + '\n');
  let warning: string | undefined;
  if (!config.backend.provider) {
    try {
      config.backend.provider = await resolveBackendProvider(directory, network);
      await publicFile(join(directory, 'napplet.json'), JSON.stringify(config, null, 2) + '\n');
    } catch {
      warning =
        'Default provider unavailable. Local preview works; run backend sync and rebuild when the provider is available.';
    }
  }
  const result = await backendProject(directory);
  return {
    napplet: result!.napplet,
    provider: config.backend.provider,
    config: 'napplet.json',
    context: 'soy-backend.json',
    preview: 'isolated local CVM',
    warning,
  };
}
export async function backendStatus(directory: string, network: Network) {
  const provider = await resolveBackendProvider(directory, network);
  const connection = new CvmConnection(provider, new PrivateKeySigner());
  try {
    return { provider, session: await connection.tool('soy_session') };
  } finally {
    await connection.close();
  }
}
export async function localBackend(
  directory: string,
  connectivity: { turnUrls?: string[]; turnSecret?: string; relayOnly?: boolean } = {},
) {
  const prepared = await backendProject(directory);
  if (!prepared) return undefined;
  const root = join(directory, '.napplet-space/backend');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const relay = startLocalBackendRelay();
  try {
    const service = await startBackend({
      relays: [relay.url],
      keyPath: join(root, 'identity'),
      dataPath: join(root, 'boards.sqlite'),
      ...connectivity,
      localBoards: prepared.project.backend!.boards.map((board) => ({
        ...board,
        napplet: prepared.napplet,
      })),
    });
    return {
      provider: service.provider,
      close: async () => {
        await service.close();
        relay.close();
      },
    };
  } catch (error) {
    relay.close();
    throw error;
  }
}
