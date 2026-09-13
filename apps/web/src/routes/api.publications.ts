import { createFileRoute } from '@tanstack/react-router';
import { publicationResponse } from '../../../../packages/backend/src/publication-response';

export const Route = createFileRoute('/api/publications')({
  server: { handlers: { GET: ({ request }) => publicationResponse(request) } },
});
