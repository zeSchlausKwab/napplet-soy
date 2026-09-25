import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ShieldCheck,
  LoaderCircle,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Search,
  Check,
  Ban,
  Star,
  Users,
  FileCode,
  Boxes,
  Server,
  History,
  ListOrdered,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNostr } from '@/components/nostr-provider';
import { adminRequest, AdminRequestError } from '@/lib/admin-client';
import { adminTarget, targetChoices, type Entity, type TargetChoice } from '@/lib/admin-targets';
import type { ModerationAction } from '../../../../packages/moderation/src/policy';
import type { AdminState } from '../../../../packages/moderation/src/admin-model';

export const Route = createFileRoute('/admin')({
  head: () => ({
    meta: [
      { title: 'Administration · napplet.soy' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: Admin,
});
type Change = Omit<ModerationAction, 'revision'>;
const sections = [
  {
    entity: 'address',
    title: 'Napplets',
    icon: Star,
    hint: 'Search by title or creator, or paste an naddr / napplet link.',
    scope:
      'A napplet block covers its address and linked snapshots. Featured addresses follow future releases.',
  },
  {
    entity: 'pubkey',
    title: 'Creators',
    icon: Users,
    hint: 'Search known creators, or paste an npub / hex public key.',
    scope:
      'An author block hides their content and rejects future publications and uploads on our services.',
  },
  {
    entity: 'event',
    title: 'Revisions',
    icon: FileCode,
    hint: 'Search by title, or paste a note, nevent, event ID or revision link.',
    scope:
      'A revision block covers one signed event. Featuring a revision pins that exact release.',
  },
  {
    entity: 'hash',
    title: 'Assets',
    icon: Boxes,
    hint: 'Search known files, or paste a SHA-256 hash / Blossom file URL.',
    scope:
      'An asset block denies those exact bytes, including direct storage requests. Stored data is retained.',
  },
  {
    entity: 'backend',
    title: 'Backend slots',
    icon: Server,
    hint: 'Search creators, or paste an npub / hex public key.',
    scope:
      'Allow creators to deploy persistent backend rules on our CVM. This grants deployment access, not site administration. Removing access stops new builds and activations; existing worlds keep running.',
  },
  {
    entity: 'admin',
    title: 'Administrators',
    icon: ShieldCheck,
    hint: 'Search known people, or paste an npub / hex public key.',
    scope:
      'Administrators can curate, moderate and manage other admins. Recovery administrators are managed in server configuration.',
  },
] as const;
const outcomes: Record<Change['action'], string> = {
  block: 'Blocked',
  unblock: 'Unblocked',
  feature: 'Featured',
  unfeature: 'Removed from Featured',
  'feature-up': 'Moved earlier',
  'feature-down': 'Moved later',
  'admin-add': 'Administrator added',
  'admin-remove': 'Administrator removed',
  'backend-allow': 'Deployment access granted',
  'backend-revoke': 'Deployment access removed',
};
function Admin() {
  const { pubkey, adminAccess, refreshAdminAccess, needsReconnect, connect } = useNostr();
  return (
    <section className="admin-page">
      <span className="eyebrow">
        <ShieldCheck size={16} /> SITE ADMINISTRATION
      </span>
      <h1>Keep the playground welcoming.</h1>
      <p className="muted">
        Choose what needs attention. Every change keeps a reason and is approved by your signer.
      </p>
      {!pubkey ? (
        <Button onClick={() => void connect()}>Connect an administrator</Button>
      ) : adminAccess === 'checking' ? (
        <p role="status">
          <LoaderCircle className="animate-spin inline" size={16} /> Checking admin access…
        </p>
      ) : adminAccess === 'error' ? (
        <Button variant="outline" onClick={() => void refreshAdminAccess()}>
          Retry admin access check
        </Button>
      ) : adminAccess === 'denied' ? (
        <p role="status">This account is not an administrator.</p>
      ) : (
        <AdminWorkspace key={pubkey} pubkey={pubkey} needsReconnect={needsReconnect} />
      )}
    </section>
  );
}
function AdminWorkspace({ pubkey, needsReconnect }: { pubkey: string; needsReconnect: boolean }) {
  const { refreshAdminAccess, connect } = useNostr();
  const router = useRouter();
  const [tab, setTab] = useState<string>('address');
  const tabs = [
    ...sections.map((s) => ({ id: s.entity, label: s.title, icon: s.icon })),
    { id: 'featured', label: 'Featured', icon: ListOrdered },
    { id: 'history', label: 'History', icon: History },
  ];
  const [state, setState] = useState<AdminState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const attempted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, []);
  async function load() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    try {
      const data = await adminRequest(pubkey, controller.signal);
      if (!data.catalog) throw new Error('Administration search data is missing. Please retry.');
      if (mounted.current) setState({ ...data, catalog: data.catalog });
    } catch (error) {
      if (mounted.current) {
        setError(error instanceof Error ? error.message : 'Could not load administration.');
        if (error instanceof AdminRequestError && error.status === 403) {
          setState(null);
          void refreshAdminAccess();
        }
      }
    } finally {
      active.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!needsReconnect && !attempted.current) {
      attempted.current = true;
      void load();
    }
  }, [needsReconnect]);
  async function change(input: Change) {
    if (!state || active.current) throw new Error('Wait for the current request to finish.');
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    try {
      const result = await adminRequest(pubkey, controller.signal, {
        ...input,
        revision: state.revision,
      });
      if (mounted.current) {
        setState((old) => (old ? { ...old, ...result, catalog: old.catalog } : null));
        void router.invalidate();
        if (input.action.startsWith('admin-')) void refreshAdminAccess();
      }
    } catch (error) {
      if (mounted.current && error instanceof AdminRequestError) {
        if (error.status === 403) {
          setState(null);
          void refreshAdminAccess();
        }
        if (error.status === 409) {
          // Refresh only the policy; retain each section's target/reason for an explicit retry.
          try {
            const latest = await adminRequest(pubkey, controller.signal);
            if (mounted.current && latest.catalog) setState({ ...latest, catalog: latest.catalog });
          } catch (refreshError) {
            if (mounted.current) {
              setError(
                'Could not refresh the changed policy. Refresh or retry when your signer is ready.',
              );
              if (refreshError instanceof AdminRequestError && refreshError.status === 403) {
                setState(null);
                void refreshAdminAccess();
              }
            }
          }
        }
      }
      throw error;
    } finally {
      active.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <div className="admin-toolbar">
        <p className="muted">
          {state
            ? `${state.rules.length} active blocks · ${state.admins.length} administrators · Revision ${state.revision}`
            : 'Loading your administration workspace…'}
        </p>
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          {busy ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          {state
            ? 'Refresh policy'
            : error
              ? 'Retry loading administration'
              : 'Loading administration'}
        </Button>
      </div>
      {needsReconnect && <Button onClick={() => void connect()}>Reconnect selected signer</Button>}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {state && (
        <>
          <div className="admin-tabs" role="tablist" aria-label="Administration sections">
            {tabs.map(({ id, label, icon: Icon }, index) => {
              const count =
                id === 'backend'
                  ? state.backendCreators.length
                  : id === 'admin'
                    ? state.admins.length
                    : id === 'featured'
                      ? state.featured.length
                      : id === 'history'
                        ? state.audit.length
                        : state.rules.filter((r) => r.type === id).length;
              return (
                <button
                  type="button"
                  role="tab"
                  key={id}
                  id={`admin-tab-${id}`}
                  aria-selected={tab === id}
                  aria-controls={`admin-panel-${id}`}
                  tabIndex={tab === id ? 0 : -1}
                  onClick={() => setTab(id)}
                  onKeyDown={(event) => {
                    const next =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? tabs.length - 1
                          : event.key === 'ArrowRight'
                            ? (index + 1) % tabs.length
                            : event.key === 'ArrowLeft'
                              ? (index + tabs.length - 1) % tabs.length
                              : -1;
                    if (next < 0) return;
                    event.preventDefault();
                    setTab(tabs[next].id);
                    document
                      .getElementById(`admin-tab-${tabs[next].id}`)
                      ?.focus({ preventScroll: true });
                    document
                      .getElementById(`admin-tab-${tabs[next].id}`)
                      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                  }}
                >
                  <Icon size={17} />
                  <span>{label}</span>
                  <span className="admin-tab-count" aria-hidden="true">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="muted admin-search-note">
            Search covers up to {state.catalog.limit.toLocaleString()} recent indexed releases and
            saved policy entries, including blocked content. Paste an exact identifier to manage
            anything else.
          </p>
          {sections.map((section) => (
            <div
              key={section.entity}
              role="tabpanel"
              id={`admin-panel-${section.entity}`}
              aria-labelledby={`admin-tab-${section.entity}`}
              hidden={tab !== section.entity}
              tabIndex={0}
            >
              {section.entity === 'backend' && (
                <div className="admin-hosting-status">
                  <span className={`admin-hosting-dot ${state.backendHosting ? 'is-live' : ''}`} />
                  <div>
                    <strong>
                      {state.backendHosting
                        ? 'Backend hosting enabled'
                        : 'Backend hosting is not enabled'}
                    </strong>
                    <p>
                      {state.backendHosting
                        ? 'Grants apply to the next deployment request. Each creator can register up to 8 modules.'
                        : 'You can prepare access now. Hosting must be enabled in server configuration before creators can deploy.'}
                    </p>
                  </div>
                </div>
              )}
              <EntitySection section={section} state={state} busy={busy} change={change} />
            </div>
          ))}
          <div
            role="tabpanel"
            id="admin-panel-featured"
            aria-labelledby="admin-tab-featured"
            hidden={tab !== 'featured'}
            tabIndex={0}
          >
            <FeaturedOrder state={state} busy={busy} change={change} />
          </div>
          <div
            role="tabpanel"
            id="admin-panel-history"
            aria-labelledby="admin-tab-history"
            hidden={tab !== 'history'}
            tabIndex={0}
          >
            <section
              id="admin-history"
              className="admin-history"
              aria-labelledby="admin-history-title"
            >
              <h2 id="admin-history-title">Recent changes</h2>
              <p className="muted">Showing the latest 30 of up to 500 retained actions.</p>
              {!state.audit.length && (
                <p className="admin-empty muted">
                  No changes yet. Signed actions and their reasons will appear here.
                </p>
              )}
              <ol className="admin-audit">
                {[...state.audit]
                  .reverse()
                  .slice(0, 30)
                  .map((item) => (
                    <li key={item.revision}>
                      <strong>
                        #{item.revision} · {outcomes[item.action]}
                      </strong>
                      <code>{item.target}</code>
                      <p>{item.reason}</p>
                      <small>
                        {new Date(item.at * 1000).toLocaleString()} · {item.actor.slice(0, 12)}…
                      </small>
                    </li>
                  ))}
              </ol>
            </section>
          </div>
        </>
      )}
    </>
  );
}
function EntitySection({
  section,
  state,
  busy,
  change,
}: {
  section: (typeof sections)[number];
  state: AdminState;
  busy: boolean;
  change: (input: Change) => Promise<void>;
}) {
  const { entity, title, icon: Icon } = section;
  const type = entity === 'admin' || entity === 'backend' ? 'pubkey' : entity;
  const [query, setQuery] = useState('');
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState<TargetChoice | null>(null);
  const [feedback, setFeedback] = useState<{
    action: Change['action'];
    status: 'busy' | 'done' | 'error';
    message?: string;
  } | null>(null);
  const choices = useMemo(() => targetChoices(state, entity), [state, entity]);
  const normalized = useMemo(() => {
    try {
      return adminTarget(type, query);
    } catch {
      return null;
    }
  }, [type, query]);
  const target = selected?.target || normalized;
  const selection = selected || choices.find((c) => c.target === normalized);
  const matches = query.trim()
    ? choices
        .filter((c) => c.search.includes(query.trim().toLowerCase()) || c.target === normalized)
        .slice(0, 8)
    : [];
  const blocked = state.rules.some((r) => r.type === type && r.target === target);
  const featured = state.featured.some((r) => r.type === type && r.target === target);
  const member = !!target && state.admins.includes(target);
  const recovery = !!target && state.recoveryAdmins.includes(target);
  const admitted = !!target && state.backendCreators.includes(target);
  const configured = !!target && state.configuredBackendCreators.includes(target);
  const actions: { action: Change['action']; label: string; disabled?: boolean }[] =
    entity === 'backend'
      ? [
          {
            action: admitted ? 'backend-revoke' : 'backend-allow',
            label: admitted ? 'Remove deployment access' : 'Allow deployment',
            disabled: configured || (!admitted && blocked),
          },
        ]
      : entity === 'admin'
        ? [
            {
              action: member ? 'admin-remove' : 'admin-add',
              label: member ? 'Remove administrator' : 'Add administrator',
              disabled: recovery,
            },
          ]
        : [
            { action: blocked ? 'unblock' : 'block', label: blocked ? 'Unblock' : 'Block' },
            ...(['address', 'event'].includes(type)
              ? [
                  {
                    action: featured ? ('unfeature' as const) : ('feature' as const),
                    label: featured ? 'Remove from Featured' : 'Feature',
                    disabled: !featured && blocked,
                  },
                ]
              : []),
          ];
  const saved =
    entity === 'backend'
      ? state.backendCreators.map((target) => ({
          target,
          reason: state.configuredBackendCreators.includes(target)
            ? 'Operator grant · server configuration'
            : [...state.audit]
                .reverse()
                .find((a) => a.action === 'backend-allow' && a.target === target)?.reason ||
              'Deployment access granted',
        }))
      : entity === 'admin'
        ? state.admins.map((target) => ({
            target,
            reason: state.recoveryAdmins.includes(target)
              ? 'Recovery administrator · server configuration'
              : 'Administrator',
          }))
        : state.rules.filter((r) => r.type === type);
  const savedMatches = saved.filter(
    (item) =>
      !query.trim() ||
      item.target === target ||
      `${item.target} ${item.reason} ${choices.find((c) => c.target === item.target)?.search ?? ''}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  function choose(choice: TargetChoice) {
    setSelected(choice);
    setQuery(choice.target);
    setFeedback(null);
    setReason('');
  }
  async function act(action: Change['action']) {
    if (!target || !reason.trim()) return;
    setFeedback({ action, status: 'busy' });
    try {
      await change({ action, type, target, reason });
      setFeedback({ action, status: 'done' });
      setReason('');
    } catch (error) {
      setFeedback({
        action,
        status: 'error',
        message: error instanceof Error ? error.message : 'Request failed.',
      });
    }
  }
  // Preserve the failed action even if an automatic policy refresh changed available actions.
  const failed = feedback?.status === 'error' ? feedback : null;
  return (
    <section
      id={`admin-${entity}`}
      className="admin-form admin-entity"
      aria-labelledby={`admin-${entity}-title`}
    >
      <div className="admin-section-title">
        <Icon size={22} />
        <h2 id={`admin-${entity}-title`}>{title}</h2>
      </div>
      <p className="muted">{section.scope}</p>
      <label>
        <span>
          <Search size={15} /> Search {title.toLowerCase()} or paste an identifier
        </span>
        <input
          type="search"
          value={query}
          maxLength={4096}
          placeholder={section.hint}
          disabled={busy}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
            setFeedback(null);
          }}
        />
      </label>
      {!!matches.length && !selected && !normalized && (
        <ul className="admin-matches" aria-label={`${title} search results`}>
          {matches.map((choice) => (
            <li key={choice.target}>
              <button type="button" onClick={() => choose(choice)}>
                <strong>{choice.label}</strong>
                <code>{choice.target}</code>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim() && !target && !matches.length && (
        <p className="muted" role="status">
          No local match. Paste a valid{' '}
          {type === 'pubkey'
            ? 'npub or public key'
            : type === 'address'
              ? 'napplet naddr'
              : type === 'event'
                ? 'event identifier'
                : 'SHA-256 hash'}
          .
        </p>
      )}
      {target && (
        <div className="admin-selection">
          <strong>{selection?.label || 'Identifier selected'}</strong>
          <code>{target}</code>
          <span className="muted">
            {entity === 'backend'
              ? blocked
                ? 'Deployment suspended · creator is blocked'
                : configured
                  ? 'Deployment allowed · operator grant'
                  : admitted
                    ? 'Deployment allowed'
                    : 'No deployment access'
              : entity === 'admin'
                ? recovery
                  ? 'Recovery administrator · server configuration'
                  : member
                    ? 'Administrator'
                    : 'Not an administrator'
                : `${blocked ? 'Blocked' : 'No direct block'}${featured ? ' · Featured' : ''}`}
          </span>
        </div>
      )}
      <label>
        {title} change reason
        <textarea
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setFeedback(null);
          }}
          maxLength={500}
          rows={2}
          disabled={busy}
          placeholder="Why is this change needed?"
        />
      </label>
      <div className="admin-actions">
        {actions.map(({ action, label, disabled }) => (
          <Button
            key={action}
            variant="outline"
            disabled={busy || !target || !reason.trim() || disabled}
            onClick={() => void act(action)}
          >
            {feedback?.status === 'busy' && feedback.action === action ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : action === 'block' ? (
              <Ban size={16} />
            ) : null}
            {feedback?.status === 'busy' && feedback.action === action ? 'Saving…' : label}
          </Button>
        ))}
        {feedback?.status === 'done' && (
          <Button disabled variant="ghost" role="status" className="admin-action-result">
            <Check size={16} />
            {outcomes[feedback.action]}
          </Button>
        )}
      </div>
      {failed && (
        <Button
          className="admin-retry"
          aria-label="Retry change"
          aria-describedby={`admin-${entity}-error`}
          variant="outline"
          disabled={busy || !target || !reason.trim()}
          onClick={() => void act(failed.action)}
        >
          <RefreshCw size={15} />
          <span role="alert" id={`admin-${entity}-error`}>
            {failed.message} Retry.
          </span>
        </Button>
      )}
      {entity === 'backend' && !saved.length && (
        <p className="admin-empty muted">
          No accounts have deployment access yet. Select a creator above to grant access.
        </p>
      )}
      {!!saved.length && (
        <details className="admin-saved" open={entity === 'admin' || entity === 'backend'}>
          <summary>
            {entity === 'backend'
              ? `${saved.length} account${saved.length === 1 ? '' : 's'} with deployment access`
              : entity === 'admin'
                ? `${saved.length} administrators`
                : `${saved.length} blocked ${title.toLowerCase()}`}
          </summary>
          <p className="muted">
            {savedMatches.length} matching entries. Showing up to 20; use the search above to narrow
            the list.
          </p>
          <ul className="admin-rules">
            {savedMatches.slice(0, 20).map((item) => (
              <li key={item.target}>
                <div>
                  <strong>
                    {choices.find((c) => c.target === item.target)?.label || 'Saved identifier'}
                  </strong>
                  <code>{item.target}</code>
                  <p className="muted">{item.reason}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    choose(
                      choices.find((c) => c.target === item.target) || {
                        target: item.target,
                        label: 'Saved identifier',
                        search: '',
                      },
                    )
                  }
                >
                  Select{' '}
                  {entity === 'admin'
                    ? 'administrator'
                    : entity === 'backend'
                      ? 'creator'
                      : 'block'}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
function FeaturedOrder({
  state,
  busy,
  change,
}: {
  state: AdminState;
  busy: boolean;
  change: (input: Change) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState<{
    key: string;
    message: string;
    status: 'busy' | 'done' | 'error';
  } | null>(null);
  async function run(item: AdminState['featured'][number], action: Change['action']) {
    const key = `${item.type}:${item.target}:${action}`;
    setFeedback({ key, message: 'Saving…', status: 'busy' });
    try {
      await change({ type: item.type, target: item.target, action, reason });
      setFeedback({ key, message: outcomes[action], status: 'done' });
    } catch (error) {
      setFeedback({
        key,
        message: error instanceof Error ? error.message : 'Request failed.',
        status: 'error',
      });
    }
  }
  return (
    <section id="admin-featured" className="admin-form" aria-labelledby="admin-featured-title">
      <h2 id="admin-featured-title">Featured order</h2>
      <p className="muted">
        The first 12 available selections appear in this order. Blocks still apply. Add selections
        in Napplets or Revisions above.
      </p>
      {!state.featured.length ? (
        <p className="muted">The Featured collection is empty.</p>
      ) : (
        <>
          <label>
            Featured order change reason
            <input
              value={reason}
              maxLength={500}
              disabled={busy}
              onChange={(e) => {
                setReason(e.target.value);
                setFeedback(null);
              }}
              placeholder="Why change this selection or order?"
            />
          </label>
          <ul className="admin-rules">
            {state.featured.map((item, index) => (
              <li key={`${item.type}:${item.target}`}>
                <div>
                  <strong>
                    {index + 1}.{' '}
                    {state.catalog.entries.find((e) =>
                      item.type === 'address' ? e.address === item.target : e.id === item.target,
                    )?.title || 'Featured napplet'}
                  </strong>
                  <code>{item.target}</code>
                  <p className="muted">{item.reason}</p>
                </div>
                <div className="admin-actions">
                  {(['feature-up', 'feature-down', 'unfeature'] as const).map((action) => {
                    const key = `${item.type}:${item.target}:${action}`,
                      current = feedback?.key === key ? feedback : null;
                    const label =
                      action === 'unfeature'
                        ? 'Remove from Featured'
                        : `Move featured selection ${index + 1} ${action === 'feature-up' ? 'earlier' : 'later'}`;
                    return (
                      <Button
                        key={action}
                        size="sm"
                        variant="outline"
                        aria-label={label}
                        title={current?.message || label}
                        disabled={
                          busy ||
                          !reason.trim() ||
                          (action === 'feature-up' && index === 0) ||
                          (action === 'feature-down' && index === state.featured.length - 1)
                        }
                        onClick={() => void run(item, action)}
                      >
                        {current?.status === 'busy' ? (
                          <LoaderCircle size={15} className="animate-spin" />
                        ) : action === 'feature-up' ? (
                          <ArrowUp size={15} />
                        ) : action === 'feature-down' ? (
                          <ArrowDown size={15} />
                        ) : null}
                        {current?.status === 'error' ? (
                          <span role="alert">{current.message} Retry.</span>
                        ) : current?.status === 'done' ? (
                          <Check size={15} />
                        ) : action === 'unfeature' ? (
                          'Remove'
                        ) : null}
                      </Button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
