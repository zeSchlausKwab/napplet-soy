import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Film, Play } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import {
  commentParts,
  type CommentMedia,
  type CommentNappletTarget,
} from '../../../../packages/protocol/src/comment-content';
import type { SignedEvent } from '../../../../packages/protocol/src';
import { publicPoster } from '../../../../packages/backend/src/public-model';
import { getNapplet, getDiscoveredNapplet } from '@/lib/catalog.functions';
import { playback } from '@/lib/playback-coordinator';
import { ActionButton } from './action-button';
import { Player } from './player';

/** Visibility admits work; leaving the viewport or tab releases decoded media. */
function useVisible() {
  const ref = useRef<HTMLDivElement>(null);
  const [{ visible, visit }, setVisibility] = useState({ visible: false, visit: 0 });
  useEffect(() => {
    let intersecting = false;
    const update = () => {
      const next = intersecting && !document.hidden;
      setVisibility((previous) =>
        previous.visible === next
          ? previous
          : { visible: next, visit: previous.visit + (next ? 1 : 0) },
      );
    };
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      update();
    });
    if (ref.current) observer.observe(ref.current);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return { ref, visible, visit };
}

function MediaAttachment({ media, src }: { media: CommentMedia; src: string }) {
  const { ref, visible, visit } = useVisible();
  const [attempt, setAttempt] = useState(0);
  // Browsers may reuse decoded images even with no-store. A new visit/retry must
  // reach the endpoint so current deletion and moderation policy are checked.
  const mediaSrc = `${src}&view=${visit}&retry=${attempt}`;
  const [loaded, setLoaded] = useState(false),
    [failed, setFailed] = useState(false);
  const node = useRef<HTMLVideoElement>(null),
    owner = useRef({});
  const isImage = media.type === 'image';
  const active = visible && !failed && (isImage || loaded);
  useEffect(() => {
    if (!visible) setLoaded(false);
  }, [visible]);
  useEffect(() => {
    const video = node.current,
      token = owner.current;
    if (!video || !active || isImage) return;
    video.src = mediaSrc;
    return () => {
      playback.release(token);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [active, isImage, mediaSrc]);
  return (
    <div ref={ref} className="comment-attachment comment-media">
      {active && isImage ? (
        <img
          src={mediaSrc}
          alt={media.alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : active ? (
        <video
          ref={node}
          controls
          playsInline
          preload="metadata"
          aria-label={media.alt}
          disablePictureInPicture
          onPlay={() =>
            playback.claim(owner.current, 'media', () => {
              node.current?.pause();
              setLoaded(false);
            })
          }
          onPause={() => playback.release(owner.current)}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="comment-attachment-placeholder">
          <ActionButton
            variant="outline"
            icon={<Film size={16} />}
            error={failed ? 'Media unavailable or too large for this client.' : undefined}
            retryLabel="Retry media"
            onClick={() => {
              setAttempt((value) => value + 1);
              setFailed(false);
              setLoaded(true);
            }}
          >
            {isImage ? 'Load image' : 'Load video'}
          </ActionButton>
        </div>
      )}
      <a
        className="comment-attachment-link"
        href={media.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open original {media.type} ↗
      </a>
    </div>
  );
}

type Model = NonNullable<Awaited<ReturnType<typeof getNapplet>>>;
function NappletAttachment({ target }: { target: CommentNappletTarget }) {
  const { ref, visible } = useVisible();
  const [model, setModel] = useState<Model | null>(null),
    [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const attempted = useRef(false),
    generation = useRef(0),
    alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (!visible) {
      generation.current++;
      setBusy(false);
      return;
    }
    if (attempted.current) return;
    attempted.current = true;
    // Warm previews use the local catalog only. Relay discovery requires an explicit click.
    const version = generation.current;
    void getNapplet({ data: target })
      .then((value) => {
        if (alive.current && generation.current === version) setModel(value);
      })
      .catch(() => {});
  }, [visible, target.key]);
  async function play() {
    // An explicit click can arrive before IntersectionObserver reports the scroll.
    if (busy) return;
    const version = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const found = (await getDiscoveredNapplet({ data: target })).napplet;
      if (!alive.current || generation.current !== version) return;
      if (!found) throw new Error('This reference is not an available napplet.');
      setModel(found);
      if ('availability' in found && found.availability !== 'ready')
        throw new Error(
          'This napplet cannot run in this client yet. Open its details for more information.',
        );
      setPlaying(true);
    } catch (error) {
      if (alive.current && generation.current === version)
        setError(error instanceof Error ? error.message : 'Could not load this napplet.');
    } finally {
      if (alive.current && generation.current === version) setBusy(false);
    }
  }
  const poster = model
    ? 'provenance' in model
      ? publicPoster(model)
      : `/posters/${model.slug}.svg`
    : '';
  return (
    <div ref={ref} className="comment-attachment comment-napplet">
      {playing && model ? (
        <Player
          napplet={model}
          pinned={target.type === 'snapshot'}
          autoPlay
          compact
          returnLabel="Back to comments"
          onStop={() => setPlaying(false)}
        />
      ) : (
        <div className="comment-napplet-cover">
          {model && (
            <img src={poster} alt="" loading="lazy" referrerPolicy="no-referrer" />
          )}
          <div className="comment-napplet-caption">
            <span className="eyebrow">Napplet</span>
            <a href={target.path}>{model?.title ?? 'Explore this napplet'}</a>
            <ActionButton
              variant="outline"
              icon={<Play size={16} fill="currentColor" />}
              working={busy ? 'Finding napplet…' : undefined}
              error={error}
              retryLabel="Retry napplet"
              onClick={play}
            >
              Play here
            </ActionButton>
          </div>
        </div>
      )}
      <a className="comment-attachment-link" href={target.path}>
        Open napplet details →
      </a>
    </div>
  );
}

export function RichComment({ event, reference }: { event: SignedEvent; reference: string }) {
  const [origin, setOrigin] = useState('https://napplet.soy');
  useEffect(() => setOrigin(location.origin), []);
  const parts = useMemo(
    () => commentParts(event.content, event.tags, origin),
    [event.content, event.tags, origin],
  );
  const blocks: ReactNode[] = [],
    inline: ReactNode[] = [];
  const flush = () => {
    if (inline.length) {
      blocks.push(<p key={`text-${blocks.length}`}>{inline.splice(0)}</p>);
    }
  };
  parts.forEach((part, index) => {
    if (part.type === 'napplet' || part.type === 'image' || part.type === 'video') {
      flush();
      blocks.push(
        part.type === 'napplet' ? (
          <NappletAttachment key={index} target={part.target} />
        ) : (
          <MediaAttachment
            key={index}
            media={part}
            src={`/api/comment-media/${event.id}?reference=${encodeURIComponent(reference)}&part=${index}`}
          />
        ),
      );
    } else if (part.type === 'text') inline.push(part.text);
    else if (part.type === 'link' || part.type === 'profile')
      inline.push(
        <a
          key={index}
          href={part.type === 'profile' ? `/p/${nip19.npubEncode(part.pubkey)}` : part.href}
          rel="noopener noreferrer"
          target={part.type === 'link' && /^https?:/.test(part.href) ? '_blank' : undefined}
        >
          {part.text}
        </a>,
      );
  });
  flush();
  return <div className="rich-comment">{blocks}</div>;
}
