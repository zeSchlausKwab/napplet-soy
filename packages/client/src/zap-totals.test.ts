import { expect, test } from 'bun:test';
import { ZapTotalsStore } from './zap-totals';

test('confirmed payments update all observers and reconcile with delayed/duplicate receipts', () => {
  const store = new ZapTotalsStore();
  let changes = 0,
    confirmations = 0;
  const unsubscribe = store.subscribe(() => changes++);
  store.onPayment(() => confirmations++);
  const old = { paymentHash: 'a'.repeat(64), msats: 1000 };
  const paid = { paymentHash: 'b'.repeat(64), msats: 21000 };
  store.observe('napplet', [old]);
  store.confirm('napplet', paid);
  expect(store.get('napplet')).toEqual({ zapCount: 2, msats: 22000 });
  const snapshot = store.get('napplet');
  store.confirm('napplet', paid);
  store.observe('napplet', [old]); // stale relay read cannot undo a confirmation
  store.observe('napplet', [old, paid, paid]);
  expect(store.get('napplet')).toBe(snapshot);
  expect(changes).toBe(2);
  expect(confirmations).toBe(1);
  store.confirm('comment', { paymentHash: 'c'.repeat(64), msats: 5000 });
  expect(store.get('napplet')).toBe(snapshot);
  expect(store.get('comment')).toEqual({ zapCount: 1, msats: 5000 });
  unsubscribe();
  store.observe('another', []);
  expect(changes).toBe(3);
});
