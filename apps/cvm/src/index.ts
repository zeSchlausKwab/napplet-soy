import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { generateSecretKey } from 'nostr-tools';
import {
  NostrServerTransport,
  PrivateKeySigner,
  ApplesauceRelayPool,
  EncryptionMode,
} from '@contextvm/sdk';
import { createMatchmakingServer } from '../../../packages/multiplayer/src/server';

export async function startMatchmaking() {
  const relays = (process.env.SPACE_CVM_RELAYS ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (!relays.length || relays.length > 8)
    throw new Error('Set SPACE_CVM_RELAYS to your relay URL(s) before starting ContextVM.');
  for (const relay of relays) {
    const url = new URL(relay);
    if (
      !(
        url.protocol === 'wss:' ||
        (url.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      ) ||
      url.username ||
      url.password
    )
      throw new Error(
        'ContextVM requires wss:// relays (ws:// is allowed on loopback for local development).',
      );
  }
  const keyPath =
    process.env.SPACE_CVM_KEY_PATH ||
    resolve(import.meta.dir, '../../../.local/contextvm/identity');
  await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });
  try {
    const file = await open(keyPath, 'wx', 0o600);
    try {
      await file.writeFile(Buffer.from(generateSecretKey()).toString('hex'));
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const secret = (await readFile(keyPath, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Invalid ContextVM server identity file');
  const signer = new PrivateKeySigner(secret);
  const pool = new ApplesauceRelayPool(relays);
  const server = createMatchmakingServer();
  const transport = new NostrServerTransport({
    signer,
    relayHandler: pool,
    encryptionMode: EncryptionMode.REQUIRED,
    injectClientPubkey: true,
    isAnnouncedServer: process.env.SPACE_CVM_ANNOUNCE === '1',
    publishRelayList: process.env.SPACE_CVM_ANNOUNCE === '1',
    serverInfo: { name: 'napplet.space matchmaking' },
    logLevel: 'warn',
  });
  await server.connect(transport);
  console.log(`ContextVM matchmaking listening as ${await signer.getPublicKey()}`);
  return {
    server,
    transport,
    close: async () => {
      await server.close();
      await pool.disconnect();
    },
  };
}
if (import.meta.main) {
  try {
    const service = await startMatchmaking();
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => {
        void service.close().finally(() => process.exit(0));
      });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
