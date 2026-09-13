import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Asterisk, Check, LoaderCircle, Plus, Radio, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useNostr } from './nostr-provider';

export function Shell({ children }: { children: ReactNode }) {
  const { pubkey, ready, connect, disconnect, relayConfigured } = useNostr();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="site-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <Link to="/" className="brand" aria-label="napplet.soy home">
          <span className="brand-mark">
            <Asterisk size={26} strokeWidth={3} />
          </span>
          napplet<span className="brand-dot">.soy</span>
        </Link>
        <nav aria-label="Main navigation">
          <Link
            to="/"
            search={{ tag: '', sort: 'curated', q: '' }}
            activeProps={{ className: 'nav-active' }}
          >
            Explore
          </Link>
          <Link to="/create">
            Make something <ArrowUpRight size={13} />
          </Link>
        </nav>
        <div className="header-actions">
          <Link to="/create" className="make-link">
            <Plus size={16} /> Create a napplet
          </Link>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" className="connect-button" disabled={!ready}>
                {pubkey ? (
                  <>
                    <Check size={14} />
                    {pubkey.slice(0, 6)}…
                  </>
                ) : (
                  'Connect'
                )}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {pubkey ? 'Your Nostr identity' : 'Bring your Nostr identity'}
                </DialogTitle>
                <DialogDescription>
                  Connect a Nostr browser extension. Your private key stays with your signer.
                </DialogDescription>
              </DialogHeader>
              {pubkey ? (
                <>
                  <code className="public-key">{pubkey}</code>
                  <Button variant="outline" onClick={disconnect}>
                    <X size={14} />
                    Disconnect from this app
                  </Button>
                </>
              ) : (
                <>
                  <p className="muted">
                    Use a NIP-07 extension to connect an existing account. Remote signer pairing is
                    coming in a later slice.
                  </p>
                  <Button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        await connect();
                      } catch {
                        setError(
                          'Could not connect. Install or unlock a Nostr extension, then approve access and try again.',
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy && <LoaderCircle className="animate-spin" size={16} />}Connect browser
                    extension
                  </Button>
                  {error && (
                    <p role="alert" className="error-message">
                      {error}
                    </p>
                  )}
                </>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <span>
          <Asterisk size={16} /> Small creations. Wide-open possibilities.
        </span>
        <div>
          <span className="network-label">
            <Radio size={12} />
            {relayConfigured ? 'Relay configured' : 'Built on Nostr'}
          </span>
          <Link to="/admin">Administration</Link>
          <a href="https://github.com/napplet/naps" target="_blank" rel="noreferrer">
            The protocol <ArrowUpRight size={13} />
          </a>
        </div>
      </footer>
    </div>
  );
}
