import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Expand,
  Minimize,
  LoaderCircle,
  Play,
  RotateCcw,
  Square,
} from 'lucide-react';
import { playback } from '@/lib/playback-coordinator';
import { usePlayerPresentation } from '@/lib/use-player-presentation';
import { useNostr } from './nostr-provider';
import { Button } from './ui/button';
import { loadArtifact, PLAYER_SANDBOX } from '../../../../packages/runtime/src';
import { preparePlayback } from '../../../../packages/runtime/src/playback';
import type { Napplet } from '../../../../packages/backend/src/catalog';
import { publicPoster, type PublicNapplet } from '../../../../packages/backend/src/public-model';
import shim from '@napplet/shim/prelude.global?raw';
import { nappletPrelude } from '../../../../packages/runtime/src/prelude';
import { attachNappletHost, type HostPrompt } from '../../../../packages/runtime/src/host';
import type { ExportFile } from '../../../../packages/runtime/src/filesystem';
import { declaredConfig } from '../../../../packages/runtime/src/config-schema';
import type { NappletConfig } from '../../../../packages/runtime/src/config-session';
import { SettingsControl } from '../../../../packages/runtime/src/settings-panel';

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

export function Player({
  napplet,
  pinned = false,
  autoPlay = false,
  compact = false,
  onStop,
  immersive = false,
  onEnter,
  onExit,
  detailPath,
  returnLabel = 'Back to gallery',
}: {
  napplet: Napplet | PublicNapplet;
  pinned?: boolean;
  autoPlay?: boolean;
  compact?: boolean;
  onStop?: () => void;
  immersive?: boolean;
  onEnter?: () => void;
  onExit?: () => void;
  detailPath?: string;
  returnLabel?: string;
}) {
  const external = 'provenance' in napplet;
  const manifest = external ? napplet.manifest : pinned ? napplet.snapshot : napplet.current;
  const releaseId = manifest.id;
  const { ready, pubkey } = useNostr();
  const [prompt, setPrompt] = useState<HostPrompt | null>(null);
  const [exports, setExports] = useState<ExportFile[]>([]);
  const [configuration, setConfiguration] = useState<NappletConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const declaration = useRef<ReturnType<typeof declaredConfig>>({});
  const host = useRef<ReturnType<typeof attachNappletHost> | undefined>(undefined);
  const currentPubkey = useRef(pubkey);
  useLayoutEffect(() => {
    currentPubkey.current = pubkey;
    host.current?.updateIdentity(pubkey);
  }, [pubkey]);
  const [playing, setPlaying] = useState(autoPlay),
    [doc, setDoc] = useState(''),
    [release, setRelease] = useState<
      (Awaited<ReturnType<typeof preparePlayback>> & { relays: string[] }) | null
    >(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const [restingHeight, setRestingHeight] = useState<number>();
  useLayoutEffect(() => {
    const node = wrapper.current!;
    const measure = () => {
      if (!node.matches(':fullscreen, .player-expanded'))
        setRestingHeight(node.getBoundingClientRect().height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const { expanded, fullscreen, enterNative, exitNative, leave } = usePlayerPresentation(
    wrapper,
    immersive,
    settingsOpen || prompt !== null,
    onEnter,
    onExit,
  );
  const owner = useRef({});
  const stopCurrent = useRef<() => void>(() => {});
  stopCurrent.current = () => {
    host.current?.close();
    setPlaying(false);
    if (expanded) leave();
    onStop?.();
  };
  useEffect(() => {
    if (!playing) return;
    const token = owner.current;
    playback.claim(token, 'napplet', () => stopCurrent.current());
    const hide = () => {
      if (document.hidden) stopCurrent.current();
    };
    document.addEventListener('visibilitychange', hide);
    const observer = compact
      ? new IntersectionObserver(([entry]) => {
          if (!entry.isIntersecting && !wrapper.current?.matches(':fullscreen, .player-expanded'))
            stopCurrent.current();
        })
      : null;
    if (wrapper.current) observer?.observe(wrapper.current);
    return () => {
      playback.release(token);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', hide);
    };
  }, [playing, compact]);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  // Parent route revalidation can recreate the model without changing the session.
  // A callback-ref rebind would destroy instance storage, files and subscriptions.
  const bindFrame = useCallback(
    (node: HTMLIFrameElement | null) => {
      host.current?.close();
      host.current = undefined;
      if (!node || !release) return;
      host.current = attachNappletHost({
        frame: node,
        identity: release.hostIdentity,
        manifestId: release.manifest.id,
        relays: release.relays,
        pubkey: currentPubkey.current,
        prompt: setPrompt,
        files: setExports,
        declaration: declaration.current,
        configuration: setConfiguration,
      });
    },
    [release],
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
    setRelease(null);
    void preparePlayback(manifest, napplet.artifactHash)
      .then(async (release) => {
        let config: ReturnType<typeof declaredConfig> = {};
        const html = await loadArtifact(release.artifactHash, controller.signal, (verifiedHtml) => {
          config = declaredConfig(verifiedHtml);
          return nappletPrelude(shim, config);
        });
        if (!controller.signal.aborted) {
          declaration.current = config;
          setRelease({ ...release, relays: [...(napplet.relays ?? [])] });
          setDoc(html);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'Could not load this creation.');
      });
    return () => controller.abort();
  }, [playing, releaseId, revision]);
  return (
    <div className="player-slot" style={expanded ? { height: restingHeight } : undefined}>
      <div
        ref={wrapper}
        tabIndex={-1}
        aria-label={`${napplet.title} player`}
        className={`player-wrap${compact ? ' player-compact' : ''}${expanded ? ' player-expanded' : ''}`}
      >
        {expanded && (
          <div className="player-bar" inert={prompt !== null || settingsOpen}>
            {detailPath ? (
              <Button variant="ghost" asChild className="player-back">
                <a
                  href={detailPath}
                  onClick={(event) => {
                    if (
                      event.button ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return;
                    event.preventDefault();
                    leave();
                  }}
                >
                  <ArrowLeft size={17} />
                  <span>Back to details</span>
                </a>
              </Button>
            ) : (
              <Button variant="ghost" onClick={leave} className="player-back">
                <ArrowLeft size={17} />
                <span>{returnLabel}</span>
              </Button>
            )}
            <div className="player-bar-title">
              <strong>{napplet.title}</strong>
              <span>Esc exits browser fullscreen. Back keeps your session.</span>
            </div>
            <div className="player-bar-actions">
              {immersive && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={copied ? 'Play link copied' : 'Copy play link'}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(location.origin + location.pathname);
                      setCopied(true);
                      setCopyError('');
                    } catch {
                      setCopyError('Copy this page’s address to share the player.');
                    }
                  }}
                >
                  {copied ? <Check size={17} /> : <Copy size={17} />}
                </Button>
              )}
              {!fullscreen && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Enter browser fullscreen"
                  onClick={enterNative}
                >
                  <Expand size={17} />
                </Button>
              )}
            </div>
            {copyError && (
              <p role="status" className="player-copy-error">
                {copyError}
              </p>
            )}
            <noscript>Enable JavaScript to play this napplet.</noscript>
          </div>
        )}
        <div className="player-stage">
          {!playing ? (
            <button
              disabled={!ready}
              className="player-cover"
              onClick={() => {
                if (expanded) enterNative();
                setPlaying(true);
              }}
              aria-label={`Start ${napplet.title}`}
            >
              <img
                className={external && !napplet.preview ? 'generated-poster' : undefined}
                src={external ? publicPoster(napplet) : `/posters/${napplet.slug}.svg`}
                alt=""
                referrerPolicy="no-referrer"
              />
              <span>
                <Play size={22} fill="currentColor" />{' '}
                {expanded ? 'Play in fullscreen' : 'Play napplet'}
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
              ref={bindFrame}
              title={napplet.title}
              srcDoc={doc}
              sandbox={PLAYER_SANDBOX}
              inert={prompt !== null || settingsOpen}
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
        <div className="player-controls" inert={prompt !== null || settingsOpen}>
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
            {configuration && (
              <SettingsControl
                session={configuration}
                container={wrapper.current}
                title={napplet.title}
                iconOnly
                onOpenChange={setSettingsOpen}
              />
            )}
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
              onClick={() => stopCurrent.current()}
            >
              <Square size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={fullscreen || expanded ? 'Exit fullscreen' : 'Fullscreen'}
              onClick={() => {
                if (document.fullscreenElement === wrapper.current) {
                  exitNative();
                  return;
                }
                if (expanded) {
                  leave();
                  return;
                }
                enterNative();
              }}
            >
              {fullscreen || expanded ? <Minimize size={17} /> : <Expand size={17} />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
