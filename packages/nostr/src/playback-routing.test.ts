import { expect, test } from 'bun:test';
import { finalizeEvent } from 'nostr-tools';
import { Observable } from 'rxjs';
import { PlaybackNostr, type PlaybackReadPool } from './playback';

test('an explicit station relay hint is read even when discovery relays do not have its event', async () => {
  const station = finalizeEvent(
    {
      kind: 31237,
      tags: [['d', 'station']],
      content: 'stream',
      created_at: Math.floor(Date.now() / 1000),
    },
    new Uint8Array(32).fill(2),
  );
  const reads: string[] = [];
  const pool: PlaybackReadPool = {
    close() {},
    req: (relays, filters) =>
      new Observable((output) => {
        for (const from of relays) {
          reads.push(from);
          if (from === 'wss://station.example/' && filters[0].kinds?.includes(31237))
            output.next({ type: 'EVENT', from, event: station });
          output.next({ type: 'EOSE', from });
        }
        output.complete();
      }),
  };
  const host = new PlaybackNostr(
    ['wss://discovery.example/'],
    () => {},
    () => null,
    pool,
  );
  try {
    const result = await host.handle({
      type: 'outbox.query',
      filters: { kinds: [31237], authors: [station.pubkey], '#d': ['station'], limit: 10 },
      options: { relays: ['wss://station.example'], timeoutMs: 1000 },
    });
    expect(result).toMatchObject({ events: [{ event: station }] });
    expect(reads).toContain('wss://station.example/');
  } finally {
    host.close();
  }
});
