import { createFileRoute } from '@tanstack/react-router';
import { zapResponse } from '../../../../packages/backend/src/zaps';
export const Route = createFileRoute('/api/zaps')({
  server: {
    handlers: {
      GET: ({ request }) => zapResponse(request),
      POST: ({ request }) => zapResponse(request),
    },
  },
});
