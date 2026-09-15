import { createFileRoute, redirect } from '@tanstack/react-router';
import { creatorSearch } from '@/lib/creator-search';

// Existing help links keep working; release downloads remain under /cli/download/.
export const Route = createFileRoute('/cli')({
  validateSearch: creatorSearch,
  beforeLoad: ({ search, location }) => {
    if (location.pathname === '/cli' || location.pathname === '/cli/') {
      throw redirect({ to: '/create', search, hash: location.hash, statusCode: 308 });
    }
  },
});
