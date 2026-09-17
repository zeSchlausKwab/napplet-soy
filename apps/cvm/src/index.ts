import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { backendIdentity, startBackend } from '../../../packages/multiplayer/src/service';
import { validateProvider } from '../../../packages/multiplayer/src/client';

const keyPath =
  process.env.SPACE_CVM_KEY_PATH || resolve(import.meta.dir, '../../../.local/contextvm/identity');
export async function startMatchmaking() {
  const relays = (process.env.SPACE_CVM_RELAYS ?? '').split(',').filter(Boolean);
  validateProvider({ pubkey: '0'.repeat(64), relays }, relays);
  const service = await startBackend({
    relays,
    keyPath,
    dataPath:
      process.env.SPACE_CVM_DATA_PATH ||
      resolve(import.meta.dir, '../../../.local/contextvm/boards.sqlite'),
    announce: process.env.SPACE_CVM_ANNOUNCE === '1',
    publicRelays: (process.env.SPACE_CVM_PUBLIC_RELAYS || process.env.SPACE_CVM_RELAYS || '')
      .split(',')
      .filter(Boolean),
    maxPeers: Number(process.env.SPACE_CVM_MAX_PEERS || 8),
    turnUrls: (process.env.SPACE_TURN_URLS ?? '').split(',').filter(Boolean),
    turnSecret: process.env.SPACE_TURN_SECRET_PATH
      ? (await readFile(process.env.SPACE_TURN_SECRET_PATH, 'utf8')).trim()
      : undefined,
    relayOnly: process.env.SPACE_TURN_RELAY_ONLY === '1',
  });
  console.log(`ContextVM backend listening as ${service.provider.pubkey}`);
  return service;
}
if (import.meta.main) {
  try {
    if (process.argv.includes('--identity'))
      console.log(await (await backendIdentity(keyPath)).getPublicKey());
    else {
      const service = await startMatchmaking();
      for (const signal of ['SIGINT', 'SIGTERM'] as const)
        process.once(signal, () => {
          void service.close().finally(() => process.exit(0));
        });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
