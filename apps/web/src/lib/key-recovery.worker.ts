import { encryptPrivateKey, readPrivateKey } from '../../../../packages/identity/src/key-material';
export type RecoveryJob =
  | { action: 'encrypt'; key: Uint8Array; password: string }
  | { action: 'decrypt'; input: string; password: string };
self.onmessage = (event: MessageEvent<RecoveryJob>) => {
  const job = event.data;
  try {
    const value =
      job.action === 'encrypt'
        ? encryptPrivateKey(job.key, job.password)
        : readPrivateKey(job.input, job.password);
    if (value instanceof Uint8Array)
      self.postMessage({ value }, { transfer: [value.buffer as ArrayBuffer] });
    else self.postMessage({ value });
  } catch {
    self.postMessage({
      error:
        job.action === 'encrypt'
          ? 'Could not prepare a backup. Please retry.'
          : 'Could not unlock this recovery key. Check the file and passphrase (supported scrypt logN: 10–18).',
    });
  } finally {
    if (job.action === 'encrypt') job.key.fill(0);
    else job.input = '';
    job.password = '';
    self.close();
  }
};
