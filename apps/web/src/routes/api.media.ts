import { createFileRoute } from '@tanstack/react-router';
import { audioResponse } from '../../../../packages/backend/src/audio';
export const Route = createFileRoute('/api/media')({
  server: {
    handlers: {
      POST: ({ request }) => audioResponse(request),
      GET: ({ request }) => audioResponse(request),
      DELETE: ({ request }) => audioResponse(request),
    },
  },
});
