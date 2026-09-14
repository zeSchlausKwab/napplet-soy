import { useRef, useState } from 'react';
import { Copy, ExternalLink, KeyRound, LoaderCircle, ShieldCheck, Smartphone } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { LightningCode } from './lightning-code';
import { browserIdentity, type IdentityState } from '../lib/browser-identity';
import { defaultSignerRelays } from '../../../../packages/identity/src/signer';

export function IdentityDialog({
  open,
  setOpen,
  identity,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  identity: IdentityState;
}) {
  const [method, setMethod] = useState<'extension' | 'remote' | 'key'>('extension');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uri, setUri] = useState('');
  const [auth, setAuth] = useState('');
  const [secret, setSecret] = useState('');
  const [relay, setRelay] = useState(defaultSignerRelays[0]);
  const [accepted, setAccepted] = useState(false);
  const attempt = useRef(0);
  function cancel() {
    attempt.current++;
    browserIdentity().cancel();
    setBusy(false);
    setUri('');
    setAuth('');
    setSecret('');
    setAccepted(false);
    setError('');
  }
  function changeOpen(value: boolean) {
    if (!value) cancel();
    setOpen(value);
  }
  async function run(
    operation: (
      onAuth: (url: string) => Promise<void>,
      onPairing: (uri: string) => void,
    ) => Promise<void>,
  ) {
    const current = ++attempt.current;
    setBusy(true);
    setError('');
    setUri('');
    setAuth('');
    try {
      await operation(
        async (url) => {
          if (current === attempt.current) setAuth(url);
        },
        (link) => {
          if (current === attempt.current) setUri(link);
        },
      );
      if (current === attempt.current) changeOpen(false);
    } catch (error) {
      if (current === attempt.current)
        setError(error instanceof Error ? error.message : 'Could not connect. Please retry.');
    } finally {
      if (current === attempt.current) {
        setBusy(false);
        setUri('');
        setAuth('');
      }
    }
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="identity-dialog">
        <DialogHeader>
          <DialogTitle>
            {identity.pubkey ? 'Your Nostr identity' : 'Bring your Nostr identity'}
          </DialogTitle>
          <DialogDescription>
            One identity for comments, likes, zaps and your creations. Connections last until you
            disconnect or refresh this page.
          </DialogDescription>
        </DialogHeader>
        {identity.pubkey && (
          <div className="identity-current">
            <span className="muted">
              Connected through{' '}
              {identity.method === 'key'
                ? 'a key in browser memory'
                : identity.method === 'remote'
                  ? 'a remote signer'
                  : 'your extension'}
            </span>
            <code className="public-key">{identity.pubkey}</code>
            <Button
              variant="outline"
              onClick={() => {
                cancel();
                browserIdentity().disconnect();
              }}
            >
              Disconnect from this app
            </Button>
            <p className="muted">Or connect another account below.</p>
          </div>
        )}
        {identity.reconnect && (
          <Button
            onClick={() => run((onAuth) => browserIdentity().reconnect({ onAuth }))}
            disabled={busy}
          >
            Reconnect remote signer
          </Button>
        )}
        <div className="identity-methods" aria-label="Sign-in method">
          {(
            [
              ['extension', ShieldCheck, 'Extension'],
              ['remote', Smartphone, 'Remote signer'],
              ['key', KeyRound, 'Private key'],
            ] as const
          ).map(([value, Icon, label]) => (
            <Button
              key={value}
              variant={method === value ? 'default' : 'outline'}
              aria-pressed={method === value}
              onClick={() => {
                cancel();
                setMethod(value);
              }}
            >
              <Icon size={15} />
              {label}
            </Button>
          ))}
        </div>
        {method === 'extension' && (
          <>
            <p className="muted">
              Use your NIP-07 browser extension. Your private key stays with your signer.
            </p>
            <Button disabled={busy} onClick={() => run(() => browserIdentity().extension())}>
              Connect browser extension
            </Button>
          </>
        )}
        {method === 'remote' && (
          <>
            <p className="muted">
              Scan a connection code in your NIP-46 signer, or paste a bunker link it provides. Your
              private key stays on that device.
            </p>
            <label className="identity-field">
              Signer relay
              <input
                type="url"
                value={relay}
                disabled={busy}
                onChange={(e) => setRelay(e.target.value)}
                spellCheck={false}
              />
            </label>
            <p className="muted">
              This relay carries encrypted signing requests. Publishing destinations stay unchanged.
            </p>
            <Button
              disabled={busy}
              onClick={() =>
                run((onAuth, onPairing) =>
                  browserIdentity().pair([relay.trim()], onPairing, { onAuth }),
                )
              }
            >
              Create connection code
            </Button>
            {uri && (
              <div className="identity-pairing">
                <LightningCode
                  value={uri}
                  label="Scan this Nostr Connect pairing code in your signer"
                  preserveCase
                />
                <p>Waiting for approval · up to 2 minutes</p>
                <p className="muted">Keep this one-time connection link private.</p>
                <div className="identity-methods">
                  <Button
                    variant="outline"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(uri)
                        .catch(() => setError('Copy unavailable. Select and copy the link below.'))
                    }
                  >
                    <Copy size={14} />
                    Copy connection link
                  </Button>
                  <Button asChild>
                    <a href={uri} rel="noreferrer">
                      Open signer <ExternalLink size={14} />
                    </a>
                  </Button>
                </div>
                <textarea aria-label="Connection link" readOnly value={uri} rows={3} />
              </div>
            )}
            {!uri && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const link = secret;
                  setSecret('');
                  void run((onAuth) => browserIdentity().bunker(link, { onAuth }));
                }}
                className="identity-form"
              >
                <label className="identity-field">
                  Bunker link
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="bunker://…"
                    disabled={busy}
                  />
                </label>
                <Button variant="outline" disabled={busy || !secret.trim()}>
                  Connect bunker
                </Button>
              </form>
            )}
          </>
        )}
        {method === 'key' && (
          <form
            className="identity-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!accepted) return;
              const key = secret;
              setSecret('');
              void run(() => browserIdentity().importKey(key));
            }}
          >
            <div className="identity-warning" role="note">
              <strong>Only paste a key you trust this website with.</strong>
              <p>
                A private key grants control of your Nostr identity. Extensions and remote signers
                keep it outside the website. Imported keys stay in this page’s memory and are
                cleared on disconnect or refresh.
              </p>
            </div>
            <label className="identity-consent">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                disabled={busy}
              />
              I understand the risk of importing my private key.
            </label>
            <label className="identity-field">
              Private key
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="nsec1… or hexadecimal key"
                disabled={busy}
              />
            </label>
            <Button disabled={busy || !accepted || !secret.trim()}>Use key for this session</Button>
          </form>
        )}
        {(identity.authorization || auth) && (
          <p role="status">
            <a href={identity.authorization || auth} target="_blank" rel="noopener noreferrer">
              Approve this request in your signer <ExternalLink size={14} />
            </a>
          </p>
        )}
        {busy && (
          <div className="identity-methods" role="status">
            <LoaderCircle className="animate-spin" size={16} />
            Waiting for your signer…
            <Button variant="outline" onClick={cancel}>
              Cancel connection
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
