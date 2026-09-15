import { EventStore } from 'applesauce-core';
import { RelayPool } from 'applesauce-relay';
import { matchFilters, type Filter } from 'nostr-tools';
import { take, takeUntil, takeWhile, timer } from 'rxjs';
import { verifiedEvent, type SignedEvent } from '../../protocol/src';
import { readRelayUrl } from '../../nostr/src/relay-policy';

/** A browser-owned, signer-free store; all wire events are verified before ingestion. */
export class ProtocolClient {
  readonly store = new EventStore();
  private retained = new Set<string>();
  private remember(event: SignedEvent) {
    this.store.add(event);
    this.retained.add(event.id);
    while (this.retained.size > 8000) {
      const id = this.retained.values().next().value!;
      this.store.remove(id);
      this.retained.delete(id);
    }
  }
  constructor(
    readonly relays: () => string[],
    readonly allowed: (event: SignedEvent) => boolean = () => true,
  ) {}
  seed(inputs: SignedEvent[]) {
    for (const input of inputs)
      try {
        const event = verifiedEvent(input);
        this.remember(event);
      } catch {}
  }
  async query(filters: Filter[], hints: string[] = [], signal = AbortSignal.timeout(10000)) {
    const relays = [...new Set([...hints, ...this.relays()])]
      .flatMap((value) => {
        try {
          return [readRelayUrl(value, this.relays())];
        } catch {
          return [];
        }
      })
      .slice(0, 8);
    const found = new Map<string, SignedEvent>();
    let completed = 0;
    await Promise.all(
      relays.map(async (relay) => {
        const pool = new RelayPool();
        try {
          await new Promise<void>((resolve) => {
            if (signal.aborted) {
              resolve();
              return;
            }
            const subscription = pool
              .req([relay], filters, { reconnect: false, waitForAuth: false })
              .pipe(
                takeWhile((m) => m.type !== 'EOSE' && m.type !== 'CLOSED', true),
                take(1200),
                takeUntil(timer(3500)),
              )
              .subscribe({
                next: (m) => {
                  if (m.type === 'EOSE') completed++;
                  if (m.type !== 'EVENT' || found.size >= 1000) return;
                  try {
                    if (JSON.stringify(m.event).length > 70000) return;
                    const event = verifiedEvent(m.event);
                    if (
                      event.created_at <= Date.now() / 1000 + 60 &&
                      matchFilters(filters, event)
                    ) {
                      found.set(event.id, event);
                      this.remember(event);
                    }
                  } catch {}
                },
                error: () => resolve(),
                complete: resolve,
              });
            const abort = () => {
              subscription.unsubscribe();
              resolve();
            };
            signal.addEventListener('abort', abort, { once: true });
            subscription.add(() => signal.removeEventListener('abort', abort));
          });
        } finally {
          pool.close();
        }
      }),
    );
    signal.throwIfAborted();
    if (!completed && !found.size)
      throw new Error('No relay completed the query. Check your relay settings or retry.');
    return [...found.values()];
  }
  async publish(input: SignedEvent, hints: string[] = []) {
    const event = verifiedEvent(input);
    if (!this.allowed(event)) throw new Error('This action is unavailable here.');
    const relays = [...new Set([...this.relays(), ...hints])]
      .flatMap((value) => {
        try {
          return [readRelayUrl(value, this.relays())];
        } catch {
          return [];
        }
      })
      .slice(0, 8);
    const pool = new RelayPool();
    try {
      const results = await pool.publish(relays, event, { timeout: 6000, retries: false });
      if (!results.some((r) => r.ok))
        throw new Error('No relay acknowledged the event. Retry sends the same signed event.');
      this.seed([event]);
      return results.filter((r) => r.ok).map((r) => r.from);
    } finally {
      pool.close();
    }
  }
}
