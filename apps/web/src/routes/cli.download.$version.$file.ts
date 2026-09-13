import { createFileRoute } from '@tanstack/react-router';
import { cliDownload } from '../../../../packages/backend/src/cli-download';
export const Route = createFileRoute('/cli/download/$version/$file')({
  server: {
    handlers: {
      GET: ({ request, params }) => cliDownload(request, params.version, params.file),
      HEAD: ({ request, params }) => cliDownload(request, params.version, params.file),
    },
  },
});
