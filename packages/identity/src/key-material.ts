import { bech32 } from '@scure/base';
import { hexToBytes } from '@noble/hashes/utils.js';
import { getPublicKey, nip19 } from 'nostr-tools';
import { decrypt, encrypt } from 'nostr-tools/nip49';

export function readPrivateKey(input: string, password = ''): Uint8Array {
  let key: Uint8Array | undefined;
  try {
    const value = input.trim();
    if (value.length > 300 || password.length > 1024) throw new Error();
    if (value.startsWith('ncryptsec1')) {
      const decoded = bech32.decode(value as `ncryptsec1${string}`, 300);
      const bytes = bech32.fromWords(decoded.words);
      // Bound untrusted scrypt parameters before the library allocates memory.
      if (
        bytes.length !== 91 ||
        bytes[0] !== 2 ||
        bytes[1] < 10 ||
        bytes[1] > 18 ||
        bytes[42] > 2 ||
        !password
      )
        throw new Error();
      key = decrypt(value, password);
    } else if (value.startsWith('nsec1')) {
      const decoded = nip19.decode(value);
      if (decoded.type !== 'nsec') throw new Error();
      key = decoded.data;
    } else {
      if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error();
      key = hexToBytes(value);
    }
    getPublicKey(key);
    return key;
  } catch {
    key?.fill(0);
    throw new Error(
      'Use a valid nsec, hexadecimal key, or encrypted recovery key with its passphrase (scrypt logN 10–18).',
    );
  }
}
export function encryptPrivateKey(key: Uint8Array, password: string): string {
  if (password.length < 12 || password.length > 1024)
    throw new Error('Use a recovery passphrase of 12–1024 characters.');
  getPublicKey(key);
  // The key has been handled by a web application: NIP-49 security byte 0.
  return encrypt(key, password, 16, 0);
}
