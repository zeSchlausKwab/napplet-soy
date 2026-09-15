import { playableManifest } from './catalog';
import { createResourceResponder } from './resource-response';
import { siteOrigin } from './site-origin';

export { resourceMime, resolveResource } from './resource-response';
// Use operator configuration, never client-supplied forwarded headers.
export const resourceResponse = createResourceResponder(playableManifest, siteOrigin);
