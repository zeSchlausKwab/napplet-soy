import { useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { Pencil, Save } from 'lucide-react';
import { browserIdentity } from '@/lib/browser-identity';
import { useProfiles } from '@/lib/profiles';
import { useNostr } from './nostr-provider';
import { Button } from './ui/button';
import { ActionButton } from './action-button';
import {
  editableProfile,
  mergeProfile,
  type ProfileFields,
  type ProfileView,
} from '../../../../packages/protocol/src/profile';
import type { SignedEvent } from '../../../../packages/protocol/src';
type Base = { event: SignedEvent | null; relays: string[] };
const fields: [keyof ProfileFields, string, string][] = [
  ['display_name', 'Display name', 'What people call you'],
  ['name', 'Nostr username', 'A short name'],
  ['about', 'About you', 'A little about what you make…'],
  ['website', 'Website', 'https://…'],
  ['picture', 'Avatar image', 'https://…'],
  ['banner', 'Banner image', 'https://…'],
  ['lud16', 'Lightning address', 'you@example.com'],
  ['nip05', 'Nostr address (NIP-05)', 'you@example.com'],
];
export function ProfileEditor({ pubkey, exists }: { pubkey: string; exists: boolean }) {
  const identity = useNostr(),
    cache = useProfiles(),
    router = useRouter();
  const [base, setBase] = useState<Base | null>(null),
    [values, setValues] = useState<ProfileFields | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [phase, setPhase] = useState(''),
    [error, setError] = useState('');
  const [pending, setPending] = useState<{ event: SignedEvent; base: string | null } | null>(null);
  const [conflict, setConflict] = useState(false);
  if (identity.pubkey !== pubkey) return null;
  async function open() {
    setBusy(true);
    setPhase('Loading profile…');
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/profile?pubkey=${pubkey}&edit=1`, {
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not load the profile.');
      if (browserIdentity().state.pubkey !== pubkey)
        throw new Error('The selected account changed.');
      setBase(result);
      setValues(editableProfile(result.event));
      setPending(null);
      setConflict(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your profile.');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!base || !values || busy) return;
    setBusy(true);
    setPhase(pending ? 'Publishing…' : 'Signing…');
    setError('');
    setMessage('');
    try {
      let update = pending;
      if (!update) {
        const content = JSON.stringify(mergeProfile(base.event, values));
        const created_at = Math.max(
          Math.floor(Date.now() / 1000),
          (base.event?.created_at ?? 0) + 1,
        );
        const event = await browserIdentity().sign(pubkey, {
          kind: 0,
          created_at,
          content,
          tags: base.event?.tags ?? [],
        });
        update = { event, base: base.event?.id ?? null };
        setPending(update);
      }
      if (browserIdentity().state.pubkey !== pubkey)
        throw new Error('The selected account changed. Reconnect the author to retry.');
      setPhase('Publishing…');
      const response = await fetch(`/api/profile?pubkey=${pubkey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) setConflict(true);
        throw new Error(result.error ?? 'No confirmation received. Retry sends the same event.');
      }
      cache.seed(result.profile as ProfileView);
      setMessage('Profile published');
      setPending(null);
      setBase(null);
      setValues(null);
      // Publication is acknowledged; a stale page must not turn this into a publish retry.
      await router.invalidate().catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not publish your profile.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="profile-edit-section" aria-label="Your profile">
      {!base ? (
        <ActionButton
          variant="outline"
          icon={<Pencil size={15} />}
          working={busy ? phase : undefined}
          error={error}
          retryLabel="Retry loading profile"
          success={message}
          onClick={() => void open()}
        >
          {exists ? 'Edit your profile' : 'Create your profile'}
        </ActionButton>
      ) : (
        <form
          noValidate
          className="profile-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div>
            <span className="eyebrow">YOUR NOSTR PROFILE</span>
            <h2>A face to your creations.</h2>
            <p>
              These details are public across Nostr. A profile is optional: you can create and
              publish napplets without one.
            </p>
          </div>
          <fieldset disabled={busy || !!pending} className="profile-field-grid">
            {fields.map(([key, label, placeholder]) => (
              <label
                key={key}
                className={`identity-field${key === 'about' ? ' profile-wide' : ''}`}
              >
                {label}
                {key === 'about' ? (
                  <textarea
                    aria-label={label}
                    rows={4}
                    maxLength={2000}
                    value={values?.[key] ?? ''}
                    placeholder={placeholder}
                    onChange={(e) => {
                      setValues({ ...values!, [key]: e.target.value });
                      setError('');
                    }}
                  />
                ) : (
                  <input
                    aria-label={label}
                    value={values?.[key] ?? ''}
                    placeholder={placeholder}
                    type={['website', 'picture', 'banner'].includes(key) ? 'url' : 'text'}
                    maxLength={
                      ['name', 'display_name'].includes(key)
                        ? 80
                        : ['nip05', 'lud16'].includes(key)
                          ? 254
                          : 2048
                    }
                    onChange={(e) => {
                      setValues({ ...values!, [key]: e.target.value });
                      setError('');
                    }}
                  />
                )}
              </label>
            ))}
          </fieldset>
          <p className="muted">
            Image links must be HTTPS. Your Lightning and Nostr addresses must already exist; this
            form does not create a wallet, verify an address, or claim a site handle.
          </p>
          <details>
            <summary>Publishing destinations</summary>
            <ul>
              {base.relays.map((relay) => (
                <li key={relay}>
                  <code>{relay}</code>
                </li>
              ))}
            </ul>
            <p>
              Other profile fields and tags are preserved. We check these relays for newer changes
              before publishing.
            </p>
          </details>
          <div className="identity-methods">
            <ActionButton
              disabled={conflict || identity.needsReconnect || !base.relays.length}
              working={busy ? phase : undefined}
              error={error}
              retryLabel={conflict ? 'Profile changed' : 'Retry signed update'}
              icon={<Save size={15} />}
            >
              Sign & publish profile
            </ActionButton>
            {identity.needsReconnect && (
              <Button type="button" variant="outline" onClick={() => void identity.connect()}>
                Reconnect signer
              </Button>
            )}
            {conflict && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => void open()}>
                Reload current profile
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setBase(null);
                setValues(null);
                setPending(null);
                setError('');
              }}
            >
              Close editor
            </Button>
          </div>
          {conflict && (
            <p className="muted">
              Your unsaved text is still visible above. Copy anything you want to keep before
              reloading.
            </p>
          )}
        </form>
      )}
    </section>
  );
}
