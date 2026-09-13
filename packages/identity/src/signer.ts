import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { NostrConnectSigner } from 'applesauce-signers/signers/nostr-connect-signer';
import { RelayPool } from 'applesauce-relay';
import type { EventTemplate } from 'nostr-tools';
import { verifiedEvent, type SignedEvent } from '../../protocol/src';

export type Network = 'public' | 'local';
export class AccountError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const publishingKinds = [30617, 30618, 24242, 35129, 15129, 5129];
export type RemoteCredential = {
  type: 'remote';
  clientKey: string;
  remote: string;
  relays: string[];
  secret?: string;
};
export type Credential = { type: 'local'; key: string } | RemoteCredential;
export type CreatorSigner = {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<SignedEvent>;
  close(): Promise<void>;
};
export function checkPubkey(pubkey: string, network: Network) {
  if (!/^[a-f0-9]{64}$/.test(pubkey))
    throw new AccountError('INVALID_IDENTITY', 'Invalid creator public key.');
  if (
    network === 'public' &&
    pubkey === '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
  )
    throw new AccountError(
      'FIXTURE_IDENTITY',
      'The bundled fixture identity cannot be used as a public creator.',
    );
  return pubkey;
}
export function bunkerCredential(uri: string, network: Network): RemoteCredential {
  try {
    if (uri.length > 2048) throw new Error();
    const url = new URL(uri);
    if (
      url.protocol !== 'bunker:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !['', '/'].includes(url.pathname)
    )
      throw new Error();
    if (
      [...url.searchParams.keys()].some((key) => !['relay', 'secret'].includes(key)) ||
      url.searchParams.getAll('secret').length > 1
    )
      throw new Error();
    const remote = checkPubkey(url.hostname, 'local');
    const relays = [...new Set(url.searchParams.getAll('relay'))];
    if (!relays.length || relays.length > 3) throw new Error();
    for (const relay of relays) {
      const r = new URL(relay);
      if (
        relay.length > 400 ||
        r.username ||
        r.password ||
        r.hash ||
        (network === 'local'
          ? r.protocol !== 'ws:' || !['127.0.0.1', '[::1]'].includes(r.hostname)
          : r.protocol !== 'wss:')
      )
        throw new Error();
    }
    const secret = url.searchParams.get('secret') ?? undefined;
    if (secret && secret.length > 256) throw new Error();
    const key = new PrivateKeySigner();
    const clientKey = Buffer.from(key.key).toString('hex');
    key.key.fill(0);
    return { type: 'remote', remote, relays, secret, clientKey };
  } catch {
    throw new AccountError(
      'INVALID_BUNKER',
      'Use a bunker connection link with 1–3 WSS relays (literal-loopback WS relays for --network local).',
    );
  }
}

