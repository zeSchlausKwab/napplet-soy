import { expect, test } from 'bun:test';
import { bech32 } from '@scure/base';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { decrypt } from 'nostr-tools/nip49';
import { encryptPrivateKey, readPrivateKey } from './key-material';

test('browser recovery preserves the identity in interoperable NIP-49 files and rejects incorrect passwords', () => {
  const key = generateSecretKey();
  const backup = encryptPrivateKey(key, 'a recovery test passphrase');
  const bytes = bech32.fromWords(bech32.decode(backup as `ncryptsec1${string}`, 300).words);
  expect(bytes[0]).toBe(2);
  expect(bytes[1]).toBe(16);
  expect(bytes[42]).toBe(0);
  expect(getPublicKey(decrypt(backup, 'a recovery test passphrase'))).toBe(getPublicKey(key));
  expect(readPrivateKey(backup, 'a recovery test passphrase')).toEqual(key);
  expect(readPrivateKey(nip19.nsecEncode(key))).toEqual(key);
  expect(readPrivateKey(Buffer.from(key).toString('hex'))).toEqual(key);
  expect(() => readPrivateKey(backup, 'incorrect passphrase')).toThrow('valid');
  expect(() => encryptPrivateKey(key, 'short')).toThrow('12–1024');
  key.fill(0);
});
test('untrusted recovery metadata cannot request unbounded scrypt work or invalid key material', () => {
  for (const [version, cost, security, length] of [
    [2, 30, 0, 91],
    [2, 9, 0, 91],
    [1, 16, 0, 91],
    [2, 16, 3, 91],
    [2, 16, 0, 90],
  ]) {
    const bytes = new Uint8Array(length);
    bytes[0] = version;
    bytes[1] = cost;
    bytes[42] = security;
    const value = bech32.encode('ncryptsec', bech32.toWords(bytes), 300);
    expect(() => readPrivateKey(value, 'irrelevant password')).toThrow('valid');
  }
  for (const value of ['0'.repeat(64), 'f'.repeat(64), 'nsec1invalid', 'x'.repeat(301)])
    expect(() => readPrivateKey(value)).toThrow('valid');
});
