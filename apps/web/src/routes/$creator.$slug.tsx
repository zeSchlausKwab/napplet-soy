import { PublicDetail } from '@/components/public-detail';
import { nappletHead } from '@/lib/napplet-head';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { getNapplet } from '@/lib/catalog.functions';
import { Detail } from '@/components/detail';
export const Route = createFileRoute('/$creator/$slug')({
  loader: async ({ params }) => {
    const napplet = await getNapplet({ data: { type: 'named', ...params } });
    if (!napplet) throw notFound();
    return napplet;
  },
  head: ({ loaderData, params }) =>
    nappletHead(
      loaderData,
      `/${params.creator}/${params.slug}`,
      loaderData && 'provenance' in loaderData ? loaderData.revisionId : loaderData?.snapshot.id,
    ),
  component: () => {
    const n = Route.useLoaderData();
    return 'provenance' in n ? <PublicDetail napplet={n} /> : <Detail napplet={n} />;
  },
});
