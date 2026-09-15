import { playableManifest } from './catalog';
import { createAudioResponder } from './audio-response';
export const audioResponse = createAudioResponder(playableManifest);
