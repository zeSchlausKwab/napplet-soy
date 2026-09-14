import { createFileRoute } from '@tanstack/react-router';
import { manifestResponse } from '../../../../packages/backend/src/manifest-response';
export const Route = createFileRoute('/api/manifest')({
  server: { handlers: { GET: ({ request }) => manifestResponse(request) } },
});
