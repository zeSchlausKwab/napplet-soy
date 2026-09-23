import { useSyncExternalStore } from 'react';
import { ZapTotalsStore } from '../../../../packages/client/src/zap-totals';

// Used in browser effects only; no payments or invoices are persisted or sent to our server.
export const zapTotalsStore = new ZapTotalsStore();
export function useZapTotals(scope: string) {
  return useSyncExternalStore(
    zapTotalsStore.subscribe,
    () => zapTotalsStore.get(scope),
    () => undefined,
  );
}
