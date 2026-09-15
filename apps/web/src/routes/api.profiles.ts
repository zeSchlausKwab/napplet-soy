import { createFileRoute } from '@tanstack/react-router';
import { profilesResponse } from '../../../../packages/backend/src/profiles';
export const Route = createFileRoute('/api/profiles')({
  server: { handlers: { GET: ({ request }) => profilesResponse(request) } },
});
