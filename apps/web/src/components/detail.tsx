import { SourceSection } from './source-section';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useEventStore } from 'applesauce-react/hooks';
import { Button } from './ui/button';
import { Player } from './player';
import { TopicTags } from './topic-tags';
import type { Napplet } from '../../../../packages/backend/src/catalog';
import { NameButton } from './name-button';
import { SocialPanel } from './social-panel';
import { RemixButton } from './remix-button';
import { usePlayRoute } from '@/lib/use-play-route';

export function Detail({ napplet, pinned = false }: { napplet: Napplet; pinned?: boolean }) {
  const play = usePlayRoute();
  const store = useEventStore();
  const [copied, setCopied] = useState('');
  useEffect(() => {
    store.add(napplet.current);
    store.add(napplet.snapshot);
  }, [store, napplet.snapshot.id]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/n/${napplet.naddr}`);
      setCopied('Portable link copied');
    } catch {
      setCopied('Copy the address from your browser to share this page.');
    }
  };
  return (
    <section className="detail-page">
      <Link to="/" className="back-link">
        <ArrowLeft size={14} />
        Back to the playground
      </Link>
      <div className="detail-heading">
        <div>
          <span className="eyebrow">NAPPLET{pinned ? ' / PINNED RELEASE' : ''}</span>
          <h1>
            {napplet.title}
            <span className="coral">.</span>
          </h1>
          <Link to="/$creator" params={{ creator: `@${napplet.handle}` }} className="creator-link">
            <span className="mini-avatar">s</span>
            {napplet.creator} <span>@{napplet.handle}</span>
          </Link>
        </div>
        <div className="detail-actions">
          <Button variant="outline" asChild>
            <Link to={play.playPath} resetScroll={false}>
              Open player
            </Link>
          </Button>
          {napplet.naddr && <NameButton naddr={napplet.naddr} author={napplet.pubkey} />}
          <Button variant="outline" onClick={copy}>
            {copied ? <Check size={16} /> : <Copy size={16} />}Share
          </Button>
          <RemixButton revision={napplet.snapshot.id} title={napplet.title} />
        </div>
      </div>
      {copied && (
        <p role="status" className="copy-status">
          {copied}
        </p>
      )}
      <Player
        key={napplet.snapshot.id}
        napplet={napplet}
        pinned={pinned}
        immersive={play.immersive}
        detailPath={play.detailPath}
        onEnter={play.enter}
        onExit={play.exit}
      />
      <div className="detail-info">
        <div>
          <h2>A little about this one</h2>
          <p>{napplet.description}</p>
          <TopicTags topics={napplet.topics} />
          <div className="instructions">↳ {napplet.instructions}</div>
        </div>
        <aside>
          <div>
            <span>License</span>
            <strong>{napplet.license}</strong>
          </div>
          <div>
            <span>Package</span>
            <strong>{(napplet.bytes / 1024).toFixed(1)} KB · single HTML</strong>
          </div>
          <div>
            <span>Release</span>
            <Link to="/r/$snapshot" params={{ snapshot: napplet.snapshot.id }}>
              {napplet.snapshot.id.slice(0, 12)}…
            </Link>
          </div>
        </aside>
      </div>
      <SourceSection revision={napplet.snapshot.id} />
      <SocialPanel key={napplet.naddr} reference={napplet.naddr} />
      <div className="collection-note">
        This example is bundled for local development and hasn’t been published to Nostr.
      </div>
    </section>
  );
}
