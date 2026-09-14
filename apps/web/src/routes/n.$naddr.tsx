import { PublicDetail } from '@/components/public-detail';
import { nappletHead } from '@/lib/napplet-head';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { getDiscoveredNapplet } from '@/lib/catalog.functions';
import { Detail } from '@/components/detail';
import { DiscoveryState } from '@/components/discovery-state';
export const Route = createFileRoute('/n/$naddr')({
  loader: async ({ params }) => {
    const result = await getDiscoveredNapplet({ data: { type: 'address', naddr: params.naddr } });
    if (!result.napplet && !result.discovery) throw notFound();
    return result;
  },
  pendingMs: 200,
  pendingComponent: () => <DiscoveryState poll={false} />,
  head: ({ loaderData }) => {
    const n = loaderData?.napplet;
    return n
      ? nappletHead(
          n,
          'provenance' in n ? `/n/${n.naddr}` : `/@${n.handle}/${n.slug}`,
          'provenance' in n ? n.revisionId : n.snapshot.id,
        )
      : {
          meta: [
            { title: 'Discovering a napplet — napplet.soy' },
            { name: 'robots', content: 'noindex' },
          ],
        };
  },
  component: () => {
    const { napplet: n, discovery, message } = Route.useLoaderData();
    if (
      !n ||
      (discovery &&
        ['queued', 'searching'].includes(discovery) &&
        'availability' in n &&
        n.availability !== 'ready')
    )
      return <DiscoveryState state={discovery ?? 'failed'} message={message} />;
    return 'provenance' in n ? <PublicDetail napplet={n} /> : <Detail napplet={n} />;
  },
});
