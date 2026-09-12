/** Implemented NAP surfaces. Individual operations remain subject to host policy. */
export const RUNTIME_DOMAINS = [
  'shell',
  'identity',
  'storage',
  'theme',
  'resource',
  'relay',
  'outbox',
  'common',
  'link',
  'fs',
] as const;
export const RUNTIME_PROFILE = 'space-playback-1';
export const missingDomains = (required: readonly string[]) =>
  required.filter((domain) => !(RUNTIME_DOMAINS as readonly string[]).includes(domain));
