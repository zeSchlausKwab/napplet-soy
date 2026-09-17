import { profileRelays } from '../../../../packages/backend/src/profiles';
import { createServerFn } from '@tanstack/react-start';
import { readPolicy } from '../../../../packages/moderation/src/policy';
import { browserRelayDefaults } from '../../../../packages/backend/src/client-network';
/** Site-owned curation and operator defaults, never a Nostr event/asset proxy. */
export const getClientPolicy = createServerFn({ method: 'GET' }).handler(async () => {
  const policy = readPolicy();
  const relays = await profileRelays();
  return {
    ...(process.env.SPACE_CVM_PUBKEY
      ? {
          backend: {
            pubkey: process.env.SPACE_CVM_PUBKEY,
            relays: (process.env.SPACE_CVM_PUBLIC_RELAYS || process.env.SPACE_CVM_RELAYS || '')
              .split(',')
              .filter(Boolean),
          },
        }
      : {}),
    relays: browserRelayDefaults(relays, process.env.SPACE_INDEX_HINTS),
    blossom: [
      process.env.SPACE_INDEX_LOCAL_BLOSSOM ||
        process.env.SPACE_BLOSSOM_ORIGIN ||
        'https://blossom.napplet.soy',
    ],
    rules: policy.rules.map(({ type, target }) => ({ type, target })),
    featured: policy.featured.map(({ type, target }) => ({ type, target })),
  };
});
