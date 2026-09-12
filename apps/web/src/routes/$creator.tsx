import { createFileRoute, Outlet, useMatchRoute, notFound } from '@tanstack/react-router';
import { getGallery } from '@/lib/catalog.functions';
import { NappletCard } from '@/components/napplet-card';
export const Route = createFileRoute('/$creator')({
  loader: async ({ params }) => {
    if (params.creator !== '@space-lab') throw notFound();
    return getGallery({ data: { tag: '', sort: 'curated', q: '' } });
  },
  component: Creator,
});
function Creator() {
  const match = useMatchRoute();
  const { creator } = Route.useParams();
  const napplets = Route.useLoaderData();
  if (match({ to: '/$creator/$slug', params: { creator }, fuzzy: true })) return <Outlet />;
  return (
    <section className="creator-page">
      <span className="eyebrow">THE STARTER COLLECTION</span>
      <h1>
        Space lab<span className="coral">.</span>
      </h1>
      <p>
        A few small experiments to get this whole thing started. Pick one up and see where it takes
        you.
      </p>
      <div className="napplet-grid">
        {napplets.map((n) => (
          <NappletCard key={n.slug} napplet={n} />
        ))}
      </div>
    </section>
  );
}
