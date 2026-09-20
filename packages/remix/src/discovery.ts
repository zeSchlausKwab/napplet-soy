import { matchFilters, type Filter } from 'nostr-tools';
import { fromEvent, take, takeUntil, takeWhile } from 'rxjs';
import { openPlaybackRelay } from '../../backend/src/relay-tunnel';
import { AccountError } from '../../identity/src/signer';
import { verifiedEvent, type SignedEvent } from '../../protocol/src';

/** Finite, signer-free discovery using the same DNS-pinned Bun transport as playback. */
export async function discoverRemix(filter: Filter, relays: string[], signal: AbortSignal) {
  const events = new Map<string, SignedEvent>();
  let completed = 0;
  const cancelled = () =>
    new AccountError(
      'REMIX_CANCELLED',
      'Remix lookup was cancelled or timed out. Retry the command.',
    );
  if (signal.aborted) throw cancelled();
  await Promise.all(
    relays.map(async (value) => {
      const lifetime = new AbortController();
      const deadline = setTimeout(() => lifetime.abort(), 5000);
      const combined = AbortSignal.any([signal, lifetime.signal]);
      let pool: Awaited<ReturnType<typeof openPlaybackRelay>> | undefined;
      try {
        // Canonical URL must also match the transport's pinned destination.
        const relay = new URL(value).href;
        pool = await openPlaybackRelay(relay, combined);
        if (combined.aborted) return;
        await new Promise<void>((done) => {
          pool!
            .req([relay], [filter], { reconnect: false, waitForAuth: false })
            .pipe(
              takeWhile((m) => m.type !== 'EOSE' && m.type !== 'CLOSED', true),
              take(12),
              takeUntil(fromEvent(combined, 'abort')),
            )
            .subscribe({
              next: (message) => {
                if (message.type === 'EOSE') completed++;
                if (message.type !== 'EVENT') return;
                try {
                  const event = verifiedEvent(message.event);
                  if (matchFilters([filter], event) && event.created_at <= Date.now() / 1000 + 60)
                    events.set(event.id, event);
                } catch {
                  /* Untrusted relay events must pass signature and size checks. */
                }
              },
              error: () => done(),
              complete: done,
            });
        });
      } catch {
        /* One unavailable relay must not hide a valid result from another. */
      } finally {
        clearTimeout(deadline);
        lifetime.abort();
        pool?.close();
      }
    }),
  );
  if (signal.aborted) throw cancelled();
  const manifest = [...events.values()].sort(
    (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
  )[0];
  if (manifest) return manifest;
  if (!completed)
    throw new AccountError(
      'REMIX_RELAYS_UNAVAILABLE',
      'No relay completed the napplet lookup. Check your connection and retry; the release may still be available.',
    );
  throw new AccountError(
    'REMIX_NOT_FOUND',
    'The responding relays did not return this release. Try a portable naddr link for the latest version, or an nevent with a relay that retains this exact event.',
  );
}
