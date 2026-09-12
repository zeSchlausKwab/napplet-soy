import { createFileRoute } from '@tanstack/react-router';
import { ogResponse } from '../../../../packages/backend/src/og';
export const Route = createFileRoute('/api/og/$id')({
  server: {
    handlers: {
      GET: ({ params, request }) => ogResponse(params.id, request),
      HEAD: ({ params, request }) => ogResponse(params.id, request),
    },
  },
});
