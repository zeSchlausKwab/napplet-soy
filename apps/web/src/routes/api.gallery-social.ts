import { createFileRoute } from '@tanstack/react-router';
import { gallerySocialResponse } from '../../../../packages/backend/src/gallery-social';

export const Route = createFileRoute('/api/gallery-social')({
  server: { handlers: { GET: ({ request }) => gallerySocialResponse(request) } },
});
