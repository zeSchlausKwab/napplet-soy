import { createFileRoute } from '@tanstack/react-router';
import { profileMediaResponse } from '../../../../packages/backend/src/profile-media';
const handle = (request: Request) =>
  profileMediaResponse(request, new URL(request.url).searchParams.get('pubkey') ?? '', 'og');
export const Route = createFileRoute('/api/profile-og')({
  server: {
    handlers: { GET: ({ request }) => handle(request), HEAD: ({ request }) => handle(request) },
  },
});
