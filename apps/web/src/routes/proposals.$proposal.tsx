import { createFileRoute } from '@tanstack/react-router';
import { Proposals } from '@/components/proposals';
import { siteHead } from '@/lib/site-head';
export const Route = createFileRoute('/proposals/$proposal')({
  head: ({ match, params }) =>
    siteHead(
      match.context.clientPolicy.siteOrigin,
      `/proposals/${encodeURIComponent(params.proposal)}`,
      'Proposed changes — napplet.soy',
      'Play a proposed version, inspect the changes and build on an idea together.',
    ),
  component: () => {
    const { proposal } = Route.useParams();
    return (
      <main className="page-shell">
        <Proposals reference={proposal} />
      </main>
    );
  },
});
