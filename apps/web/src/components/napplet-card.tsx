import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Play } from 'lucide-react';
import type { NappletCard as Card } from '../../../../packages/backend/src/catalog';
import {
  publicPoster,
  publicLink,
  type PublicNapplet,
} from '../../../../packages/backend/src/public-model';
export function NappletCard({
  napplet,
  index = 0,
}: {
  napplet: Card | PublicNapplet;
  index?: number;
}) {
  const external = 'provenance' in napplet;
  const link = external
    ? publicLink(napplet)
    : {
        to: '/$creator/$slug' as const,
        params: { creator: `@${napplet.handle}`, slug: napplet.slug },
      };
  return (
    <article className="napplet-card" style={{ animationDelay: `${index * 45}ms` }}>
      <Link {...link} className="card-preview" aria-label={`Play ${napplet.title}`}>
        <img
          src={external ? publicPoster(napplet) : `/posters/${napplet.slug}.svg`}
          referrerPolicy="no-referrer"
          alt=""
          width="720"
          height="450"
          loading={index < 3 ? 'eager' : 'lazy'}
        />
        <span className="category-tag">
          {napplet.category === 'visual' ? 'VISUAL EXPERIMENT' : napplet.category.toUpperCase()}
        </span>
        <span className="play-indicator">
          <Play size={18} fill="currentColor" />
        </span>
      </Link>
      <div className="card-heading">
        <Link {...link}>{napplet.title}</Link>
        <ArrowUpRight size={17} />
      </div>
      <div className="card-meta">
        {external ? (
          <span className="public-creator">{napplet.creator}</span>
        ) : (
          <Link to="/$creator" params={{ creator: `@${napplet.handle}` }}>
            <span className="mini-avatar">s</span>@{napplet.handle}
          </Link>
        )}
        <span>
          {external ? (
            'from Nostr'
          ) : (
            <>
              {(napplet.bytes / 1024).toFixed(1)} KB <span className="meta-dot">·</span> open source
            </>
          )}
        </span>
      </div>
    </article>
  );
}
