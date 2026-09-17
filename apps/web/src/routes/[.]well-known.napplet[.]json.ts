import { createFileRoute } from '@tanstack/react-router';

/** Operator bootstrap only; actual backend traffic goes directly over Nostr. */
export const Route = createFileRoute('/.well-known/napplet.json')({
  server: {
    handlers: {
      GET: () => {
        const pubkey = process.env.SPACE_CVM_PUBKEY;
        if (!pubkey) return Response.json({ error: 'Backend is not configured' }, { status: 503 });
        return Response.json(
          {
            version: 1,
            backend: {
              pubkey,
              relays: (process.env.SPACE_CVM_PUBLIC_RELAYS || process.env.SPACE_CVM_RELAYS || '')
                .split(',')
                .filter(Boolean),
            },
          },
          {
            headers: { 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' },
          },
        );
      },
    },
  },
});
