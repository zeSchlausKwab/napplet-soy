import { createFileRoute, Outlet, useMatchRoute, notFound } from '@tanstack/react-router';
import { getGallery, getCreatorNames } from '@/lib/catalog.functions';
import { NappletCard } from '@/components/napplet-card';
import { CreatorLink } from '@/components/creator-link';
import { siteHead } from '@/lib/site-head';
export const Route = createFileRoute('/$creator')({
  loader: async ({ params }) => {
    if (params.creator === '@space-lab')
      return {
        napplets: await getGallery({ data: { tag: '', sort: 'curated', q: '' } }),
        aliases: [],
      };
    if (!/^@[a-z0-9-]{1,32}$/.test(params.creator)) throw notFound();
    const aliases = await getCreatorNames({ data: params.creator });
    if (!aliases.length) throw notFound();
    return { napplets: [], aliases };
  },
  head: ({ match, params }) =>
    siteHead(
      match.context.clientPolicy.siteOrigin,
      `/${params.creator}`,
      `${params.creator} — napplet.soy`,
      'Explore this creator’s napplets. Play, inspect and remix.',
    ),
  component: Creator,
});
function Creator() {
  const match = useMatchRoute();
  const { creator } = Route.useParams();
  const { napplets, aliases } = Route.useLoaderData();
  if (match({ to: '/$creator/$slug', params: { creator }, fuzzy: true })) return <Outlet />;
  return (
    <section className="creator-page">
      <span className="eyebrow">
        {creator === '@space-lab' ? 'THE STARTER COLLECTION' : 'CREATOR COLLECTION'}
      </span>
      <h1>
        {creator === '@space-lab' ? 'Space lab' : creator}
        <span className="coral">.</span>
      </h1>
      <p>Creations with a home here. Pick one up and see where it takes you.</p>
      {!!aliases.length && (
        <p>
          <CreatorLink pubkey={aliases[0].pubkey} />
        </p>
      )}
      <div className="creator-aliases">
        {aliases.map((a) => (
          <a key={a.slug} href={`/@${a.handle}/${a.slug}`}>
            {a.slug.replaceAll('-', ' ')} ↗
          </a>
        ))}
      </div>
      <div className="napplet-grid">
        {napplets.map((n) => (
          <NappletCard key={n.slug} napplet={n} />
        ))}
      </div>
    </section>
  );
}
