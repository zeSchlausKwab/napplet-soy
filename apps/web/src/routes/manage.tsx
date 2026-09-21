import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useNostr } from '@/components/nostr-provider';
import { Button } from '@/components/ui/button';
import { LifecycleManager } from '@/components/lifecycle-manager';
import { savedLifecycles, saveLifecycle } from '@/lib/lifecycle';
import { queryCatalog } from '@/lib/protocol-catalog';
import {
  lifecycleUrl,
  nappletKey,
  parseReceipt,
  listingRemoved,
  type LifecycleReceipt,
} from '../../../../packages/lifecycle/src';
import type { PublicNapplet } from '../../../../packages/backend/src/public-model';
export const Route = createFileRoute('/manage')({
  head: () => ({
    meta: [{ title: 'Your napplets — napplet.soy' }, { name: 'robots', content: 'noindex' }],
  }),
  component: Manage,
});
function Manage() {
  const { pubkey, connect } = useNostr();
  const [items, setItems] = useState<PublicNapplet[]>([]),
    [records, setRecords] = useState<LifecycleReceipt[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!pubkey) {
      setItems([]);
      setRecords([]);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    setItems([]);
    const update = () => {
      try {
        setRecords(savedLifecycles(pubkey));
      } catch (e) {
        setError((e as Error).message);
      }
    };
    update();
    window.addEventListener('napplet-lifecycle', update);
    window.addEventListener('storage', update);
    queryCatalog(pubkey)
      .then((v) => {
        if (active) setItems(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      window.removeEventListener('napplet-lifecycle', update);
      window.removeEventListener('storage', update);
    };
  }, [pubkey]);
  const rows = new Map<string, { n?: PublicNapplet; record?: LifecycleReceipt }>(
    items.map((n) => [
      nappletKey(n.manifest),
      { n, record: undefined as LifecycleReceipt | undefined },
    ]),
  );
  for (const record of records) {
    const found = rows.get(record.plan.key);
    rows.set(record.plan.key, { n: found?.n, record });
  }
  return (
    <section className="detail-page">
      <span className="eyebrow">YOUR WORK</span>
      <h1>
        Your napplets<span className="coral">.</span>
      </h1>
      <p>
        Unpublish a listing, bring it back, or review and delete hosted data. Progress is saved on
        this device.
      </p>
      {!pubkey ? (
        <Button onClick={() => void connect()}>Sign in to manage your napplets</Button>
      ) : (
        <>
          <label className="back-link">
            Restore a saved recovery record{' '}
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                try {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 4 * 1024 * 1024) throw new Error('Recovery record exceeds 4 MiB.');
                  const r = parseReceipt(JSON.parse(await f.text()));
                  if (r.plan.author !== pubkey)
                    throw new Error('Select the author identity for this record.');
                  saveLifecycle(r);
                  setError('');
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  e.target.value = '';
                }
              }}
            />
          </label>
          {loading && <p role="status">Finding your publications…</p>}
          <div className="manage-list">
            {[...rows].map(([key, { n, record }]) => (
              <article className="manage-entry" key={key}>
                <div>
                  <h2>{record?.plan.title ?? n!.title}</h2>
                  <p>
                    {record
                      ? listingRemoved(record)
                        ? 'Unpublished · recovery record saved'
                        : record.operation === 'republish'
                          ? 'Republished or in progress'
                          : 'Saved operation'
                      : 'Published on Nostr'}
                  </p>
                  <Link to={record ? lifecycleUrl(record.plan) : `/n/${n!.naddr}`}>
                    View napplet
                  </Link>
                </div>
                <LifecycleManager
                  manifest={record?.plan.manifest ?? n!.manifest}
                  relays={record?.plan.relays ?? n!.relays}
                  metadata={record?.plan.metadata ?? n!.metadata}
                  saved={record}
                />
              </article>
            ))}
          </div>
          {!loading && !rows.size && (
            <p>No publications or saved recovery records found for this identity.</p>
          )}
          <p className="muted">
            An unpublished listing may no longer be available from relays. Keep the recovery record
            or your soyLI project to republish from another device.
          </p>
        </>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
