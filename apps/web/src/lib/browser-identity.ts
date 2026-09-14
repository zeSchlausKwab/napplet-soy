import { ExtensionSigner } from 'applesauce-signers/signers/extension-signer';
import { nip19 } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils.js';
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
};
type Feedback = Pick<SignerOptions, 'onAuth'>;

/** Secrets live in this browser instance only, never in React/SSR state or storage. */
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
    void old?.signer.close();
    this.update(anonymous);
  }
  private async connect(
    method: Method,
    factory: (
      signal: AbortSignal,
    ) => Promise<{ signer: CreatorSigner; credential?: RemoteCredential }>,
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
      void old?.signer.close();
      this.update({ pubkey, method, reconnect: false });
    } catch (error) {
      controller.abort();
      await opened?.signer.close();
      if (this.pending === controller) this.pending = undefined;
      if (error instanceof AccountError) throw error;
      throw new Error(
        controller.signal.aborted
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
              if ((await extension.getPublicKey()) !== pubkey)
                throw new Error('Your extension account changed. Connect again.');
              return extension.signEvent(template);
            }),
          close: async () => {},
        },
      };
    });
  }
  importKey(input: string) {
    return this.connect('key', async (signal) => {
      let key = input.trim();
      input = '';
      try {
        if (key.startsWith('nsec1')) {
          const decoded = nip19.decode(key);
          if (decoded.type !== 'nsec') throw new Error();
          key = bytesToHex(decoded.data);
          decoded.data.fill(0);
        }
        if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new Error();
        return {
          signer: await openCredential({ type: 'local', key: key.toLowerCase() }, this.network, {
            signal,
            kinds: websiteKinds,
          }),
        };
      } catch {
        throw new AccountError(
          'INVALID_KEY',
          'Enter an nsec or 64-character hexadecimal private key.',
        );
      } finally {
        key = '';
      }
    });
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
