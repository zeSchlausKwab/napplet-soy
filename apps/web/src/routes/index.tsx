import {
  createFileRoute,
  Link,
  useNavigate,
  stripSearchParams,
  type SearchSchemaInput,
} from '@tanstack/react-router';
import { ArrowDown, ArrowUpRight, Search, Shuffle, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { gallerySearchSchema, type GallerySearch } from '../../../../packages/protocol/src';
import { matchesGallery, topicFacets } from '../../../../packages/protocol/src/topics';
import { getGallery, getPublicCatalog } from '@/lib/catalog.functions';
import { NappletCard } from '@/components/napplet-card';
import { useNostr } from '@/components/nostr-provider';
import { Button } from '@/components/ui/button';
import { publicLink } from '../../../../packages/backend/src/public-model';

export const Route = createFileRoute('/')({
  validateSearch: (input: SearchSchemaInput & Partial<GallerySearch>) =>
    gallerySearchSchema.parse(input),
  search: { middlewares: [stripSearchParams({ tag: '', sort: 'curated', q: '' })] },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [local, publicCatalog] = await Promise.all([
      getGallery({ data: { tag: '', q: '', sort: 'curated' } }),
      getPublicCatalog(),
    ]);
    const cards = local.filter(
      (n) =>
        !publicCatalog.entries.some(
          (entry) =>
            entry.manifest.kind === 35129 &&
            entry.pubkey === n.pubkey &&
            entry.manifest.tags.some((t) => t[0] === 'd' && t[1] === n.identifier) &&
            (entry.manifest.created_at > n.createdAt ||
              (entry.manifest.created_at === n.createdAt && entry.revisionId < n.currentId)),
        ),
    );
    const curated = new Set(cards.map((n) => `35129:${n.pubkey}:${n.identifier}`));
    const catalog = [
      ...cards,
      ...publicCatalog.entries.filter(
        (n) =>
          !curated.has(
            `${n.manifest.kind}:${n.pubkey}:${n.manifest.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`,
          ),
      ),
    ];
    const napplets = catalog.filter((n) => matchesGallery(n, deps));
    if (deps.sort === 'new')
      napplets.sort(
        (a, b) =>
          ('provenance' in b ? b.manifest.created_at : b.createdAt) -
          ('provenance' in a ? a.manifest.created_at : a.createdAt),
      );
    return {
      napplets,
      topics: topicFacets(catalog),
      total: catalog.length,
      status: publicCatalog.status,
    };
  },
  component: Gallery,
});
function Gallery() {
  const { ready } = useNostr();
  const { napplets, topics, total, status } = Route.useLoaderData();
  const [showAllTags, setShowAllTags] = useState(false);
  const search = Route.useSearch(),
    navigate = useNavigate({ from: '/' });
  const update = (patch: Partial<GallerySearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), resetScroll: false });
  const visibleTopics = topics.slice(0, 5);
  if (search.tag && !visibleTopics.some(({ topic }) => topic === search.tag))
    visibleTopics.push(
      topics.find(({ topic }) => topic === search.tag) ?? { topic: search.tag, count: 0 },
    );
  const tagButton = ({ topic, count }: { topic: string; count: number }) => (
    <button
      key={topic}
      disabled={!ready}
      aria-label={`Filter by #${topic}`}
      aria-pressed={search.tag === topic}
      className={search.tag === topic ? 'selected' : ''}
      onClick={() => update({ tag: search.tag === topic ? '' : topic })}
    >
      <span className="topic-name">#{topic}</span>
      <span className="topic-count">{count}</span>
    </button>
  );
  return (
    <>
      <section className="hero">
        <div>
          <div className="eyebrow">
            <span className="status-dot" /> A PLAYGROUND FOR THE INTERNET
          </div>
          <h1>
            Small code.
            <br />
            Big{' '}
            <span className="weird-word">
              weird
              <svg viewBox="0 0 320 22" aria-hidden="true">
                <path d="M4 13Q110 -2 208 12T316 8M19 19Q166 5 289 18" />
              </svg>
            </span>
            <span className="coral">.</span>
          </h1>
          <p>
            Tiny games. Happy accidents. Wonderfully unnecessary things.
            <br className="desktop-break" /> Made by people with an idea and an afternoon.
          </p>
          <a className="browse-link" href="#explore">
            Find your next rabbit hole <ArrowDown size={16} />
          </a>
        </div>
        <div className="hero-side">
          <div className="orbit-doodle" aria-hidden="true">
            <svg viewBox="0 0 220 160">
              <ellipse cx="110" cy="80" rx="92" ry="31" transform="rotate(-30 110 80)" />
              <ellipse cx="110" cy="80" rx="92" ry="31" transform="rotate(30 110 80)" />
              <path d="M110 50V110M80 80H140M89 59L131 101M89 101L131 59" />
              <circle cx="177" cy="32" r="8" />
            </svg>
          </div>
          <span className="remix-sticker">
            OPEN SOURCE.
            <br />
            OPEN SEASON.
          </span>
          <p>
            See something you like?
            <br />
            Peek at the code. Make it your own.
          </p>
          <Link to="/create">
            Everyone starts somewhere <ArrowUpRight size={14} />
          </Link>
        </div>
      </section>
      <section id="explore" className="explore-section" aria-label="Explore napplets">
        <div className="explore-top">
          <div>
            <h2>
              The playground <span>{String(napplets.length).padStart(2, '0')}</span>
            </h2>
            <p>Follow a tag. Find your kind of weird.</p>
            {status.publicdev && !status.fetchedAt && (
              <p className="publicdev-status" role="status">
                Discovery is temporarily unavailable. Showing the available collection.
              </p>
            )}
          </div>
          <Button
            variant="outline"
            className="shuffle-button"
            disabled={!ready || !napplets.length}
            onClick={() => {
              const n = napplets[Math.floor(Math.random() * napplets.length)];
              if ('provenance' in n) {
                void navigate(publicLink(n));
                return;
              }
              void navigate({
                to: '/$creator/$slug',
                params: { creator: `@${n.handle}`, slug: n.slug },
              });
            }}
          >
            <Shuffle size={15} />
            Surprise me
          </Button>
        </div>
        <div className="gallery-tools">
          <div className="topic-tabs" role="group" aria-label="Filter by tag">
            <button
              disabled={!ready}
              aria-pressed={!search.tag}
              className={!search.tag ? 'selected' : ''}
              onClick={() => update({ tag: '' })}
            >
              <Sparkles size={14} /> Everything <span className="topic-count">{total}</span>
            </button>
            {visibleTopics.map(tagButton)}
            {topics.length > 5 && (
              <button
                disabled={!ready}
                aria-expanded={showAllTags}
                aria-controls="all-topics"
                onClick={() => setShowAllTags(!showAllTags)}
              >
                {showAllTags ? 'Fewer tags' : 'More tags'}
              </button>
            )}
          </div>
          <div className="search-sort">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                update({ q: String(new FormData(e.currentTarget).get('q') ?? '') });
              }}
              className="search-field"
            >
              <Search size={15} />
              <input
                aria-label="Search napplets"
                name="q"
                placeholder="Find a little something…"
                defaultValue={search.q}
                key={search.q}
              />
              {search.q && (
                <button type="button" aria-label="Clear search" onClick={() => update({ q: '' })}>
                  <X size={13} />
                </button>
              )}
            </form>
            <select
              aria-label="Sort napplets"
              value={search.sort}
              onChange={(e) => update({ sort: e.target.value as GallerySearch['sort'] })}
            >
              <option value="curated">Curated</option>
              <option value="new">Newest</option>
            </select>
          </div>
        </div>
        {showAllTags && (
          <div className="topic-panel" id="all-topics">
            <p>
              Tags from creators{' '}
              <span>Pick a topic to explore. Creations without tags stay in Everything.</span>
            </p>
            <div className="topic-tabs" role="group" aria-label="More tags">
              {topics
                .filter(({ topic }) => !visibleTopics.some((t) => t.topic === topic))
                .map(tagButton)}
            </div>
          </div>
        )}
        <div className="napplet-grid">
          {napplets.map((n, index) => (
            <NappletCard
              key={'provenance' in n ? n.revisionId : n.snapshotId}
              napplet={n}
              index={index}
            />
          ))}
        </div>
        {!napplets.length && (
          <div className="empty-results">
            <h3>No little wonders found.</h3>
            <p>Try a different word or open up the filters.</p>
            <Button variant="outline" onClick={() => update({ q: '', tag: '' })}>
              Show everything
            </Button>
          </div>
        )}
      </section>
      <section className="create-banner">
        <span className="banner-star">✳</span>
        <div>
          <h2>The next weird thing could be yours.</h2>
          <p>Start small. Follow the idea. See what happens.</p>
        </div>
        <Link to="/create">
          Make your first napplet <ArrowUpRight size={17} />
        </Link>
      </section>
    </>
  );
}
