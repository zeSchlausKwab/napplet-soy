import { createFileRoute } from '@tanstack/react-router';
import { catalogStatus } from '../../../../packages/backend/src/public-catalog';
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          status: 'ok',
          service: 'napplet-space',
          catalog: await catalogStatus(),
          runtime: 'bun',
          release: process.env.SPACE_RELEASE_ID ?? 'local',
        }),
    },
  },
});
