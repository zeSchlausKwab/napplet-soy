import { signForAccount } from '@/lib/community-client';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { ShieldCheck, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNostr } from '@/components/nostr-provider';
import type {
  Policy,
  RuleType,
  ModerationAction,
} from '../../../../packages/moderation/src/policy';

export const Route = createFileRoute('/admin')({
  head: () => ({
    meta: [
      { title: 'Administration · napplet.soy' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: Admin,
});
type State = Pick<Policy, 'revision' | 'rules' | 'featured' | 'audit'> & { admins: string[] };
const labels: Record<RuleType, string> = {
  pubkey: 'Author',
  address: 'Napplet',
  event: 'Revision',
  hash: 'Blob hash',
};
function Admin() {
  const { pubkey } = useNostr();
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [type, setType] = useState<RuleType>('address');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [action, setAction] = useState<ModerationAction['action']>('block');
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const visible = pubkey === loadedKey ? state : null;
  async function request(mutate = false) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!pubkey)
        throw new Error('Connect the administrator account using the Connect button first.');
      if (mutate && !visible) throw new Error('Load the current policy first.');
      const url = new URL('/api/admin', location.origin).href;
      const method = mutate ? 'POST' : 'GET';
      const body = mutate
        ? JSON.stringify({ action, type, target, reason, revision: visible!.revision })
        : undefined;
      const tags = [
        ['u', url],
        ['method', method],
        ['nonce', crypto.randomUUID()],
      ];
      if (body) {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
        tags.push([
          'payload',
          Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join(''),
        ]);
      }
      const event = await signForAccount(pubkey, {
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000),
        content: '',
        tags,
      });
      const authorization = btoa(
        String.fromCharCode(...new TextEncoder().encode(JSON.stringify(event))),
      );
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Nostr ${authorization}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
        cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Request failed.');
      setState(result);
      setLoadedKey(pubkey);
      if (mutate) {
        setNotice(
          {
            block: 'Block saved.',
            unblock: 'Block removed.',
            feature: 'Featured napplet saved.',
            unfeature: 'Napplet removed from Featured.',
          }[action],
        );
        setTarget('');
        setReason('');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-page">
      <span className="eyebrow">
        <ShieldCheck size={16} /> SITE ADMINISTRATION
      </span>
      <h1>Keep the playground welcoming.</h1>
      <p className="muted">
        Manage content served by this site. Your signer approves each request; your private key
        stays with you.
      </p>
      <Button variant="outline" disabled={busy || !pubkey} onClick={() => void request()}>
        {busy ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />}{' '}
        {visible ? 'Refresh policy' : 'Load admin policy'}
      </Button>
      {!pubkey && <p className="muted">Connect your administrator account to begin.</p>}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {visible && (
        <>
          <div className="admin-summary">
            <strong>
              {visible.rules.length} active block{visible.rules.length === 1 ? '' : 's'}
            </strong>
            <span>
              Policy revision {visible.revision} · {visible.admins.length} administrator
              {visible.admins.length === 1 ? '' : 's'}
            </span>
          </div>
          <form
            className="admin-form"
            onSubmit={(e) => {
              e.preventDefault();
              void request(true);
            }}
          >
            <h2>Update the collection</h2>
            <div className="admin-fields">
              <label>
                Action
                <select
                  value={action}
                  onChange={(e) => {
                    setAction(e.target.value as typeof action);
                    if (['feature', 'unfeature'].includes(e.target.value)) setType('address');
                  }}
                  disabled={busy}
                >
                  <option value="block">Block</option>
                  <option value="unblock">Unblock</option>
                  <option value="feature">Feature</option>
                  <option value="unfeature">Remove from Featured</option>
                </select>
              </label>
              <label>
                Target type
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as RuleType)}
                  disabled={busy}
                >
                  {Object.entries(labels)
                    .filter(
                      ([value]) =>
                        !['feature', 'unfeature'].includes(action) ||
                        ['address', 'event'].includes(value),
                    )
                    .map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <label>
              Public identifier
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                maxLength={4096}
                required
                disabled={busy}
                placeholder={
                  type === 'address'
                    ? 'naddr1… or 35129:pubkey:identifier'
                    : type === 'pubkey'
                      ? 'npub1… or hex public key'
                      : type === 'event'
                        ? 'note1…, nevent1… or event ID'
                        : '64-character SHA-256 hash'
                }
              />
            </label>
            <label>
              Reason
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                required
                disabled={busy}
                rows={3}
                placeholder="Record why this change is needed"
              />
            </label>
            <p className="muted">
              An author block hides their content and rejects new uploads. A napplet block covers
              its address and linked snapshots. A blob block denies those exact bytes, including
              direct storage requests. Blocks do not delete stored data or remove copies from other
              services.
            </p>
            <Button disabled={busy || !target.trim() || !reason.trim()} type="submit">
              {busy && <LoaderCircle size={16} className="animate-spin" />}
              Sign and save change
            </Button>
          </form>
          <h2>Featured napplets</h2>
          <p className="muted">
            Select a napplet by naddr to follow its future releases, or an event ID to feature one
            revision. Nothing is featured automatically. Blocks still apply.
          </p>
          {!visible.featured.length && <p className="muted">The Featured collection is empty.</p>}
          <ul className="admin-rules">
            {visible.featured.map((r) => (
              <li key={`${r.type}:${r.target}`}>
                <div>
                  <span className="eyebrow">{labels[r.type]}</span>
                  <code>{r.target}</code>
                  <p>{r.reason}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setType(r.type);
                    setTarget(r.target);
                    setAction('unfeature');
                    setReason('');
                  }}
                >
                  Prepare removal
                </Button>
              </li>
            ))}
          </ul>
          <h2>Active blocks</h2>
          {!visible.rules.length && <p className="muted">No content is blocked.</p>}
          <ul className="admin-rules">
            {visible.rules.map((r) => (
              <li key={`${r.type}:${r.target}`}>
                <div>
                  <span className="eyebrow">{labels[r.type]}</span>
                  <code>{r.target}</code>
                  <p>{r.reason}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setType(r.type);
                    setTarget(r.target);
                    setAction('unblock');
                    setReason('');
                  }}
                >
                  Prepare unblock
                </Button>
              </li>
            ))}
          </ul>
          <h2>Recent changes</h2>
          <p className="muted">
            The latest 500 actions are retained. Administrators are configured by the server
            operator.
          </p>
          <ol className="admin-audit">
            {[...visible.audit]
              .reverse()
              .slice(0, 30)
              .map((r) => (
                <li key={r.revision}>
                  <strong>
                    #{r.revision} ·{' '}
                    {
                      {
                        block: 'Blocked',
                        unblock: 'Unblocked',
                        feature: 'Featured',
                        unfeature: 'Removed from Featured',
                      }[r.action]
                    }{' '}
                    {labels[r.type].toLowerCase()}
                  </strong>
                  <code>{r.target}</code>
                  <p>{r.reason}</p>
                  <small>
                    {new Date(r.at * 1000).toLocaleString()} · {r.actor.slice(0, 12)}…
                  </small>
                </li>
              ))}
          </ol>
        </>
      )}
    </section>
  );
}
