import { createFileRoute } from '@tanstack/react-router';
import { Proposals } from '@/components/proposals';
export const Route = createFileRoute('/proposals/$proposal')({
  head: () => ({ meta: [{ title: 'Proposed changes — napplet.soy' }] }),
  component: () => {
    const { proposal } = Route.useParams();
    return (
      <main className="page-shell">
        <Proposals reference={proposal} />
      </main>
    );
  },
});
