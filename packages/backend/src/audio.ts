import { playableManifest } from './catalog';
import { createAudioResponder } from './audio-response';
import { siteOrigin } from './site-origin';

// Caddy terminates TLS; the backend request URL describes its internal HTTP hop.
export const audioResponse = createAudioResponder(
  playableManifest,
  undefined,
  undefined,
  siteOrigin,
);
