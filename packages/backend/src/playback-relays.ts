import { playableManifest } from './catalog';
import { createPlaybackRelayResponder } from './playback-relay-response';
import { siteOrigin } from './site-origin';

export const playbackRelayResponse = createPlaybackRelayResponder(
  async (id) => ((await playableManifest(id)) ? {} : null),
  siteOrigin,
);
