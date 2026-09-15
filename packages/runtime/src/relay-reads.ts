import { Observable, merge, Subscription } from 'rxjs';
import type { PlaybackReadPool, ReadMessage } from '../../nostr/src/playback';

/** Abortable read streams. The backend owns actual connection/DNS policy. */
export function hostReadPool(manifest: string, fetcher: typeof fetch = fetch): PlaybackReadPool {
  const lifetime = new Subscription();
  return {
    close: () => lifetime.unsubscribe(),
    req: (relays, filters, options) =>
      merge(
        ...relays.map(
          (from) =>
            new Observable<ReadMessage>((output) => {
              const controller = new AbortController();
              const stop = () => controller.abort();
              lifetime.add(stop);
              if (lifetime.closed) {
                output.complete();
                return;
              }
              void (async () => {
                let ended = false;
                const response = await fetcher('/api/relay-read', {
                  method: 'POST',
                  credentials: 'omit',
                  signal: controller.signal,
                  headers: { 'Content-Type': 'application/json', 'X-Space-Host': '1' },
                  body: JSON.stringify({ manifest, relay: from, filters, ...options }),
                });
                if (!response.ok || !response.body) throw new Error('Relay read refused');
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '',
                  bytes = 0;
                try {
                  while (!controller.signal.aborted) {
                    const next = await reader.read();
                    if (next.done) break;
                    if ((bytes += next.value.length) > 8 * 1024 ** 2)
                      throw new Error('Relay read too large');
                    buffer += decoder.decode(next.value, { stream: true });
                    let newline: number;
                    while ((newline = buffer.indexOf('\n')) >= 0) {
                      if (newline > 70000) throw new Error('Relay message too large');
                      const message = JSON.parse(buffer.slice(0, newline));
                      buffer = buffer.slice(newline + 1);
                      if (['EVENT', 'EOSE', 'CLOSED'].includes(message.type)) {
                        output.next({
                          type: message.type,
                          from,
                          event: message.event,
                          reason: message.reason,
                        });
                        if (message.type === 'CLOSED' || (message.type === 'EOSE' && !options.live))
                          ended = true;
                      }
                    }
                    if (buffer.length > 70000) throw new Error('Relay message too large');
                  }
                  if (!ended && !controller.signal.aborted)
                    output.next({ type: 'CLOSED', from, reason: 'Relay stream ended' });
                } finally {
                  await reader.cancel().catch(() => {});
                }
              })()
                .catch(() => {
                  if (!controller.signal.aborted)
                    output.next({ type: 'CLOSED', from, reason: 'Relay read failed or denied' });
                })
                .finally(() => output.complete());
              return () => {
                stop();
                lifetime.remove(stop);
              };
            }),
        ),
      ),
  };
}
