import { createFileRoute } from '@tanstack/react-router';
import { adminResponse } from '../../../../packages/backend/src/admin-response';
export const Route = createFileRoute('/api/admin')({
  server: {
    handlers: {
      GET: ({ request }) => adminResponse(request),
      POST: ({ request }) => adminResponse(request),
    },
  },
});
