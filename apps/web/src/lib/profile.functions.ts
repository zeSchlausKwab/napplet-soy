import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { profilePage } from '../../../../packages/backend/src/profiles';
import { CommunityError } from '../../../../packages/community/src/store';
export const getProfilePage = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      pubkey: z.string().max(100),
      page: z.number().int().min(1).max(10000),
      all: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    try {
      return await profilePage(data);
    } catch (e) {
      if (e instanceof CommunityError && e.status === 404) return null;
      throw e;
    }
  });
