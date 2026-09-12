import {
  createFileRoute,
  Link,
  useNavigate,
  stripSearchParams,
  type SearchSchemaInput,
} from '@tanstack/react-router';
import { ArrowDown, ArrowUpRight, Search, Shuffle, Sparkles, X } from 'lucide-react';
import { gallerySearchSchema, type GallerySearch } from '../../../../packages/protocol/src';
import { getGallery, getPublicCatalog } from '@/lib/catalog.functions';
import { NappletCard } from '@/components/napplet-card';
import { useNostr } from '@/components/nostr-provider';
import { Button } from '@/components/ui/button';
import { publicLink } from '../../../../packages/backend/src/public-model';

export const Route = createFileRoute('/')({
  validateSearch: (input: SearchSchemaInput & Partial<GallerySearch>) =>
    gallerySearchSchema.parse(input),
  search: { middlewares: [stripSearchParams({ category: 'all', sort: 'curated', q: '' })] },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [local, publicCatalog] = await Promise.all([
      getGallery({ data: deps }),
      getPublicCatalog(),
    ]);
    const query = deps.q.trim().toLowerCase();
    const publicEntries = ['all', 'public'].includes(deps.category)
      ? publicCatalog.entries.filter(
          (n) => !query || `${n.title} ${n.description} ${n.creator}`.toLowerCase().includes(query),
        )
      : [];
    const napplets = [...local, ...publicEntries];
    if (deps.sort === 'new')
      napplets.sort(
        (a, b) =>
          ('provenance' in b ? b.manifest.created_at : b.createdAt) -
          ('provenance' in a ? a.manifest.created_at : a.createdAt),
      );
    return { napplets, status: publicCatalog.status };
  },
  component: Gallery,
});
const categories = [
  ['all', 'Everything'],
  ['game', 'Mini games'],
  ['visual', 'Visuals'],
  ['toy', 'Toys'],
  ['meme', 'Digital nonsense'],
  ['public', 'Public napplets'],
] as const;
function Gallery() {
  const { ready } = useNostr();
  const { napplets, status } = Route.useLoaderData();
  const search = Route.useSearch(),
    navigate = useNavigate({ from: '/' });
  const update = (patch: Partial<GallerySearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), resetScroll: false });
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
            <p>
              {status.publicdev
                ? `${status.publicCount} public napplets alongside our local starting points.`
                : 'Six little starting points. All yours to explore.'}
            </p>
            {status.publicdev && (
              <p className="publicdev-status" role="status">
                Public dev · {status.relays.length} Nostr relays ·{' '}
                {status.fetchedAt
                  ? `${status.stale ? 'saved catalog' : 'cached'} ${new Date(status.fetchedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`
                  : 'catalog unavailable; local examples are ready'}
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
          <div className="category-tabs" aria-label="Filter by category">
            {categories
              .filter(([value]) => value !== 'public' || status.publicdev)
              .map(([value, label]) => (
                <button
                  disabled={!ready}
                  key={value}
                  aria-pressed={search.category === value}
                  className={search.category === value ? 'selected' : ''}
                  onClick={() => update({ category: value })}
                >
                  {value === 'all' && <Sparkles size={14} />} {label}
                </button>
              ))}
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
            <Button variant="outline" onClick={() => update({ q: '', category: 'all' })}>
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
