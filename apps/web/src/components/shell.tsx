import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Asterisk, Check, CircleHelp, Plus, Radio } from 'lucide-react';
import { type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useNostr } from './nostr-provider';

export function Shell({ children }: { children: ReactNode }) {
  const { pubkey, ready, connect, relayConfigured } = useNostr();
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
          <Button asChild variant="ghost" size="icon" className="about-link">
            <Link to="/about" aria-label="About napplet.soy" title="About napplet.soy">
              <CircleHelp size={19} />
            </Link>
          </Button>
          <Link to="/create" className="make-link">
            <Plus size={16} /> Create a napplet
          </Link>
          <Button variant="outline" className="connect-button" disabled={!ready} onClick={connect}>
            {pubkey ? (
              <>
                <Check size={14} />
                {pubkey.slice(0, 6)}…
              </>
            ) : (
              'Connect'
            )}
          </Button>
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
          <Link to="/about">About</Link>
          <a href="https://github.com/napplet/naps" target="_blank" rel="noreferrer">
            The protocol <ArrowUpRight size={13} />
          </a>
        </div>
      </footer>
    </div>
  );
}
