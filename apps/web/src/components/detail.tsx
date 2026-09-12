import { Link } from '@tanstack/react-router';
import { ArrowLeft, Check, Code2, Copy, GitFork } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useEventStore } from 'applesauce-react/hooks';
import { Button } from './ui/button';
import { Player } from './player';
import type { Napplet } from '../../../../packages/backend/src/catalog';

export function Detail({ napplet, pinned = false }: { napplet: Napplet; pinned?: boolean }) {
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
          <span className="eyebrow">
            {napplet.category.toUpperCase()} / {pinned ? 'PINNED RELEASE' : 'STARTER COLLECTION'}
          </span>
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
          <Button variant="outline" onClick={copy}>
            {copied ? <Check size={16} /> : <Copy size={16} />}Share
          </Button>
          <Link className="primary-link" to="/create" search={{ template: napplet.slug }}>
            <GitFork size={16} />
            Make it yours
          </Link>
        </div>
      </div>
      {copied && (
        <p role="status" className="copy-status">
          {copied}
        </p>
      )}
      <Player key={napplet.snapshot.id} napplet={napplet} pinned={pinned} />
      <div className="detail-info">
        <div>
          <h2>A little about this one</h2>
          <p>{napplet.description}</p>
          <div className="instructions">↳ {napplet.instructions}</div>
        </div>
        <aside>
          <Link to="/r/$snapshot/source" params={{ snapshot: napplet.snapshot.id }}>
            <Code2 size={17} />
            Peek at the source <span>↗</span>
          </Link>
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
      <div className="collection-note">
        This example is bundled for local development and hasn’t been published to Nostr.
        Publishing, comments, likes, and zaps are coming next.
      </div>
    </section>
  );
}
