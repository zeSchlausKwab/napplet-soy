import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Film, Pause } from 'lucide-react';
import type { CachedVideo } from '../../../../packages/protocol/src/preview-video';

// One decoded preview at a time, even when a napplet appears in several gallery rails.
let stopCurrent: (() => void) | undefined;
export function PreviewCover({
  children,
  video,
  revision,
  title,
}: {
  children: ReactNode;
  video?: CachedVideo | null;
  revision: string;
  title: string;
}) {
  const container = useRef<HTMLDivElement>(null),
    player = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false),
    [failed, setFailed] = useState(false);
  const visible = useRef(false),
    automatic = useRef(false);
  const stop = useRef(() => setActive(false));
  function begin(explicit = false) {
    if (
      !video ||
      failed ||
      !visible.current ||
      document.hidden ||
      (!explicit && !automatic.current)
    )
      return;
    if (stopCurrent !== stop.current) stopCurrent?.();
    stopCurrent = stop.current;
    setActive(true);
  }
  useEffect(() => {
    setFailed(false);
    setActive(false);
    if (!video || !container.current) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const preferences = () => {
      automatic.current =
        !motion.matches &&
        !(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
      if (!automatic.current) setActive(false);
    };
    preferences();
    motion.addEventListener('change', preferences);
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible.current = entry.isIntersecting && entry.intersectionRatio >= 0.25;
        if (!visible.current) setActive(false);
      },
      { threshold: [0, 0.25] },
    );
    observer.observe(container.current);
    const hide = () => {
      if (document.hidden) setActive(false);
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      observer.disconnect();
      motion.removeEventListener('change', preferences);
      document.removeEventListener('visibilitychange', hide);
      if (stopCurrent === stop.current) stopCurrent = undefined;
    };
  }, [video?.hash, revision]);
  useEffect(() => {
    const node = player.current;
    if (!node || !video || !active) return;
    node.muted = true;
    node.src = `/api/preview-videos/${revision}?v=${video.hash}`;
    let alive = true;
    void node.play().catch(() => {
      if (alive) {
        setActive(false);
        setFailed(true);
      }
    });
    return () => {
      alive = false;
      node.pause();
      node.removeAttribute('src');
      node.load();
    };
  }, [active, video?.hash, revision]);
  return (
    <div
      ref={container}
      className="card-cover"
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') begin();
      }}
      onPointerLeave={() => setActive(false)}
    >
      {children}
      {video && !failed && (
        <>
          <video
            ref={player}
            className={`card-preview-clip${active ? ' is-active' : ''}`}
            muted
            loop
            playsInline
            preload="none"
            aria-hidden="true"
            disablePictureInPicture
            onError={() => {
              setActive(false);
              setFailed(true);
            }}
          />
          <button
            type="button"
            className="clip-toggle"
            aria-label={`${active ? 'Pause' : 'Preview'} clip for ${title}`}
            aria-pressed={active}
            onClick={() => (active ? setActive(false) : begin(true))}
          >
            {active ? <Pause size={14} /> : <Film size={14} />}{' '}
            <span>{active ? 'Pause clip' : 'Preview clip'}</span>
          </button>
        </>
      )}
    </div>
  );
}
