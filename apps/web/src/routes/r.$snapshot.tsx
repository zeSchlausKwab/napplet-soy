import { PublicDetail } from '@/components/public-detail';
import { nappletHead } from '@/lib/napplet-head';
import { createFileRoute, notFound, Outlet, useMatchRoute } from '@tanstack/react-router';
import { getNapplet } from '@/lib/catalog.functions';
import { Detail } from '@/components/detail';
export const Route = createFileRoute('/r/$snapshot')({
  loader: async ({ params }) => {
    if (!/^[a-f0-9]{64}$/.test(params.snapshot)) throw notFound();
    const napplet = await getNapplet({ data: { type: 'snapshot', id: params.snapshot } });
    if (!napplet) throw notFound();
    return napplet;
  },
  head: ({ loaderData }) =>
    nappletHead(
      loaderData,
      `/r/${loaderData && 'provenance' in loaderData ? loaderData.revisionId : loaderData?.snapshot.id}`,
      loaderData && 'provenance' in loaderData ? loaderData.revisionId : loaderData?.snapshot.id,
    ),
  component: Release,
});
function Release() {
  const match = useMatchRoute();
  const n = Route.useLoaderData();
  return match({
    to: '/r/$snapshot/source',
    params: { snapshot: 'provenance' in n ? n.revisionId : n.snapshot.id },
  }) ? (
    <Outlet />
  ) : 'provenance' in n ? (
    <PublicDetail napplet={n} />
  ) : (
    <Detail napplet={n} pinned />
  );
}
