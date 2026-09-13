import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPublicKey, generateSecretKey, nip19 } from 'nostr-tools';
import { Accounts, type Vault } from './accounts';
import { AccountError } from './signer';

const root = await mkdtemp(join(tmpdir(), 'napplet-identity-'));
afterAll(() => rm(root, { recursive: true, force: true }));
export class MemoryVault implements Vault {
  values = new Map<string, string>();
  async get(id: string) {
    return this.values.get(id) ?? null;
  }
  async set(id: string, value: string) {
    this.values.set(id, value);
  }
  async delete(id: string) {
    this.values.delete(id);
  }
}
function fixture(name: string) {
  const vault = new MemoryVault();
  return { vault, accounts: new Accounts('public', join(root, name), vault) };
}
test('creator persists outside projects; reopened instances and every publication kind share its identity', async () => {
  const { accounts, vault } = fixture('reuse');
  const account = await accounts.create();
  expect(await accounts.create()).toEqual(account);
  const reopened = new Accounts('public', accounts.directory, vault);
  expect(await reopened.current()).toEqual(account);
  const signer = await reopened.signer();
  try {
    for (const kind of [30617, 30618, 24242, 35129, 15129, 5129])
      expect((await signer.signEvent({ kind, content: '', tags: [], created_at: 1 })).pubkey).toBe(
        account.pubkey,
      );
    await expect(
      signer.signEvent({ kind: 1, content: 'unrelated post', tags: [], created_at: 1 }),
    ).rejects.toMatchObject({ code: 'SIGNING_SCOPE' });
  } finally {
    await signer.close();
  }
  await expect(signer.getPublicKey()).rejects.toMatchObject({ code: 'SIGNER_CLOSED' });
  const metadata = await readFile(join(accounts.directory, 'accounts.json'), 'utf8');
  const secret = JSON.parse(vault.values.get(account.id)!).key;
  expect(metadata).not.toContain(secret);
  expect((await stat(accounts.directory)).mode & 0o777).toBe(0o700);
  expect((await stat(join(accounts.directory, 'accounts.json'))).mode & 0o777).toBe(0o600);
});
test('a crash after credential storage recovers the same reserved key; missing credentials never rotate identity', async () => {
  const { accounts, vault } = fixture('recovery');
  const set = vault.set.bind(vault);
  vault.set = async (id, value) => {
    await set(id, value);
    throw new AccountError('INTERRUPTED', 'Simulated interruption');
  };
  await expect(accounts.create()).rejects.toMatchObject({ code: 'INTERRUPTED' });
  expect(await accounts.current()).toBeNull();
  const pending = (await accounts.list())[0];
  vault.set = set;
  const restored = await accounts.create();
  expect(restored.pubkey).toBe(pending.pubkey);
  expect(restored.id).toBe(pending.id);
  expect(vault.values.size).toBe(1);
  await vault.delete(restored.id);
  await expect(accounts.signer()).rejects.toMatchObject({ code: 'CREDENTIAL_MISSING' });
  expect((await accounts.create()).pubkey).toBe(restored.pubkey);
});
test('unavailable keystore saves no plaintext key and does not replace an existing identity', async () => {
  const { accounts, vault } = fixture('unavailable');
  const original = await accounts.create();
  vault.set = async () => {
    throw new AccountError('KEYSTORE_UNAVAILABLE', 'Unavailable');
  };
  const secret = nip19.nsecEncode(generateSecretKey());
  await expect(accounts.import(secret)).rejects.toMatchObject({ code: 'KEYSTORE_UNAVAILABLE' });
  expect((await accounts.current())!.id).toBe(original.id);
  expect(await readFile(join(accounts.directory, 'accounts.json'), 'utf8')).not.toContain(secret);
});
test('recovery uses encrypted NIP-49, enforces passphrases and refuses overwrite, tampering and project paths', async () => {
  const { accounts } = fixture('export');
  const original = await accounts.create();
  const path = join(root, 'recovery.ncryptsec');
  const password = 'a sufficiently long recovery passphrase';
  await accounts.export(path, password);
  const secret = (await readFile(path, 'utf8')).trim();
  expect(secret.startsWith('ncryptsec1')).toBe(true);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  const recovery = fixture('import').accounts;
  await expect(recovery.import(secret, 'incorrect password')).rejects.toMatchObject({
    code: 'INVALID_RECOVERY',
  });
  expect((await recovery.import(secret, password)).pubkey).toBe(original.pubkey);
  await expect(accounts.export(path, password)).rejects.toMatchObject({
    code: 'RECOVERY_DESTINATION',
  });
  await expect(accounts.export(join(root, 'weak'), 'short')).rejects.toMatchObject({
    code: 'RECOVERY_PASSWORD',
  });
  const project = join(root, 'project');
  await mkdir(join(project, '.git'), { recursive: true });
  const alias = join(root, 'alias');
  await symlink(project, alias);
  await expect(accounts.export(join(alias, 'backup'), password)).rejects.toMatchObject({
    code: 'ACCOUNT_PATH',
  });
  await expect(
    new Accounts('public', join(project, 'config'), new MemoryVault()).create(),
  ).rejects.toMatchObject({ code: 'ACCOUNT_PATH' });
});
test('public and local profiles cannot share metadata, use the fixture key publicly or substitute a stored key', async () => {
  const { accounts, vault } = fixture('isolation');
  const original = await accounts.create();
  await expect(new Accounts('local', accounts.directory, vault).current()).rejects.toMatchObject({
    code: 'ACCOUNT_CONFIG',
  });
  const fixtureKey = new Uint8Array(32);
  fixtureKey[31] = 1;
  await expect(accounts.import(nip19.nsecEncode(fixtureKey))).rejects.toMatchObject({
    code: 'FIXTURE_IDENTITY',
  });
  const changed = generateSecretKey();
  await vault.set(
    original.id,
    JSON.stringify({ type: 'local', key: Buffer.from(changed).toString('hex') }),
  );
  await expect(accounts.signer()).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' });
  expect(getPublicKey(changed)).not.toBe(original.pubkey);
});
test('concurrent setup cannot create a second active key and corrupted metadata is not overwritten', async () => {
  const { accounts, vault } = fixture('concurrent');
  const set = vault.set.bind(vault);
  let proceed!: () => void;
  const wait = new Promise<void>((r) => {
    proceed = r;
  });
  let reserved!: () => void;
  const storing = new Promise<void>((r) => {
    reserved = r;
  });
  vault.set = async (id, value) => {
    reserved();
    await wait;
    await set(id, value);
  };
  const first = accounts.create();
  await storing;
  await expect(new Accounts('public', accounts.directory, vault).create()).rejects.toMatchObject({
    code: 'ACCOUNT_BUSY',
  });
  proceed();
  await first;
  expect(vault.values.size).toBe(1);
  await writeFile(join(accounts.directory, 'accounts.json'), 'damaged metadata');
  await expect(accounts.create()).rejects.toMatchObject({ code: 'ACCOUNT_CONFIG' });
  expect(await readFile(join(accounts.directory, 'accounts.json'), 'utf8')).toBe(
    'damaged metadata',
  );
});
