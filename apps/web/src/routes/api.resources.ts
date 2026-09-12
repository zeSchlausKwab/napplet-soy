import { createFileRoute } from '@tanstack/react-router';
import { resourceResponse } from '../../../../packages/backend/src/resources';

export const Route = createFileRoute('/api/resources')({
  server: { handlers: { POST: ({ request }) => resourceResponse(request) } },
});
