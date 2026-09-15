/** Device-local encryption. The non-exportable key stays in IndexedDB, never on our server.
 * This protects plaintext at rest, not against code executing in this site's origin. */
export type SessionSnapshot = { accounts: unknown[]; active: string | null };
export type StoredSessions = SessionSnapshot & { revision: number };
export interface SessionVault {
  load(): Promise<StoredSessions>;
  save(value: SessionSnapshot, revision: number): Promise<number>;
  subscribe?(changed: (revision: number) => void): () => void;
}
const DATABASE = 'napplet-sessions-v1';
const EMPTY = { accounts: [], active: null, revision: 0 };
function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function complete(transaction: IDBTransaction) {
  const done = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? Error('Session storage changed.'));
  });
  // A request can fail before its caller reaches the transaction await.
  void done.catch(() => {});
  return done;
}
export class BrowserSessionVault implements SessionVault {
  private connection?: Promise<IDBDatabase>;
  private channel?: BroadcastChannel;
  private database() {
    return (this.connection ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('vault');
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error('Close older tabs to enable remembered sessions.'));
    }));
  }
  private context() {
    return new TextEncoder().encode(`${DATABASE}:${location.origin}`);
  }
  async load(): Promise<StoredSessions> {
    const db = await this.database();
    const tx = db.transaction('vault', 'readonly'),
      done = complete(tx),
      store = tx.objectStore('vault');
    const [envelope, key] = await Promise.all([
      result(store.get('sessions')),
      result(store.get('key')),
    ]);
    await done;
    if (!envelope) return EMPTY;
    if (
      !key ||
      key.extractable ||
      key.algorithm?.name !== 'AES-GCM' ||
      !Number.isSafeInteger(envelope.revision) ||
      envelope.revision < 1 ||
      !(envelope.iv instanceof Uint8Array) ||
      envelope.iv.length !== 12 ||
      !(envelope.ciphertext instanceof ArrayBuffer) ||
      envelope.ciphertext.byteLength > 65536
    )
      throw Error('Saved session data is unavailable.');
    const bytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: envelope.iv, additionalData: this.context() },
      key,
      envelope.ciphertext,
    );
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (
      !Array.isArray(value.accounts) ||
      value.accounts.length > 8 ||
      (value.active !== null && typeof value.active !== 'string')
    )
      throw Error('Invalid saved sessions.');
    return { accounts: value.accounts, active: value.active, revision: envelope.revision };
  }
  async save(value: SessionSnapshot, revision: number) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    if (bytes.length > 60000) throw Error('Session storage limit reached.');
    const db = await this.database();
    // Generating outside the transaction avoids an IndexedDB auto-commit during crypto work.
    const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const init = db.transaction('vault', 'readwrite'),
      initialized = complete(init),
      keys = init.objectStore('vault');
    let key = await result(keys.get('key'));
    if (!key) {
      key = candidate;
      keys.put(key, 'key');
    }
    await initialized;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: this.context() },
      key,
      bytes,
    );
    const tx = db.transaction('vault', 'readwrite'),
      done = complete(tx),
      store = tx.objectStore('vault');
    const current = await result(store.get('sessions'));
    if ((current?.revision ?? 0) !== revision) {
      tx.abort();
      await done.catch(() => {});
      throw Error('Sessions changed in another tab. Reopen your account to refresh.');
    }
    store.put({ revision: revision + 1, iv, ciphertext }, 'sessions');
    await done;
    this.channel?.postMessage(revision + 1);
    return revision + 1;
  }
  subscribe(changed: (revision: number) => void) {
    if (typeof BroadcastChannel === 'undefined') return () => {};
    this.channel ??= new BroadcastChannel(DATABASE);
    const listener = (event: MessageEvent) => {
      if (Number.isSafeInteger(event.data)) changed(event.data);
    };
    this.channel.addEventListener('message', listener);
    return () => this.channel?.removeEventListener('message', listener);
  }
}
