export type ZapPayment = { paymentHash: string; msats: number };
export type ZapCount = { zapCount: number; msats: number };

/** Tab-local confirmations bridge relay lag; matching receipts never count twice.
 * Feed only checked provider receipts, LUD-21 confirmations or wallet preimages. */
export class ZapTotalsStore {
  private scopes = new Map<string, Map<string, number>>();
  private totals = new Map<string, ZapCount>();
  private listeners = new Set<() => void>();
  private paymentListeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  onPayment = (listener: () => void) => {
    this.paymentListeners.add(listener);
    return () => {
      this.paymentListeners.delete(listener);
    };
  };
  get = (scope: string) => this.totals.get(scope);
  observe(scope: string, payments: ZapPayment[]) {
    const entries = this.scopes.get(scope) ?? new Map<string, number>();
    for (const payment of payments) {
      if (
        /^[a-f0-9]{64}$/.test(payment.paymentHash) &&
        Number.isSafeInteger(payment.msats) &&
        payment.msats > 0 &&
        !entries.has(payment.paymentHash)
      )
        entries.set(payment.paymentHash, payment.msats);
    }
    while (entries.size > 2000) entries.delete(entries.keys().next().value!);
    this.scopes.set(scope, entries);
    const next = {
      zapCount: entries.size,
      msats: [...entries.values()].reduce((a, b) => a + b, 0),
    };
    const previous = this.get(scope);
    if (!previous || previous.zapCount !== next.zapCount || previous.msats !== next.msats) {
      this.totals.set(scope, next);
      while (this.scopes.size > 256) {
        const key = this.scopes.keys().next().value!;
        this.scopes.delete(key);
        this.totals.delete(key);
      }
      for (const listener of this.listeners) listener();
    }
    return this.get(scope)!;
  }
  confirm(scope: string, payment: ZapPayment) {
    const before = this.get(scope);
    const after = this.observe(scope, [payment]);
    if (before !== after) for (const listener of this.paymentListeners) listener();
  }
}
