import { createFileRoute } from '@tanstack/react-router';
import { namesResponse } from '../../../../packages/backend/src/names-response';
export const Route = createFileRoute('/api/names')({
  server: {
    handlers: {
      GET: ({ request }) => namesResponse(request),
      POST: ({ request }) => namesResponse(request),
    },
  },
});
