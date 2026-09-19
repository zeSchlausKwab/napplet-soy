import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Check, CircleAlert, CircleHelp, Plus, Radio } from 'lucide-react';
import { type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useNostr } from './nostr-provider';
import { PopoverTrigger } from './ui/popover';

export function Shell({ children }: { children: ReactNode }) {
  const { pubkey, ready, relayConfigured, needsReconnect } = useNostr();
  return (
    <div className="site-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <Link to="/" className="brand" aria-label="napplet.soy home">
          <img
            className="brand-mark"
            src="/brand/soy-mascot.png"
            width={1254}
            height={1254}
            alt=""
          />
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
          <Link to="/docs" activeProps={{ className: 'nav-active' }}>
            Docs
          </Link>
        </nav>
        <div className="header-actions">
          <Button asChild variant="ghost" size="icon" className="about-link">
            <Link to="/about" aria-label="About napplet.soy" title="About napplet.soy">
              <CircleHelp size={19} />
            </Link>
          </Button>
          <Link to="/create" className="make-link">
            <Plus size={16} /> Create a napplet
          </Link>
          <PopoverTrigger asChild>
            <Button
              id="identity-button"
              variant="outline"
              className="connect-button"
              disabled={!ready}
              title={
                pubkey && needsReconnect
                  ? 'Account selected — unlock or reconnect your signer'
                  : 'Nostr account'
              }
            >
              {pubkey ? (
                <>
                  {needsReconnect ? <CircleAlert size={14} /> : <Check size={14} />}
                  {pubkey.slice(0, 6)}…
                </>
              ) : (
                'Connect'
              )}
            </Button>
          </PopoverTrigger>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <span>
          <img
            className="footer-brand-mark"
            src="/brand/soy-mascot.png"
            width={1254}
            height={1254}
            alt=""
          />{' '}
          Small creations. Wide-open possibilities.
        </span>
        <div>
          <Link to="/network" className="network-label">
            <Radio size={12} />
            Network settings
          </Link>
          <Link to="/admin">Administration</Link>
          <Link to="/docs">soyLI docs</Link>
          <Link to="/about">About</Link>
          <a href="https://github.com/napplet/naps" target="_blank" rel="noreferrer">
            The protocol <ArrowUpRight size={13} />
          </a>
        </div>
      </footer>
    </div>
  );
}
