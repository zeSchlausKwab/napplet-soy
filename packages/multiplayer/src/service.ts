import { mkdir, open, readFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHmac } from 'node:crypto';
import { NostrServerTransport } from '@contextvm/sdk/transport';
import { PrivateKeySigner } from '@contextvm/sdk/signer';
import { ApplesauceRelayPool } from '@contextvm/sdk/relay';
import { EncryptionMode } from '@contextvm/sdk/core';
import { computeCommonSchemaHash } from '@contextvm/sdk/core/utils/common-schema';
import { generateSecretKey } from 'nostr-tools';
import { Boards } from './boards';
import { Rooms } from './rooms';
import { createMatchmakingServer } from './server';
import type { BoardDefinition } from './contracts';

export async function backendIdentity(path: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    const file = await open(path, 'wx', 0o600);
    try {
      await file.writeFile(Buffer.from(generateSecretKey()).toString('hex'));
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await chmod(path, 0o600);
  const secret = (await readFile(path, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Invalid CVM identity');
  return new PrivateKeySigner(secret);
}
export function turnCredentials(
  actor: string,
  urls: string[],
  secret: string | undefined,
  relayOnly = false,
  now = Date.now(),
) {
  if (!urls.length) return { iceServers: [], relayOnly: false, expiresAt: now + 600000 };
  if (!secret) throw new Error('TURN credentials not configured');
  const expiresAt = now + 600000,
    username = `${Math.floor(expiresAt / 1000)}:${actor}`;
  return {
    iceServers: [
      { urls, username, credential: createHmac('sha1', secret).update(username).digest('base64') },
    ],
    relayOnly,
    expiresAt,
  };
}
export async function startBackend(options: {
  relays: string[];
  keyPath: string;
  dataPath: string;
  announce?: boolean;
  localBoards?: BoardDefinition[];
  maxPeers?: number;
  turnUrls?: string[];
  turnSecret?: string;
  relayOnly?: boolean;
  publicRelays?: string[];
}) {
  if (
    options.maxPeers !== undefined &&
    (!Number.isInteger(options.maxPeers) || options.maxPeers < 2 || options.maxPeers > 64)
  )
    throw new Error('Room capacity must be an integer between 2 and 64');
  const signer = await backendIdentity(options.keyPath),
    pubkey = await signer.getPublicKey();
  await mkdir(dirname(options.dataPath), { recursive: true, mode: 0o700 });
  const boards = new Boards(options.dataPath, pubkey);
  try {
    for (const definition of options.localBoards ?? []) boards.provision(definition);
  } catch (error) {
    boards.close();
    throw error;
  }
  const server = createMatchmakingServer(undefined, {
    boards,
    rooms: new Rooms(Date.now, 1000, options.maxPeers ?? 8),
    ice: (actor) =>
      turnCredentials(actor, options.turnUrls ?? [], options.turnSecret, options.relayOnly),
  });
  const pool = new ApplesauceRelayPool(options.relays);
  const transport = new NostrServerTransport({
    signer,
    relayHandler: pool,
    encryptionMode: EncryptionMode.REQUIRED,
    injectClientPubkey: true,
    isAnnouncedServer: options.announce ?? false,
    publishRelayList: options.announce ?? false,
    relayListUrls: options.publicRelays ?? options.relays,
    bootstrapRelayUrls: [],
    maxSessions: 1000,
    oversizedTransfer: { enabled: false },
    serverInfo: { name: 'napplet soy backend' },
    logLevel: 'warn',
  });
  transport.addListToolsResultTransformer((result) => ({
    ...result,
    tools: result.tools.map((tool) => ({
      ...tool,
      _meta: {
        ...tool._meta,
        'io.contextvm/common-schema': { schemaHash: computeCommonSchemaHash(tool) },
      },
    })),
  }));
  try {
    await server.connect(transport);
  } catch (error) {
    await server.close();
    await pool.disconnect();
    throw error;
  }
  return {
    provider: { pubkey, relays: options.relays },
    server,
    boards,
    close: async () => {
      await server.close();
      await pool.disconnect();
    },
  };
}
