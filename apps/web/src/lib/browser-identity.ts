import { ExtensionSigner } from 'applesauce-signers/signers/extension-signer';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readPrivateKey } from '../../../../packages/identity/src/key-material';
import { decryptRecovery, encryptRecovery } from './key-recovery';
import {
  AccountError,
  bunkerCredential,
  checkPubkey,
  openCredential,
  pairCredential,
  websiteKinds,
  type CreatorSigner,
  type Network,
  type RemoteCredential,
  type SignerOptions,
} from '../../../../packages/identity/src/signer';
import { verifiedEvent, type SignedEvent } from '../../../../packages/protocol/src';

type Template = Pick<SignedEvent, 'kind' | 'created_at' | 'tags' | 'content'>;
type Method = 'extension' | 'remote' | 'key';
export type IdentityState = {
  pubkey: string | null;
  method: Method | null;
  reconnect: boolean;
  authorization?: string;
};
const anonymous: IdentityState = { pubkey: null, method: null, reconnect: false };
type Active = {
  signer: CreatorSigner;
  pubkey: string;
  method: Method;
  controller: AbortController;
  credential?: RemoteCredential;
  backupKey?: Uint8Array;
};
type Feedback = Pick<SignerOptions, 'onAuth'>;

/** Signing credentials stay in this browser instance, outside public state and storage. */
export class BrowserIdentity {
  private active?: Active;
  private recovery?: { credential: RemoteCredential; pubkey: string };
  private pending?: AbortController;
  private listeners = new Set<() => void>();
  state = anonymous;
  constructor(private network: Network = 'public') {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(state: IdentityState) {
    this.state = state;
    this.listeners.forEach((fn) => fn());
  }
  private feedback(feedback: Feedback, signal: AbortSignal): Feedback {
    return {
      onAuth: async (url) => {
        if (signal.aborted) throw new AccountError('SIGNER_CANCELLED', 'Signer session cancelled.');
        this.update({ ...this.state, authorization: url });
        await feedback.onAuth?.(url);
      },
    };
  }
  cancel() {
    this.pending?.abort();
    this.pending = undefined;
    this.update({ ...this.state, authorization: undefined });
  }
  disconnect() {
    this.cancel();
    const old = this.active;
    this.active = undefined;
    this.recovery = undefined;
    old?.controller.abort();
    old?.backupKey?.fill(0);
    void old?.signer.close();
    this.update(anonymous);
  }
  private async connect(
    method: Method,
    factory: (
      signal: AbortSignal,
    ) => Promise<{ signer: CreatorSigner; credential?: RemoteCredential; backupKey?: Uint8Array }>,
  ) {
    this.cancel();
    const controller = new AbortController();
    this.pending = controller;
    let opened: Awaited<ReturnType<typeof factory>> | undefined;
    try {
      opened = await factory(controller.signal);
      const pubkey = checkPubkey(await opened.signer.getPublicKey(), 'local');
      if (this.pending !== controller || controller.signal.aborted)
        throw new Error('Connection cancelled.');
      const old = this.active;
      this.active = { ...opened, pubkey, method, controller };
      this.pending = undefined;
      this.recovery = undefined;
      old?.controller.abort();
      old?.backupKey?.fill(0);
      void old?.signer.close();
      this.update({ pubkey, method, reconnect: false });
    } catch (error) {
      const cancelled = controller.signal.aborted;
      controller.abort();
      await opened?.signer.close();
      opened?.backupKey?.fill(0);
      if (this.pending === controller) this.pending = undefined;
      if (error instanceof AccountError) throw error;
      if (method === 'extension' && !cancelled)
        throw new Error(
          'Install or unlock a Nostr extension, approve access, and try again. You can also choose a remote signer.',
        );
      throw new Error(
        cancelled
          ? 'Connection cancelled or unavailable. Please retry.'
          : 'Could not connect. Please retry.',
      );
    }
  }
  extension() {
    return this.connect('extension', async (signal) => {
      const extension = new ExtensionSigner();
      const bounded = async <T>(fn: () => Promise<T>) => {
        if (signal.aborted) throw new Error('Disconnected.');
        let timer: ReturnType<typeof setTimeout> | undefined;
        let abort = () => {};
        try {
          return await Promise.race([
            fn(),
            new Promise<never>((_, reject) => {
              abort = () => reject(new Error('Connection cancelled.'));
              signal.addEventListener('abort', abort, { once: true });
              timer = setTimeout(
                () => reject(new Error('Unlock your browser extension and retry.')),
                60000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
        }
      };
      const pubkey = await bounded(() => extension.getPublicKey());
      return {
        signer: {
          getPublicKey: async () => pubkey,
          signEvent: (template) =>
            bounded(async () => {
              if ((await new ExtensionSigner().getPublicKey()) !== pubkey)
                throw new Error('Your extension account changed. Connect again.');
              return extension.signEvent(template);
            }),
          close: async () => {},
        },
      };
    });
  }
  importKey(input: string, password = '') {
    return this.connect('key', async (signal) => {
      let key: Uint8Array | undefined;
      try {
        key = input.trim().startsWith('ncryptsec1')
          ? await decryptRecovery(input, password, signal)
          : readPrivateKey(input);
        return {
          signer: await openCredential({ type: 'local', key: bytesToHex(key) }, this.network, {
            signal,
            kinds: websiteKinds,
          }),
          backupKey: key,
        };
      } catch {
        key?.fill(0);
        throw new AccountError(
          'INVALID_KEY',
          'Use a valid nsec, hexadecimal key, or encrypted recovery key with its passphrase (scrypt logN 10–18).',
        );
      } finally {
        input = '';
        password = '';
      }
    });
  }
  async backup(pubkey: string, password: string, signal?: AbortSignal) {
    const active = this.active;
    if (!active?.backupKey || active.pubkey !== pubkey)
      throw new Error('Only the private key held by this browser session can be backed up here.');
    const value = await encryptRecovery(active.backupKey, password, signal);
    if (this.active !== active || active.controller.signal.aborted || signal?.aborted)
      throw new Error('The account changed. Open backup again for the selected account.');
    return value;
  }
  bunker(uri: string, feedback: Feedback = {}) {
    return this.connect('remote', async (signal) => {
      const credential = bunkerCredential(uri.trim(), this.network);
      uri = '';
      const signer = await openCredential(credential, this.network, {
        signal,
        kinds: websiteKinds,
        ...this.feedback(feedback, signal),
      });
      delete credential.secret;
      return { signer, credential };
    });
  }
  pair(relays: string[], onPairing: (uri: string) => void, feedback: Feedback = {}) {
    return this.connect('remote', (signal) =>
      pairCredential(relays, this.network, {
        signal,
        kinds: websiteKinds,
        timeoutMs: 120000,
        onPairing,
        ...this.feedback(feedback, signal),
      }),
    );
  }
  reconnect(feedback: Feedback = {}) {
    const saved = this.recovery;
    if (!saved) return Promise.reject(new Error('Choose a sign-in method.'));
    return this.connect('remote', async (signal) => ({
      credential: saved.credential,
      signer: await openCredential(saved.credential, this.network, {
        signal,
        expectedPubkey: saved.pubkey,
        kinds: websiteKinds,
        ...this.feedback(feedback, signal),
      }),
    }));
  }
  async sign(pubkey: string, event: Template) {
    const active = this.active;
    if (!active || active.pubkey !== pubkey) throw new Error('Connect the correct account first.');
    if (!websiteKinds.includes(event.kind))
      throw new Error('This event kind is outside this session’s permissions.');
    const template = structuredClone({
      kind: event.kind,
      created_at: event.created_at,
      tags: event.tags,
      content: event.content,
    });
    const expected = JSON.stringify(template);
    try {
      const result = verifiedEvent(await active.signer.signEvent(template));
      if (this.active !== active || active.controller.signal.aborted)
        throw new Error('The account disconnected. Please retry.');
      if (
        result.pubkey !== pubkey ||
        JSON.stringify({
          kind: result.kind,
          created_at: result.created_at,
          tags: result.tags,
          content: result.content,
        }) !== expected
      )
        throw new Error('The signer changed the requested event.');
      if (this.state.authorization) this.update({ ...this.state, authorization: undefined });
      return result;
    } catch {
      if (this.active === active) {
        this.active = undefined;
        active.controller.abort();
        active.backupKey?.fill(0);
        await active.signer.close();
        this.recovery = active.credential ? { credential: active.credential, pubkey } : undefined;
        this.update({ pubkey: null, method: null, reconnect: !!this.recovery });
      }
      throw new Error('Signing did not complete. Reconnect your signer and retry.');
    }
  }
}
let browser: BrowserIdentity | undefined;
export function browserIdentity() {
  if (typeof window === 'undefined') throw new Error('Sign-in is only available in the browser.');
  return (browser ??= new BrowserIdentity());
}
