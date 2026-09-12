import { useCallback, useEffect, useRef, useState } from 'react';
import { Expand, LoaderCircle, Play, RotateCcw, Square } from 'lucide-react';
import { useNostr } from './nostr-provider';
import { Button } from './ui/button';
import { loadArtifact, PLAYER_SANDBOX } from '../../../../packages/runtime/src';
import { validateRelease } from '../../../../packages/protocol/src';
import { validateManifest } from '../../../../packages/protocol/src/manifest';
import type { Napplet } from '../../../../packages/backend/src/catalog';
import { publicPoster, type PublicNapplet } from '../../../../packages/backend/src/public-model';
import shim from '@napplet/shim/prelude.global?raw';
import { RUNTIME_DOMAINS, missingDomains } from '../../../../packages/runtime/src/capabilities';
import { SHELL_PRELUDE } from '../../../../packages/runtime/src/prelude';
import { attachNappletHost, type HostPrompt } from '../../../../packages/runtime/src/host';
import type { ExportFile } from '../../../../packages/runtime/src/filesystem';

const prelude = `${shim}\nglobalThis.NappletShimPrelude.install(${JSON.stringify({ domains: RUNTIME_DOMAINS.filter((d) => d !== 'shell') })});\n${SHELL_PRELUDE}`;

function FileExports({ files }: { files: ExportFile[] }) {
  const [downloads, setDownloads] = useState<{ name: string; url: string }[]>([]);
  useEffect(() => {
    const next = files.map((file) => ({ name: file.name, url: URL.createObjectURL(file.blob) }));
    setDownloads(next);
    return () => next.forEach((file) => URL.revokeObjectURL(file.url));
  }, [files]);
  if (!downloads.length) return null;
  return (
    <div className="host-files">
      <span>Session files · download before closing</span>
      {downloads.map((file) => (
        <a key={file.name} href={file.url} download={file.name.split('/').pop()}>
          {file.name} ↓
        </a>
      ))}
    </div>
  );
}

export function Player({ napplet }: { napplet: Napplet | PublicNapplet }) {
  const external = 'provenance' in napplet;
  const releaseId = external ? napplet.revisionId : napplet.snapshot.id;
  const { ready, pubkey } = useNostr();
  const [prompt, setPrompt] = useState<HostPrompt | null>(null);
  const [exports, setExports] = useState<ExportFile[]>([]);
  const cleanupHost = useRef<(() => void) | undefined>(undefined);
  const [playing, setPlaying] = useState(false),
    [doc, setDoc] = useState(''),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const frame = useRef<HTMLDivElement>(null);
  const bindFrame = useCallback(
    (node: HTMLIFrameElement | null) => {
      cleanupHost.current?.();
      cleanupHost.current = undefined;
      if (!node) return;
      const manifest = external ? napplet.manifest : napplet.current;
      cleanupHost.current = attachNappletHost({
        frame: node,
        identity: `${manifest.pubkey}:${manifest.kind}:${manifest.tags.find((t) => t[0] === 'd')?.[1] ?? ''}:${external ? napplet.aggregateHash : napplet.artifactHash}`,
        manifestId: releaseId,
        relays: external ? napplet.relays : [],
        pubkey,
        prompt: setPrompt,
        files: setExports,
      });
    },
    [napplet, pubkey, releaseId],
  );
  useEffect(() => {
    setExports([]);
    if (!playing) {
      setDoc('');
      return;
    }
    const controller = new AbortController();
    setError('');
    setDoc('');
    const verify = external
      ? napplet.availability === 'ready' &&
        napplet.artifactHash &&
        !missingDomains(napplet.domains).length
        ? validateManifest(napplet.manifest)
        : Promise.reject(
            new Error('This napplet requires capabilities this client does not yet support.'),
          )
      : validateRelease(napplet.current, napplet.snapshot);
    void verify
      .then(async (release) => {
        if (release.artifactHash !== napplet.artifactHash)
          throw new Error('Release metadata does not match its artifact.');
        return loadArtifact(release.artifactHash, controller.signal, prelude);
      })
      .then((html) => {
        if (!controller.signal.aborted) setDoc(html);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'Could not load this creation.');
      });
    return () => controller.abort();
  }, [playing, releaseId, revision, pubkey]);
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
            key={`${revision}:${pubkey}`}
            ref={bindFrame}
            title={napplet.title}
            srcDoc={doc}
            sandbox={PLAYER_SANDBOX}
            inert={prompt !== null}
            allow="fullscreen"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="player-message" role="status">
            <LoaderCircle className="animate-spin" />
            Verifying creation…
          </div>
        )}
        {prompt && (
          <div
            className="host-prompt"
            role="dialog"
            aria-modal="true"
            aria-label={prompt.kind === 'save' ? 'Save napplet file' : 'Open external link'}
            ref={(node) => {
              node?.querySelector<HTMLButtonElement>('button')?.focus();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                prompt.answer(false);
              }
              if (event.key === 'Tab') {
                const controls = [
                  ...event.currentTarget.querySelectorAll<HTMLElement>('button, a[href]'),
                ];
                const index = controls.indexOf(document.activeElement as HTMLElement);
                event.preventDefault();
                controls[
                  (index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length
                ]?.focus();
              }
            }}
          >
            <strong>
              {prompt.kind === 'save' ? 'Save a file from this napplet?' : 'Open this link?'}
            </strong>
            <p>{prompt.value}</p>
            {prompt.kind === 'save' && (
              <p>The file will appear below the player for you to download.</p>
            )}
            <div>
              <Button variant="outline" onClick={() => prompt.answer(false)}>
                Cancel
              </Button>
              {prompt.kind === 'save' ? (
                <Button onClick={() => prompt.answer(true)}>Save file</Button>
              ) : (
                <Button asChild>
                  <a
                    href={prompt.value}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => prompt.answer(true)}
                  >
                    Open link
                  </a>
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
      <FileExports files={exports} />
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
