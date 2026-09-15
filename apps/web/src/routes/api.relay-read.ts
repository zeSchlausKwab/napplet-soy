import { createFileRoute } from '@tanstack/react-router';
import { playbackRelayResponse } from '../../../../packages/backend/src/playback-relays';

export const Route = createFileRoute('/api/relay-read')({
  server: { handlers: { POST: ({ request }) => playbackRelayResponse(request) } },
});
