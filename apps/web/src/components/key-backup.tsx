import { useEffect, useRef, useState } from 'react';
import { Download, KeyRound, LoaderCircle } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { Button } from './ui/button';
import { browserIdentity } from '../lib/browser-identity';
import { createKeyDraft } from '../lib/key-recovery';

type ExportBackup = (password: string, signal: AbortSignal) => Promise<string>;
export function KeyBackup({
  pubkey,
  exportBackup,
  onReady,
}: {
  pubkey: string;
  exportBackup: ExportBackup;
  onReady?: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [backup, setBackup] = useState<{ value: string; url: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | undefined>(undefined);
  const objectUrl = useRef('');
  useEffect(
    () => () => {
      pending.current?.abort();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );
  return (
    <div className="identity-form key-backup">
      <h3>Save your recovery file</h3>
      <p className="muted">
        Choose a passphrase for an encrypted NIP-49 backup. Keep the file and passphrase somewhere
        private. We cannot reset or recover them for you.
      </p>
      {!backup ? (
        <form
          className="identity-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (password.length < 12 || password.length > 1024 || password !== confirm || busy)
              return;
            pending.current?.abort();
            const controller = new AbortController();
            pending.current = controller;
            const phrase = password;
            setPassword('');
            setConfirm('');
            setError('');
            setBusy(true);
            try {
              const value = await exportBackup(phrase, controller.signal);
              if (controller.signal.aborted || pending.current !== controller) return;
              const url = URL.createObjectURL(
                new Blob([value + '\n'], { type: 'text/plain;charset=utf-8' }),
              );
              objectUrl.current = url;
              setBackup({ value, url });
            } catch (error) {
              if (!controller.signal.aborted)
                setError(error instanceof Error ? error.message : 'Could not prepare the backup.');
            } finally {
              if (!controller.signal.aborted) setBusy(false);
            }
          }}
        >
          <label className="identity-field">
            Recovery passphrase
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={1024}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="identity-field">
            Confirm recovery passphrase
            <input
              type="password"
              autoComplete="new-password"
              maxLength={1024}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
            />
          </label>
          {confirm && confirm !== password && (
            <p role="status" className="muted">
              The passphrases do not match.
            </p>
          )}
          <Button disabled={busy || password.length < 12 || password !== confirm}>
            {busy ? (
              <>
                <LoaderCircle size={15} className="animate-spin" /> Encrypting backup…
              </>
            ) : (
              'Prepare encrypted backup'
            )}
          </Button>
        </form>
      ) : (
        <>
          <Button asChild>
            <a
              href={backup.url}
              download={`napplet-${pubkey.slice(0, 12)}.ncryptsec`}
              onClick={onReady}
            >
              <Download size={16} /> Download recovery file
            </a>
          </Button>
          <p className="muted">
            Restore it with Private key → Recovery file in this login, or import it into a signer
            that supports NIP-49.
          </p>
          <details>
            <summary>Copy encrypted recovery text instead</summary>
            <textarea
              aria-label="Encrypted recovery key"
              readOnly
              value={backup.value}
              rows={4}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button variant="outline" onClick={onReady}>
              I saved the encrypted recovery text
            </Button>
          </details>
        </>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </div>
  );
}

export function CreateKeyPanel({
  onConnected,
  remember = false,
}: {
  onConnected: () => void;
  remember?: boolean;
}) {
  const draft = useRef<ReturnType<typeof createKeyDraft> | undefined>(undefined);
  const [pubkey, setPubkey] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      draft.current?.dispose();
    };
  }, []);
  return (
    <div className="identity-form">
      <div className="identity-warning" role="note">
        <strong>A new key is a new Nostr identity.</strong>
        <p>
          This website will hold the key. Save a backup before continuing: browser storage can be
          cleared or lost, and Remember is not a backup. An extension or remote signer keeps keys
          outside the website.
        </p>
      </div>
      {!pubkey ? (
        <>
          <label className="identity-consent">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            I understand that I must preserve my private key.
          </label>
          <Button
            disabled={!accepted}
            onClick={() => {
              try {
                draft.current?.dispose();
                draft.current = createKeyDraft();
                setPubkey(draft.current.pubkey);
                setError('');
              } catch {
                setError(
                  'Could not generate a key. Use a secure browser connection and try again.',
                );
              }
            }}
          >
            <KeyRound size={16} /> Generate new identity
          </Button>
        </>
      ) : (
        <>
          <label className="identity-field">
            Your public identity<code className="public-key">{nip19.npubEncode(pubkey)}</code>
          </label>
          <KeyBackup
            pubkey={pubkey}
            exportBackup={(phrase, signal) => draft.current!.backup(phrase, signal)}
            onReady={() => setSaved(true)}
          />
          {saved && (
            <label className="identity-consent">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I saved my recovery file or text and its passphrase.
            </label>
          )}
          <Button
            disabled={!saved || !confirmed || busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await draft.current!.connect((input) =>
                  browserIdentity().importKey(input, '', remember),
                );
                if (mounted.current) onConnected();
              } catch {
                if (mounted.current)
                  setError(
                    'Could not connect this identity. Your backup still belongs to the same key; try again.',
                  );
              } finally {
                if (mounted.current) setBusy(false);
              }
            }}
          >
            Continue with this identity
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </div>
  );
}
