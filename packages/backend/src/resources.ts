import { playableManifest } from './catalog';
import { createResourceResponder } from './resource-response';

export { resourceMime, resolveResource } from './resource-response';
export const resourceResponse = createResourceResponder(playableManifest);
