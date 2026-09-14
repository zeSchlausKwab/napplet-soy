import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Play, Info } from 'lucide-react';
import { TopicTags } from './topic-tags';
import { Player } from './player';
import { useEffect, useRef } from 'react';
import type { NappletCard as Card } from '../../../../packages/backend/src/catalog';
import {
  publicPoster,
  publicLink,
  type PublicNapplet,
} from '../../../../packages/backend/src/public-model';
export function NappletCard({
  napplet,
  index = 0,
  playing = false,
  onPlay,
  onStop,
}: {
  napplet: Card | PublicNapplet;
  index?: number;
  playing?: boolean;
  onPlay?: () => void;
  onStop?: () => void;
}) {
  const article = useRef<HTMLElement>(null);
  const stop = useRef(onStop);
  stop.current = onStop;
  useEffect(() => {
    if (!playing || !article.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting && !article.current?.querySelector(':fullscreen, .player-expanded'))
        stop.current?.();
    });
    observer.observe(article.current.querySelector('.player-stage') ?? article.current);
    return () => observer.disconnect();
  }, [playing]);
  const external = 'provenance' in napplet;
  const playable = !external || napplet.availability === 'ready';
  const link = external
    ? publicLink(napplet)
    : {
        to: '/$creator/$slug' as const,
        params: { creator: `@${napplet.handle}`, slug: napplet.slug },
      };
  return (
    <article
      ref={article}
      className={`napplet-card${playing ? ' is-playing' : ''}`}
      style={{ animationDelay: `${index * 25}ms` }}
    >
      {playing && external ? (
        <Player napplet={napplet} autoPlay compact onStop={onStop} />
      ) : (
        <Link
          {...link}
          className="card-preview"
          aria-label={`${playable ? 'Play' : 'View'} ${napplet.title}`}
          onClick={(event) => {
            if (
              onPlay &&
              playable &&
              external &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.shiftKey &&
              !event.altKey
            ) {
              event.preventDefault();
              onPlay();
            }
          }}
        >
          <img
            className={external && !napplet.preview ? 'generated-poster' : undefined}
            src={external ? publicPoster(napplet) : `/posters/${napplet.slug}.svg`}
            referrerPolicy="no-referrer"
            alt=""
            width="720"
            height="450"
            loading={index < 3 ? 'eager' : 'lazy'}
          />
          <span className="play-indicator">
            {playable ? <Play size={18} fill="currentColor" /> : <Info size={20} />}
          </span>
        </Link>
      )}
      <div className="card-heading">
        <Link {...link}>{napplet.title}</Link>
        <ArrowUpRight size={17} />
      </div>
      <div className={`card-meta${external ? ' public-meta' : ''}`}>
        {external ? (
          <span className="public-creator">{napplet.creator}</span>
        ) : (
          <Link to="/$creator" params={{ creator: `@${napplet.handle}` }}>
            <span className="mini-avatar">s</span>@{napplet.handle}
          </Link>
        )}
        <span>
          {external ? (
            <span className={playable ? 'compatibility-ready' : 'compatibility-missing'}>
              {playable
                ? 'Ready to play'
                : napplet.availability === 'host-required'
                  ? 'Needs more capabilities'
                  : 'Download unavailable'}
            </span>
          ) : (
            <>
              {(napplet.bytes / 1024).toFixed(1)} KB <span className="meta-dot">·</span> open source
            </>
          )}
        </span>
      </div>
      <TopicTags topics={napplet.topics.slice(0, 3)}>
        {napplet.topics.length > 3 && (
          <Link {...link} aria-label={`View all tags for ${napplet.title}`}>
            +{napplet.topics.length - 3}
          </Link>
        )}
      </TopicTags>
    </article>
  );
}
