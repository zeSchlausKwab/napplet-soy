import { createFileRoute } from '@tanstack/react-router';
import { genealogyResponse } from '../../../../packages/backend/src/genealogy';
export const Route = createFileRoute('/api/genealogy')({
  server: { handlers: { GET: ({ request }) => genealogyResponse(request) } },
});
