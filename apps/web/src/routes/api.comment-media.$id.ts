import { createFileRoute } from '@tanstack/react-router';
import { commentMediaResponse } from '../../../../packages/backend/src/comment-media';
export const Route = createFileRoute('/api/comment-media/$id')({
  server: {
    handlers: {
      GET: ({ request, params }) => commentMediaResponse(request, params.id),
      HEAD: ({ request, params }) => commentMediaResponse(request, params.id),
    },
  },
});
