import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import type { RecoveryJob } from './key-recovery.worker';

function recoveryJob<T>(job: RecoveryJob, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./key-recovery.worker.ts', import.meta.url), {
      type: 'module',
    });
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      if (error) reject(error);
      else resolve(value!);
    };
    const cancel = () => finish(new Error('Key recovery cancelled.'));
    const timer = setTimeout(
      () => finish(new Error('Key recovery timed out. Please retry.')),
      30000,
    );
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event) =>
      finish(event.data.error ? new Error(event.data.error) : undefined, event.data.value);
    worker.onerror = (event) => {
      event.preventDefault();
      finish(new Error('Key recovery is unavailable in this browser.'));
    };
    if (signal?.aborted) cancel();
    else worker.postMessage(job);
    if (job.action === 'encrypt') job.key.fill(0);
    else job.input = '';
    job.password = '';
  });
}
export const encryptRecovery = (key: Uint8Array, password: string, signal?: AbortSignal) =>
  recoveryJob<string>({ action: 'encrypt', key: key.slice(), password }, signal);
export const decryptRecovery = (input: string, password: string, signal?: AbortSignal) =>
  recoveryJob<Uint8Array>({ action: 'decrypt', input, password }, signal);

/** An unpublished draft lives only until it is used or its dialog is closed. */
export function createKeyDraft() {
  const key = generateSecretKey();
  const pubkey = getPublicKey(key);
  let disposed = false;
  const check = () => {
    if (disposed) throw new Error('Create a new identity to continue.');
  };
  return {
    pubkey,
    backup(password: string, signal?: AbortSignal) {
      check();
      return encryptRecovery(key, password, signal);
    },
    async connect(importKey: (input: string) => Promise<void>) {
      check();
      await importKey(nip19.nsecEncode(key));
    },
    dispose() {
      key.fill(0);
      disposed = true;
    },
  };
}
