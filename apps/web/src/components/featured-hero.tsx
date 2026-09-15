import { Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, ArrowUpRight, Pause, Play, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  publicLink,
  publicPoster,
  type PublicNapplet,
} from '../../../../packages/backend/src/public-model';
import { getFeaturedGallery } from '@/lib/catalog.functions';
import { Button } from './ui/button';

export function FeaturedHero({
  initial,
  empty,
}: {
  initial: PublicNapplet[];
  empty: React.ReactNode;
}) {
  const [entries, setEntries] = useState(initial);
  const [selection, setSelection] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reduced, setReduced] = useState(true);
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLElement>(null);
  const index = Math.max(
    0,
    entries.findIndex((n) => n.revisionId === selection),
  );
  const current = entries[index];
  useEffect(() => setEntries(initial), [initial]);
  useEffect(() => {
    let alive = true,
      pending = false;
    async function refresh() {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const result = await getFeaturedGallery();
        if (alive) setEntries(result);
      } catch {
        /* Keep the last view during a transient outage; playback rechecks policy. */
      } finally {
        pending = false;
      }
    }
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!root.current) return;
    let inView = false;
    const update = () => setVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      update();
    });
    observer.observe(root.current);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [!!current]);
  useEffect(() => {
    if (entries.length < 2 || paused || hovered || focused || reduced || !visible) return;
    const timer = setInterval(
      () => setSelection(entries[(index + 1) % entries.length].revisionId),
      7000,
    );
    return () => clearInterval(timer);
  }, [entries, index, paused, hovered, focused, reduced, visible]);
  function move(offset: number) {
    setPaused(true);
    setSelection(entries[(index + offset + entries.length) % entries.length].revisionId);
  }
  if (!current) return empty;
  return (
    <section
      ref={root}
      className="featured-hero"
      aria-label="Featured napplets"
      aria-roledescription="carousel"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={(event) => {
        setFocused(true);
        if (!(event.target as HTMLElement).closest('[data-rotation-control]')) setPaused(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div className="featured-heading">
        <span className="eyebrow">
          <Sparkles size={14} /> PICKED FOR THE PLAYGROUND
        </span>
        <span>
          {String(index + 1).padStart(2, '0')} / {String(entries.length).padStart(2, '0')}
        </span>
      </div>
      <Link
        {...publicLink(current)}
        className="featured-art"
        aria-label={`Explore featured napplet: ${current.title}`}
      >
        <img
          src={publicPoster(current)}
          className={!current.preview ? 'generated-poster' : undefined}
          width={720}
          height={450}
          alt=""
          referrerPolicy="no-referrer"
        />
        <span className="featured-open">
          <ArrowUpRight size={22} />
        </span>
      </Link>
      <div
        className="featured-caption"
        aria-live={paused || reduced || focused ? 'polite' : 'off'}
        aria-atomic="true"
      >
        <Link {...publicLink(current)}>{current.title}</Link>
        <p>{current.description || 'A little world worth a look.'}</p>
        <span>{current.creator}</span>
      </div>
      {entries.length > 1 && (
        <div className="featured-controls">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous featured napplet"
            onClick={() => move(-1)}
          >
            <ArrowLeft size={16} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next featured napplet"
            onClick={() => move(1)}
          >
            <ArrowRight size={16} />
          </Button>
          {!reduced && (
            <Button
              variant="ghost"
              size="sm"
              data-rotation-control
              aria-label={paused ? 'Resume featured rotation' : 'Pause featured rotation'}
              onClick={() => setPaused((value) => !value)}
            >
              {paused ? <Play size={13} /> : <Pause size={13} />}
              {paused ? 'Resume' : 'Pause'}
            </Button>
          )}
          <Link to="/" search={{ sort: 'featured' }} className="featured-all">
            All featured <ArrowUpRight size={13} />
          </Link>
        </div>
      )}
    </section>
  );
}
