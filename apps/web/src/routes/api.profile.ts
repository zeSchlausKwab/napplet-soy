import { createFileRoute } from '@tanstack/react-router';
import { profilesResponse } from '../../../../packages/backend/src/profiles';
const handle = (request: Request) =>
  profilesResponse(request, new URL(request.url).searchParams.get('pubkey') ?? 'invalid');
export const Route = createFileRoute('/api/profile')({
  server: {
    handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) },
  },
});
