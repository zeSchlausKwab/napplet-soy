import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import defaults from '../packages/nostr/discovery-relays.json';

async function configuration(env: Record<string, string> = {}) {
  const child = Bun.spawn(
    [
      'bash',
      '-ec',
      'source "$1"; napplet_index_env napplet.example "$2"; printf "%s\\n%s\\n" "$SPACE_INDEX_RELAYS" "$SPACE_INDEX_HINTS"',
      '--',
      resolve('scripts/index-env.sh'),
      resolve('packages/nostr/discovery-relays.json'),
    ],
    { env: { PATH: process.env.PATH, ...env }, stdout: 'pipe', stderr: 'pipe' },
  );
  const output = await new Response(child.stdout).text();
  expect(await child.exited).toBe(0);
  const [relays, hints] = output
    .trim()
    .split('\n')
    .map((value) => value.split(','));
  return { relays, hints };
}

test('production queries the managed relay and the same public discovery relays as publicdev', async () => {
  expect(await configuration()).toEqual({
    relays: ['ws://127.0.0.1:19347/relay', ...defaults],
    hints: ['wss://relay.napplet.example', ...defaults],
  });
});
test('explicit operator relay lists remain authoritative and derive matching portable hints', async () => {
  expect(await configuration({ SPACE_INDEX_RELAYS: 'wss://chosen.example' })).toEqual({
    relays: ['wss://chosen.example'],
    hints: ['wss://chosen.example'],
  });
  expect(
    await configuration({
      SPACE_INDEX_RELAYS: 'ws://127.0.0.1:19347/relay',
      SPACE_INDEX_HINTS: 'wss://custom.example/relay',
    }),
  ).toEqual({ relays: ['ws://127.0.0.1:19347/relay'], hints: ['wss://custom.example/relay'] });
});
