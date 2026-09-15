import { createFileRoute } from '@tanstack/react-router';
import { adminAccessResponse } from '../../../../packages/backend/src/admin-response';

export const Route = createFileRoute('/api/admin-access')({
  server: { handlers: { GET: ({ request }) => adminAccessResponse(request) } },
});
