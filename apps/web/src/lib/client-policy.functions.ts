import { profileRelays } from '../../../../packages/backend/src/profiles';
import { createServerFn } from '@tanstack/react-start';
import { catalogStatus } from '../../../../packages/backend/src/public-catalog';
import { readPolicy } from '../../../../packages/moderation/src/policy';
/** Site-owned curation and operator defaults, never a Nostr event/asset proxy. */
export const getClientPolicy = createServerFn({ method: 'GET' }).handler(async () => {
  const policy = readPolicy();
  return {
    relays: await profileRelays(),
    blossom: [
      process.env.SPACE_INDEX_LOCAL_BLOSSOM ||
        process.env.SPACE_BLOSSOM_ORIGIN ||
        'https://blossom.napplet.soy',
    ],
    rules: policy.rules.map(({ type, target }) => ({ type, target })),
    featured: policy.featured.map(({ type, target }) => ({ type, target })),
  };
});
