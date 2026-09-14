import { Link } from '@tanstack/react-router';
import { ArrowLeft, Code2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useEventStore } from 'applesauce-react/hooks';
import { Player } from './player';
import { TopicTags } from './topic-tags';
import { Button } from './ui/button';
import { publicPoster, type PublicNapplet } from '../../../../packages/backend/src/public-model';
import { missingDomains } from '../../../../packages/runtime/src/capabilities';
import { NameButton } from './name-button';
import { RemixButton } from './remix-button';

export function PublicDetail({ napplet }: { napplet: PublicNapplet }) {
  const store = useEventStore();
  const [copied, setCopied] = useState('');
  useEffect(() => {
    store.add(napplet.manifest);
  }, [store, napplet.revisionId]);
  return (
    <section className="detail-page">
      <Link to="/" className="back-link">
        <ArrowLeft size={14} />
        Back to the playground
      </Link>
      <div className="detail-heading">
        <div>
          <span className="eyebrow">
            NAPPLET{napplet.manifest.kind === 5129 ? ' / PINNED RELEASE' : ''}
          </span>
          <h1>
            {napplet.title}
            <span className="coral">.</span>
          </h1>
          <p>{napplet.creator}</p>
        </div>
        <div className="detail-actions">
          {napplet.naddr && <NameButton naddr={napplet.naddr} author={napplet.pubkey} />}
          <RemixButton revision={napplet.revisionId} title={napplet.title} />
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `${location.origin}${napplet.naddr ? `/n/${napplet.naddr}` : `/r/${napplet.revisionId}`}`,
                );
                setCopied('Link copied');
              } catch {
                setCopied('Copy the address from your browser to share.');
              }
            }}
          >
            Share
          </Button>
        </div>
      </div>
      {copied && <p role="status">{copied}</p>}
      {napplet.availability === 'ready' ? (
        <Player key={napplet.revisionId} napplet={napplet} />
      ) : (
        <div className="public-preview">
          <img src={publicPoster(napplet)} alt="" />
          <div>
            <h2>
              {napplet.availability === 'host-required'
                ? 'This one needs more capabilities.'
                : 'The creation is currently unavailable.'}
            </h2>
            <p>
              {napplet.availability === 'host-required'
                ? `Not supported here yet: ${missingDomains(napplet.domains).join(', ')}.`
                : 'Its download could not be verified from the listed servers. Please try again after the catalog refreshes.'}
            </p>
          </div>
        </div>
      )}
      <div className="detail-info">
        <div>
          <h2>A little about this one</h2>
          <p>{napplet.description || 'The author has not added a description.'}</p>
          <TopicTags topics={napplet.topics} />
        </div>
        <aside>
          {napplet.sourceUrl && (
            <a href={napplet.sourceUrl} target="_blank" rel="noopener noreferrer">
              <Code2 size={17} />
              Original source <span>↗</span>
            </a>
          )}
          {napplet.availability === 'ready' && (
            <a href={`/api/artifacts/${napplet.artifactHash}`} download="index.html">
              Download verified HTML <span>↓</span>
            </a>
          )}
          <div>
            <span>Manifest</span>
            <strong>Kind {napplet.manifest.kind} · signed</strong>
          </div>
          <div>
            <span>License</span>
            <strong>See original source</strong>
          </div>
          <div>
            <span>Package</span>
            <strong>
              {napplet.bytes === null
                ? 'Not cached'
                : `${(napplet.bytes / 1024).toFixed(1)} KB · single HTML`}
            </strong>
          </div>
        </aside>
      </div>
      <div className="collection-note">
        {napplet.availability === 'ready' &&
          'Playback supports local saves, resource loading, and Nostr reads. Publishing and account changes are disabled. '}
        Discovered on Nostr. The author’s signature and artifact hashes are checked independently of
        the relay and Blossom server.
      </div>
    </section>
  );
}
