import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import './collaboration-story.css';

/** Site-owned presentation, isolated from the app's CSS and disposed on navigation. */
export function CollaborationStory() {
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const visible = useRef(false);
  const connection = useRef<() => void>(() => {});
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  function syncVisibility() {
    frame.current?.contentWindow?.spatialProof?.setVisible(visible.current && !document.hidden);
  }
  function connect() {
    connection.current();
    const child = frame.current?.contentWindow;
    if (!child) return;
    const ready = () => {
      clearTimeout(timeout);
      setStatus('ready');
      syncVisibility();
    };
    const failed = () => {
      clearTimeout(timeout);
      setStatus('failed');
    };
    const showGame = () =>
      container.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
    const timeout = setTimeout(failed, 20_000);
    child.addEventListener('spatial-ready', ready);
    child.addEventListener('spatial-error', failed);
    child.addEventListener('spatial-game-open', showGame);
    connection.current = () => {
      clearTimeout(timeout);
      child.removeEventListener('spatial-ready', ready);
      child.removeEventListener('spatial-error', failed);
      child.removeEventListener('spatial-game-open', showGame);
      child.spatialProof?.dispose();
    };
    if (child.spatialProof) ready();
    else if (child.document.querySelector('#error')?.textContent) failed();
  }
  useEffect(() => {
    const element = container.current!;
    const size = new ResizeObserver(() => {
      element.style.setProperty('--story-width', `${document.documentElement.clientWidth}px`);
    });
    size.observe(document.documentElement);
    // Keep Three.js out of the main application bundle and load only near the story.
    const preload = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setLoaded(true);
        preload.disconnect();
      },
      { rootMargin: '300px' },
    );
    const playback = new IntersectionObserver(
      ([entry]) => {
        visible.current = entry.isIntersecting && entry.intersectionRatio >= 0.2;
        syncVisibility();
      },
      { threshold: [0, 0.2] },
    );
    preload.observe(element);
    playback.observe(element);
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      preload.disconnect();
      playback.disconnect();
      size.disconnect();
      document.removeEventListener('visibilitychange', syncVisibility);
      connection.current();
    };
  }, []);
  return (
    <section className="collaboration-story" id="story" aria-labelledby="story-title">
      <div className="story-heading">
        <div>
          <span className="story-kicker">MAKE IT. SHARE IT. CHANGE IT.</span>
          <h2 id="story-title">A little idea branches out.</h2>
        </div>
        <p>
          One idea, someone else’s twist, a better game.
          <br />
          Follow the branches. Then have a go.
        </p>
      </div>
      <div className="story-cinema" ref={container}>
        {status !== 'ready' && (
          <div className="story-placeholder">
            <img
              src="/story/story-poster.webp"
              alt="A tree of Soybert game versions, from original to remix and shared release"
              loading="lazy"
            />
            <span>
              {status === 'failed'
                ? 'The 3D story could not start.'
                : 'One little idea. Room to grow.'}
            </span>
          </div>
        )}
        {loaded && (
          <iframe
            key={attempt}
            ref={frame}
            className={status === 'ready' ? 'ready' : ''}
            src="/story/index.html?landing&site"
            title="Live 3D collaboration story"
            allow="autoplay; fullscreen"
            allowFullScreen
            onLoad={connect}
            onError={() => setStatus('failed')}
          />
        )}
      </div>
      <div className="story-caption">
        <p role="status">
          {status === 'failed'
            ? 'You can still explore, create and remix. The story is optional.'
            : 'Live 3D · drag the timeline to explore. Sound starts off. An illustrated collaboration you can play.'}
        </p>
        {status === 'failed' ? (
          <button
            onClick={() => {
              connection.current();
              connection.current = () => {};
              setStatus('loading');
              setAttempt((n) => n + 1);
            }}
          >
            Retry story ↻
          </button>
        ) : (
          <button
            disabled={status !== 'ready'}
            onClick={() => frame.current?.contentWindow?.spatialProof?.overview()}
          >
            Explore the tree ↗
          </button>
        )}
      </div>
      <noscript>
        <p>
          Make a game with soyLI, remix someone’s idea, then propose the improvement to its creator.{' '}
          <Link to="/docs">Read how collaboration works ↗</Link>
        </p>
      </noscript>
    </section>
  );
}
