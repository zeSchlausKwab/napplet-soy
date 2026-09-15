import { playableManifest } from './catalog';
import { createPlaybackRelayResponder } from './playback-relay-response';
import { siteOrigin } from './site-origin';

export const playbackRelayResponse = createPlaybackRelayResponder(
  async (id) =>
    (await playableManifest(id))
      ? {
          // Explicit operator configuration only; discovery/manifest hints cannot grant LAN access.
          localRelays: (process.env.SPACE_RUNTIME_LOCAL_RELAYS ?? '').split(',').filter(Boolean),
        }
      : null,
  siteOrigin,
);
