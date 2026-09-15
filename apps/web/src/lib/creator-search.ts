import type { SearchSchemaInput } from '@tanstack/react-router';
import { z } from 'zod';

export const creatorSearch = (input: SearchSchemaInput & { template?: string }) =>
  z
    .object({
      template: z
        .enum([
          'boilerplate',
          'soft-orbit',
          'tiny-tennis',
          'plasma-garden',
          'blob-friend',
          'very-important',
          'pixel-rain',
        ])
        .catch('boilerplate'),
    })
    .parse(input);
