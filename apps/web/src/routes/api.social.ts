import { createFileRoute } from '@tanstack/react-router';
import { socialResponse } from '../../../../packages/backend/src/social-service';
export const Route = createFileRoute('/api/social')({
  server: {
    handlers: {
      GET: ({ request }) => socialResponse(request),
      POST: ({ request }) => socialResponse(request),
    },
  },
});
