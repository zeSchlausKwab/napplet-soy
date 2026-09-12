import { useEffect, useRef, useState } from 'react';
import { Expand, LoaderCircle, Play, RotateCcw, Square } from 'lucide-react';
import { useNostr } from './nostr-provider';
import { Button } from './ui/button';
import { loadArtifact, PLAYER_SANDBOX } from '../../../../packages/runtime/src';
import { validateRelease } from '../../../../packages/protocol/src';
import { validateManifest } from '../../../../packages/protocol/src/manifest';
import type { Napplet } from '../../../../packages/backend/src/catalog';
import { publicPoster, type PublicNapplet } from '../../../../packages/backend/src/public-model';

export function Player({ napplet }: { napplet: Napplet | PublicNapplet }) {
  const external = 'provenance' in napplet;
  const releaseId = external ? napplet.revisionId : napplet.snapshot.id;
  const { ready } = useNostr();
  const [playing, setPlaying] = useState(false),
    [doc, setDoc] = useState(''),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!playing) {
      setDoc('');
      return;
    }
    const controller = new AbortController();
    setError('');
    setDoc('');
    const verify = external
      ? napplet.availability === 'ready' && napplet.artifactHash && !napplet.domains.length
        ? validateManifest(napplet.manifest)
        : Promise.reject(new Error('This napplet needs its original host.'))
      : validateRelease(napplet.current, napplet.snapshot);
    void verify
      .then(async (release) => {
        if (release.artifactHash !== napplet.artifactHash)
          throw new Error('Release metadata does not match its artifact.');
        return loadArtifact(release.artifactHash, controller.signal);
      })
      .then((html) => {
        if (!controller.signal.aborted) setDoc(html);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'Could not load this creation.');
      });
    return () => controller.abort();
  }, [playing, releaseId, revision]);
  return (
    <div className="player-wrap">
      <div ref={frame} className="player-stage">
        {!playing ? (
          <button
            disabled={!ready}
            className="player-cover"
            onClick={() => setPlaying(true)}
            aria-label={`Start ${napplet.title}`}
          >
            <img
              src={external ? publicPoster(napplet) : `/posters/${napplet.slug}.svg`}
              alt=""
              referrerPolicy="no-referrer"
            />
            <span>
              <Play size={22} fill="currentColor" /> Play napplet
            </span>
          </button>
        ) : error ? (
          <div className="player-message" role="alert">
            <p>{error}</p>
            <Button variant="outline" onClick={() => setRevision((r) => r + 1)}>
              Try again
            </Button>
          </div>
        ) : doc ? (
          <iframe
            key={revision}
            title={napplet.title}
            srcDoc={doc}
            sandbox={PLAYER_SANDBOX}
            allow="fullscreen"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="player-message" role="status">
            <LoaderCircle className="animate-spin" />
            Verifying creation…
          </div>
        )}
      </div>
      <div className="player-controls">
        <span>
          {playing && doc ? (
            <>
              <span className="status-dot" />
              Playing · verified artifact
            </>
          ) : (
            'A small world, ready when you are.'
          )}
        </span>
        <div>
          <Button
            variant="ghost"
            size="icon"
            disabled={!playing}
            aria-label="Restart napplet"
            onClick={() => setRevision((r) => r + 1)}
          >
            <RotateCcw size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={!playing}
            aria-label="Stop napplet"
            onClick={() => setPlaying(false)}
          >
            <Square size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Fullscreen"
            onClick={() => {
              void frame.current
                ?.requestFullscreen()
                .catch(() => setError('Fullscreen is unavailable in this browser.'));
            }}
          >
            <Expand size={17} />
          </Button>
        </div>
      </div>
    </div>
  );
}
