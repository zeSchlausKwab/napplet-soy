import { Link } from '@tanstack/react-router';
import { ArrowUpRight, CircleAlert, CircleHelp, Plus, Radio } from 'lucide-react';
import { type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useNostr } from './nostr-provider';
import { PopoverTrigger } from './ui/popover';
import { ProfileAvatar } from './creator-link';
import { useProfile } from '@/lib/profiles';
import { shortPubkey } from '../../../../packages/protocol/src/profile';

function ConnectedIdentity({
  pubkey,
  needsReconnect,
}: {
  pubkey: string;
  needsReconnect: boolean;
}) {
  const profile = useProfile(pubkey);
  const name =
    profile?.name && profile.name !== shortPubkey(pubkey) ? profile.name : `${pubkey.slice(0, 6)}…`;
  return (
    <span className="identity-button-account" title={`${name} · ${pubkey}`}>
      <ProfileAvatar key={pubkey} profile={profile} name={name} />
      <span className="identity-button-name">{name}</span>
      {needsReconnect && <CircleAlert size={14} aria-label="Unlock or reconnect your signer" />}
    </span>
  );
}

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
          <span className="brand-wordmark">napplet.soy</span>
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
                <ConnectedIdentity pubkey={pubkey} needsReconnect={needsReconnect} />
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
