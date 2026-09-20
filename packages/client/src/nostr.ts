import { EventStore } from 'applesauce-core';
import { RelayPool } from 'applesauce-relay';
import { matchFilters, type Filter } from 'nostr-tools';
import { take, takeUntil, takeWhile, timer } from 'rxjs';
import { verifiedEvent, type SignedEvent } from '../../protocol/src';
import { readRelayUrl } from '../../nostr/src/relay-policy';

/** A browser-owned, signer-free store; all wire events are verified before ingestion. */
export class ProtocolClient {
  readonly store = new EventStore();
  private retained = new Map<string, number>();
  private retainedBytes = 0;
  private connections = new Map<
    string,
    { pool: RelayPool; users: number; timer?: ReturnType<typeof setTimeout> }
  >();
  private connection(url: string) {
    let entry = this.connections.get(url);
    if (!entry) {
      if (this.connections.size >= 24) {
        const idle = [...this.connections].find(([, e]) => !e.users);
        if (!idle) throw new Error('Relay connections are busy. Retry shortly.');
        clearTimeout(idle[1].timer);
        idle[1].pool.close();
        this.connections.delete(idle[0]);
      }
      entry = { pool: new RelayPool(), users: 0 };
      this.connections.set(url, entry);
    }
    clearTimeout(entry.timer);
    entry.users++;
    const current = entry;
    return {
      pool: current.pool,
      release: () => {
        if (--current.users || this.connections.get(url) !== current) return;
        current.timer = setTimeout(() => {
          current.pool.close();
          this.connections.delete(url);
        }, 10000);
        (current.timer as any).unref?.();
      },
    };
  }
  close() {
    for (const entry of this.connections.values()) {
      clearTimeout(entry.timer);
      entry.pool.close();
    }
    this.connections.clear();
  }
  private remember(event: SignedEvent) {
    this.store.add(event);
    if (!this.retained.has(event.id)) {
      const bytes = JSON.stringify(event).length * 2;
      this.retained.set(event.id, bytes);
      this.retainedBytes += bytes;
    }
    while (this.retained.size > 8000 || this.retainedBytes > 16 * 1024 ** 2) {
      const id = this.retained.keys().next().value!;
      this.retainedBytes -= this.retained.get(id)!;
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
  async query(
    filters: Filter[],
    hints: string[] = [],
    signal = AbortSignal.timeout(10000),
    onEvent?: (event: SignedEvent) => void,
    requireComplete = false,
  ) {
    const relays = [...new Set([...hints, ...this.relays()])]
      .flatMap((value) => {
        try {
          return [readRelayUrl(value, this.relays(), true)];
        } catch {
          return [];
        }
      })
      .slice(0, 8);
    const found = new Map<string, SignedEvent>();
    let completed = 0;
    await Promise.all(
      relays.map(async (relay) => {
        let connection: ReturnType<ProtocolClient['connection']> | undefined;
        try {
          connection = this.connection(relay);
          const pool = connection.pool;
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
                      const fresh = !found.has(event.id);
                      found.set(event.id, event);
                      this.remember(event);
                      if (fresh) onEvent?.(event);
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
          connection?.release();
        }
      }),
    );
    signal.throwIfAborted();
    if (requireComplete && (!relays.length || completed !== relays.length))
      throw new Error('list-unavailable');
    if (!completed && !found.size)
      throw new Error('No relay completed the query. Check your relay settings or retry.');
    return [...found.values()];
  }
  async publish(input: SignedEvent, hints: string[] = [], signal?: AbortSignal) {
    signal?.throwIfAborted();
    const event = verifiedEvent(input);
    if (!this.allowed(event)) throw new Error('This action is unavailable here.');
    const relays = [...new Set([...this.relays(), ...hints])]
      .flatMap((value) => {
        try {
          return [readRelayUrl(value, this.relays(), true)];
        } catch {
          return [];
        }
      })
      .slice(0, 8);
    const results = (
      await Promise.all(
        relays.map(async (relay) => {
          signal?.throwIfAborted();
          const connection = this.connection(relay);
          try {
            return await connection.pool.publish([relay], event, { timeout: 6000, retries: false });
          } finally {
            connection.release();
          }
        }),
      )
    ).flat();
    if (!results.some((r) => r.ok))
      throw new Error('No relay acknowledged the event. Retry sends the same signed event.');
    this.seed([event]);
    return results.filter((r) => r.ok).map((r) => r.from);
  }
}
