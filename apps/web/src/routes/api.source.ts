import { createFileRoute } from '@tanstack/react-router';
import { sourceDownloadResponse } from '../../../../packages/backend/src/source';
export const Route = createFileRoute('/api/source')({
  server: { handlers: { GET: ({ request }) => sourceDownloadResponse(request) } },
});