// The pinned SDK does not reject outstanding RPC promises on close. Keep their
// lifetime inside one CLI operation, and suppress its debug logging of RPC params.
class Session extends NostrConnectSigner {
  constructor(options: ConstructorParameters<typeof NostrConnectSigner>[0]) {
    super(options);
    this.log.enabled = false;
  }
  override async close() {
    for (const request of this.requests.values()) {
      request.catch(() => {});
      request.reject(new AccountError('SIGNER_CLOSED', 'Signer session closed.'));
    }
    this.requests.clear();
    this.auths.clear();
    await super.close();
  }
}
export async function openCredential(
  credential: Credential,
  network: Network,
  options: {
    expectedPubkey?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    onAuth?: (url: string) => Promise<void>;
  } = {},
): Promise<CreatorSigner> {
  const keyHex = credential.type === 'local' ? credential.key : credential.clientKey;
  if (!/^[a-f0-9]{64}$/.test(keyHex))
    throw new AccountError('INVALID_CREDENTIAL', 'Stored signer credential is invalid.');
  const local = new PrivateKeySigner(Uint8Array.from(Buffer.from(keyHex, 'hex')));
  let closed = false;
  let remote: Session | undefined;
  let pool: RelayPool | undefined;
  const close = async () => {
    if (closed) return;
    closed = true;
    await remote?.close();
    pool?.close();
    local.key.fill(0);
  };
  const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (closed || options.signal?.aborted)
      throw new AccountError('SIGNER_CLOSED', 'Signer session closed or cancelled.');
    let timer: ReturnType<typeof setTimeout>;
    let abort: () => void;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          abort = () => reject(new AccountError('SIGNER_CANCELLED', 'Signer request cancelled.'));
          options.signal?.addEventListener('abort', abort, { once: true });
          timer = setTimeout(
            () =>
              reject(
                new AccountError(
                  'SIGNER_TIMEOUT',
                  'Remote signer did not respond. Unlock it and retry.',
                ),
              ),
            options.timeoutMs ?? 60000,
          );
        }),
      ]);
    } catch (error) {
      await close();
      if (error instanceof AccountError) throw error;
      // Remote errors and SDK diagnostics may contain connection secrets.
      throw new AccountError(
        'SIGNER_REFUSED',
        'Signer rejected the request or could not connect. Check its permissions and retry.',
      );
    } finally {
      clearTimeout(timer!);
      options.signal?.removeEventListener('abort', abort!);
    }
  };
  try {
    let pubkey: string;
    if (credential.type === 'local') pubkey = await local.getPublicKey();
    else {
      // Revalidate stored endpoints as well as newly pasted links.
      const uri = new URL(`bunker://${credential.remote}`);
      credential.relays.forEach((r) => uri.searchParams.append('relay', r));
      if (credential.secret) uri.searchParams.set('secret', credential.secret);
      bunkerCredential(uri.href, network);
      pool = new RelayPool();
      remote = new Session({
        signer: local,
        remote: credential.remote,
        relays: credential.relays,
        subscriptionMethod: (relays, filters) => pool!.subscription(relays, filters),
        publishMethod: async (relays, event) => {
          if (closed) throw new AccountError('SIGNER_CLOSED', 'Signer session closed.');
          const results = await pool!.publish(relays, event, { timeout: 5000, retries: false });
          if (!results.some((r) => r.ok)) throw new Error('No signing relay accepted the request');
        },
        onAuth: async (url) => {
          if (/[\u0000-\u001f\u007f]/.test(url))
            throw new AccountError('SIGNER_AUTH', 'Signer supplied an invalid authorization URL.');
          const parsed = new URL(url);
          if (
            !options.onAuth ||
            parsed.username ||
            parsed.password ||
            (parsed.protocol !== 'https:' &&
              !(
                network === 'local' &&
                parsed.protocol === 'http:' &&
                ['127.0.0.1', '[::1]'].includes(parsed.hostname)
              ))
          )
            throw new AccountError(
              'SIGNER_AUTH',
              'Remote signer requires authorization in its own application.',
            );
          await options.onAuth(parsed.href);
        },
      });
      const ack = await bounded(() =>
        remote!.connect(credential.secret, [
          'get_public_key',
          ...NostrConnectSigner.buildSigningPermissions(publishingKinds),
        ]),
      );
      if (ack !== 'ack' && ack !== credential.secret)
        throw new AccountError(
          'INVALID_SIGNER',
          'Remote signer returned an invalid connection acknowledgement.',
        );
      // Never confuse the bunker transport identity with the actual user's key.
      pubkey = await bounded(() => remote!.getPublicKey());
    }
    checkPubkey(pubkey, network);
    if (options.expectedPubkey && options.expectedPubkey !== pubkey)
      throw new AccountError(
        'IDENTITY_CHANGED',
        'The signer now represents a different creator. Connect that account explicitly.',
      );
    return {
      getPublicKey: async () => {
        if (closed) throw new AccountError('SIGNER_CLOSED', 'Signer session closed.');
        return pubkey;
      },
      signEvent: async (event) => {
        if (!publishingKinds.includes(event.kind))
          throw new AccountError(
            'SIGNING_SCOPE',
            'This creator signer only signs source, Blossom and napplet publication events.',
          );
        const template = structuredClone({
          kind: event.kind,
          created_at: event.created_at,
          content: event.content,
          tags: event.tags,
        });
        const expected = JSON.stringify(template);
        return bounded(async () => {
          const result = verifiedEvent(await (remote ?? local).signEvent(template));
          if (
            result.pubkey !== pubkey ||
            JSON.stringify({
              kind: result.kind,
              created_at: result.created_at,
              content: result.content,
              tags: result.tags,
            }) !== expected
          )
            throw new AccountError(
              'SIGNER_CHANGED_EVENT',
              'Signer changed the requested publication. Nothing was published.',
            );
          return result;
        });
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
