import { BaseAccount, type SerializedAccount } from 'applesauce-accounts';
import { z } from 'zod';
import {
  MAX_SIGNER_RELAYS,
  type CreatorSigner,
  type RemoteCredential,
} from '../../../../packages/identity/src/signer';
const hex = z.string().regex(/^[a-f0-9]{64}$/);
export const sessionMaterial = z.discriminatedUnion('method', [
  z.object({ method: z.literal('extension') }).strict(),
  z.object({ method: z.literal('key'), key: hex }).strict(),
  z
    .object({
      method: z.literal('remote'),
      credential: z
        .object({
          type: z.literal('remote'),
          clientKey: hex,
          remote: hex,
          relays: z.array(z.string().max(400)).min(1).max(MAX_SIGNER_RELAYS),
        })
        .strict(),
    })
    .strict(),
]);
export type SessionMaterial = z.infer<typeof sessionMaterial>;
export type SessionMetadata = { remember: boolean; expires: number };
const serialized = z
  .object({
    type: z.literal('napplet-session'),
    id: z.string().regex(/^[a-zA-Z0-9_-]{8,64}$/),
    pubkey: hex,
    signer: sessionMaterial,
    metadata: z.object({ remember: z.boolean(), expires: z.number().int().positive() }).strict(),
  })
  .strict();
export const disconnectedSigner: CreatorSigner = {
  getPublicKey: async () => {
    throw Error('Connect this saved account first.');
  },
  signEvent: async () => {
    throw Error('Connect this saved account first.');
  },
  close: async () => {},
};
/** AccountManager owns selection, serialization and the per-account signing queue.
 * Our signer adapter keeps the existing exact-event and permission checks. */
export class SessionAccount extends BaseAccount<CreatorSigner, SessionMaterial, SessionMetadata> {
  static type = 'napplet-session';
  material: SessionMaterial = { method: 'extension' };
  toJSON(): SerializedAccount<SessionMaterial, SessionMetadata> {
    return this.saveCommonFields({ signer: this.material });
  }
  static fromJSON(input: SerializedAccount<SessionMaterial, SessionMetadata>) {
    const value = serialized.parse(input);
    const account = new SessionAccount(value.pubkey, disconnectedSigner);
    account.material = value.signer;
    return this.loadCommonFields(account, value);
  }
  get method() {
    return this.material.method;
  }
  get credential(): RemoteCredential | undefined {
    return this.material.method === 'remote' ? this.material.credential : undefined;
  }
}
