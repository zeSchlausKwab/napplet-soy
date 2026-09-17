import { z } from 'zod';

export const boardRef = z.object({
  napplet: z.string().max(4096),
  board: z.string().regex(/^[a-z0-9-]{1,48}$/),
});
export const boardDefinition = boardRef
  .extend({
    title: z.string().min(1).max(100),
    order: z.enum(['highest', 'lowest']),
    minimum: z.number().finite().min(-1e12).max(1e12),
    maximum: z.number().finite().min(-1e12).max(1e12),
  })
  .strict();
export const boardRegister = z
  .object({ definition: boardDefinition, authorization: z.unknown() })
  .strict();
export const boardSubmit = boardRef
  .extend({ score: z.number().finite(), name: z.string().max(40).default('Player') })
  .strict();
export const boardRead = boardRef
  .extend({ limit: z.number().int().min(1).max(100).default(20) })
  .strict();
export type BoardDefinition = z.infer<typeof boardDefinition>;

/** Signed, unpublished application proof. It is not a relay event or a NIP-98 HTTP request. */
export function boardAuthorization(
  provider: string,
  actor: string,
  definition: BoardDefinition,
  now = Date.now(),
) {
  return {
    kind: 1,
    created_at: Math.floor(now / 1000),
    tags: [
      ['t', 'soy-board-registration-v1'],
      ['p', provider],
    ],
    content: JSON.stringify({ actor, definition: boardDefinition.parse(definition) }),
  };
}

export const backendConfig = z
  .object({
    provider: z
      .object({
        pubkey: z.string().regex(/^[a-f0-9]{64}$/),
        relays: z.array(z.string().max(256)).min(1).max(8),
      })
      .strict()
      .optional(),
    boards: z
      .array(boardDefinition.omit({ napplet: true }))
      .max(16)
      .default([]),
  })
  .strict();
