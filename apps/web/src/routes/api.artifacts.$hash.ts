import { createFileRoute } from '@tanstack/react-router';
import { artifact } from '../../../../packages/backend/src/catalog';
export const Route = createFileRoute('/api/artifacts/$hash')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const file = await artifact(params.hash);
        return file
          ? new Response(file, {
              headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Content-Disposition': 'attachment; filename="index.html"',
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'no-store',
                'Content-Security-Policy': "default-src 'none'; sandbox",
              },
            })
          : new Response('Artifact not found', { status: 404 });
      },
    },
  },
});
