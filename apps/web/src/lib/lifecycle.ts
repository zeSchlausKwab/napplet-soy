import { parseReceipt, type LifecycleReceipt } from '../../../../packages/lifecycle/src';
const prefix = 'napplet:lifecycle:';
export function savedLifecycles(pubkey: string) {
  const raw = localStorage.getItem(prefix + pubkey);
  if (!raw) return [] as LifecycleReceipt[];
  const values = JSON.parse(raw);
  if (!Array.isArray(values) || values.length > 100)
    throw new Error(
      'Invalid saved lifecycle records. Export a backup before clearing this browser’s data.',
    );
  return values.map(parseReceipt).filter((r) => r.plan.author === pubkey);
}
export function saveLifecycle(receipt: LifecycleReceipt) {
  const values = savedLifecycles(receipt.plan.author).filter(
    (r) => r.plan.key !== receipt.plan.key,
  );
  values.unshift(parseReceipt(receipt));
  // Never evict an unfinished operation or an author's recovery record silently.
  if (values.length > 100)
    throw new Error(
      'This browser has 100 lifecycle records. Export and preserve them before clearing any records.',
    );
  localStorage.setItem(prefix + receipt.plan.author, JSON.stringify(values));
  window.dispatchEvent(new Event('napplet-lifecycle'));
}
