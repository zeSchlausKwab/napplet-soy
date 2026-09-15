import { SourceSection } from './source-section';
import { CreatorLink } from './creator-link';
import { Genealogy } from './genealogy';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Code2 } from 'lucide-react';
import { useEffect } from 'react';
import { useEventStore } from 'applesauce-react/hooks';
import { Player } from './player';
import { TopicTags } from './topic-tags';
import { Button } from './ui/button';
import { publicPoster, type PublicNapplet } from '../../../../packages/backend/src/public-model';
import { missingDomains } from '../../../../packages/runtime/src/capabilities';
import { NameButton } from './name-button';
import { NappletSocial } from './social-panel';
import { RemixButton } from './remix-button';
import { usePlayRoute } from '@/lib/use-play-route';

export function PublicDetail({ napplet }: { napplet: PublicNapplet }) {
  const play = usePlayRoute();
  const store = useEventStore();
  useEffect(() => {
    store.add(napplet.manifest);
  }, [store, napplet.revisionId]);
  return (
    <NappletSocial
      key={napplet.naddr ?? napplet.revisionId}
      reference={napplet.naddr ?? napplet.revisionId}
      manifest={napplet.manifest}
      title={napplet.title}
      relays={napplet.relays ?? []}
    >
      {({ actions, feedback, discussion }) => (
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
              <CreatorLink pubkey={napplet.pubkey} />
              {actions}
            </div>
            <div className="detail-actions">
              <Button variant="outline" asChild>
                <Link
                  to={
                    play.immersive && napplet.availability !== 'ready'
                      ? play.detailPath
                      : play.playPath
                  }
                  resetScroll={false}
                >
                  {play.immersive && napplet.availability !== 'ready'
                    ? 'Back to details'
                    : 'Open player'}
                </Link>
              </Button>
              {napplet.naddr && <NameButton naddr={napplet.naddr} author={napplet.pubkey} />}
              <RemixButton revision={napplet.revisionId} title={napplet.title} />
            </div>
          </div>
          {feedback}
          {napplet.availability === 'ready' ? (
            <Player
              key={napplet.revisionId}
              napplet={napplet}
              immersive={play.immersive}
              detailPath={play.detailPath}
              onEnter={play.enter}
              onExit={play.exit}
            />
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
          <Genealogy manifest={napplet.manifest} />
          <SourceSection revision={napplet.revisionId} />
          {discussion}
          <div className="collection-note">
            {napplet.availability === 'ready' &&
              'Playback supports local saves, resource loading, and Nostr reads. Publishing and account changes are disabled. '}
            Discovered on Nostr. The author’s signature and artifact hashes are checked
            independently of the relay and Blossom server.
          </div>
        </section>
      )}
    </NappletSocial>
  );
}
