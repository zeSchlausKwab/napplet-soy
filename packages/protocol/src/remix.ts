import { z } from 'zod';
import { identityAddress, type SignedEvent } from './index';
import { validateManifest } from './manifest';

export const nappletAddressSchema = z
  .string()
  .regex(/^(?:35129:[a-f0-9]{64}:[^\u0000-\u001f\u007f]{0,256}|15129:[a-f0-9]{64}:)$/);
export const remixSchema = z
  .object({
    parent: nappletAddressSchema,
    origin: nappletAddressSchema,
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    sourceCommit: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .optional(),
  })
  .strict();
export async function remixLineage(manifest: SignedEvent) {
  const release = await validateManifest(manifest);
  const parent = release.identity
    ? identityAddress(release.identity)
    : manifest.tags.find((t) => t[0] === 'a')?.[1];
  if (!parent || parent.split(':')[1] !== manifest.pubkey) throw new Error('Invalid remix parent');
  const origins = manifest.tags.filter((t) => t[0] === 'A');
  if (origins.length > 1) throw new Error('Ambiguous remix origin');
  const sourceCommit = manifest.tags.find((t) => t[0] === 'source-commit')?.[1];
  return remixSchema.parse({
    parent,
    origin: origins[0]?.[1] ?? parent,
    revision: manifest.id,
    ...(/^[a-f0-9]{40}$/.test(sourceCommit ?? '') ? { sourceCommit } : {}),
  });
}
