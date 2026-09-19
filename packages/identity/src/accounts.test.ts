import { afterAll, expect, test } from 'bun:test';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPublicKey, generateSecretKey, nip19 } from 'nostr-tools';
import { Accounts, PlaintextVault, type Vault } from './accounts';
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
test('explicit plaintext vault persists signers and rejects unsafe permissions, symlinks and Git trees', async () => {
  const directory = join(root, 'plaintext');
  const vault = new PlaintextVault(join(directory, 'credentials'));
  const accounts = new Accounts('public', directory, vault);
  const account = await accounts.create();
  const reopened = new Accounts('public', directory, new PlaintextVault(vault.directory));
  const signer = await reopened.signer();
  try {
    expect(
      (await signer.signEvent({ kind: 35129, tags: [], content: '', created_at: 1 })).pubkey,
    ).toBe(account.pubkey);
  } finally {
    await signer.close();
  }
  const file = join(vault.directory, `${account.id}.json`);
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect((await stat(vault.directory)).mode & 0o777).toBe(0o700);
  await chmod(file, 0o644);
  await expect(vault.get(account.id)).rejects.toMatchObject({ code: 'KEYSTORE_FILE' });
  await expect(vault.set(account.id, 'replacement')).rejects.toMatchObject({
    code: 'KEYSTORE_FILE',
  });
  await chmod(file, 0o600);
  await rm(file);
  await symlink(join(directory, `${account.pubkey}.nsec`), file);
  await expect(vault.get(account.id)).rejects.toMatchObject({ code: 'KEYSTORE_FILE' });
  await mkdir(join(directory, '.git'));
  await expect(vault.get(account.id)).rejects.toMatchObject({ code: 'ACCOUNT_PATH' });
});
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
test('creation saves a private portable backup that restores the same identity after losing the vault', async () => {
  const { accounts, vault } = fixture('portable-backup');
  const original = await accounts.create();
  const path = join(accounts.directory, `${original.pubkey}.nsec`);
  const secret = (await readFile(path, 'utf8')).trim();
  expect(secret.startsWith('nsec1')).toBe(true);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  const before = await stat(path);
  await vault.delete(original.id);
  expect(await accounts.backup()).toBe(path);
  expect(await accounts.create()).toEqual(original);
  expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
  expect((await fixture('restored-backup').accounts.import(secret)).pubkey).toBe(original.pubkey);
  await chmod(path, 0o644);
  await accounts.backup();
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  await rm(path);
  await expect(accounts.backup()).rejects.toMatchObject({ code: 'CREDENTIAL_MISSING' });
  expect(await Bun.file(path).exists()).toBe(false);
  expect(await accounts.current()).toEqual(original);
});
test('explicit fresh creation selects a different signer and preserves the previous key and backup', async () => {
  const { accounts, vault } = fixture('fresh-creator');
  const original = await accounts.create();
  const originalPath = await accounts.backup();
  const originalBackup = await readFile(originalPath, 'utf8');
  const originalCredential = vault.values.get(original.id);
  const created = await accounts.create({ fresh: true });
  expect(created.pubkey).not.toBe(original.pubkey);
  expect(await accounts.current()).toEqual(created);
  expect(await accounts.create()).toEqual(created);
  expect(await accounts.list()).toEqual([original, created]);
  expect(vault.values.get(original.id)).toBe(originalCredential);
  expect(await readFile(originalPath, 'utf8')).toBe(originalBackup);
  const path = await accounts.backup();
  expect(path).not.toBe(originalPath);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(
    (await fixture('restored-fresh').accounts.import((await readFile(path, 'utf8')).trim())).pubkey,
  ).toBe(created.pubkey);
  expect(await accounts.use(original.id)).toEqual(original);
  expect(await accounts.current()).toEqual(original);
  expect(await accounts.backup()).toBe(originalPath);
});
test('failed fresh creation preserves the selected identity and its backup', async () => {
  const { accounts, vault } = fixture('fresh-unavailable');
  const original = await accounts.create();
  const path = await accounts.backup();
  const backup = await readFile(path, 'utf8');
  vault.set = async () => {
    throw new AccountError('KEYSTORE_UNAVAILABLE', 'Unavailable');
  };
  await expect(accounts.create({ fresh: true })).rejects.toMatchObject({
    code: 'KEYSTORE_UNAVAILABLE',
  });
  expect(await accounts.current()).toEqual(original);
  expect(await accounts.create()).toEqual(original);
  expect(await accounts.list()).toEqual([original]);
  expect(await readFile(path, 'utf8')).toBe(backup);
  expect(vault.values.size).toBe(1);
});
test('backup preserves corrupt or symlinked destinations and never substitutes another creator', async () => {
  const { accounts, vault } = fixture('backup-destination');
  const original = await accounts.create();
  const path = await accounts.backup();
  await writeFile(path, 'precious existing content');
  await expect(accounts.create()).rejects.toMatchObject({ code: 'RECOVERY_FILE' });
  expect(await readFile(path, 'utf8')).toBe('precious existing content');
  expect(await accounts.current()).toEqual(original);
  await rm(path);
  const target = join(root, 'backup-link-target');
  await writeFile(target, 'leave this alone');
  await symlink(target, path);
  await expect(accounts.backup()).rejects.toMatchObject({ code: 'RECOVERY_FILE' });
  expect(await readFile(target, 'utf8')).toBe('leave this alone');
  await rm(path);
  const otherKey = generateSecretKey();
  await writeFile(path, nip19.nsecEncode(otherKey));
  await expect(accounts.backup()).rejects.toMatchObject({ code: 'RECOVERY_FILE' });
  await rm(path);
  await vault.set(
    original.id,
    JSON.stringify({ type: 'local', key: Buffer.from(otherKey).toString('hex') }),
  );
  await expect(accounts.backup()).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' });
  expect(await Bun.file(path).exists()).toBe(false);
});
test('failed keychain creation leaves no plaintext fallback or selected replacement', async () => {
  const { accounts, vault } = fixture('no-backup-fallback');
  vault.set = async () => {
    throw new AccountError('KEYSTORE_UNAVAILABLE', 'Unavailable');
  };
  await expect(accounts.create()).rejects.toMatchObject({ code: 'KEYSTORE_UNAVAILABLE' });
  expect(await accounts.current()).toBeNull();
  expect((await readdir(accounts.directory)).some((name) => name.endsWith('.nsec'))).toBe(false);
});
test('a blocked backup destination preserves the newly created identity for a later retry', async () => {
  const { accounts, vault } = fixture('backup-retry');
  const store = vault.set.bind(vault);
  let path = '';
  vault.set = async (id, value) => {
    await store(id, value);
    const key = Uint8Array.from(Buffer.from(JSON.parse(value).key, 'hex'));
    try {
      path = join(accounts.directory, `${getPublicKey(key)}.nsec`);
      await mkdir(path);
    } finally {
      key.fill(0);
    }
  };
  await expect(accounts.create()).rejects.toMatchObject({ code: 'RECOVERY_FILE' });
  const account = await accounts.current();
  if (!account) throw new Error('Backup failure lost the selected creator');
  expect(account.status).toBe('ready');
  await rm(path, { recursive: true });
  expect(await accounts.backup()).toBe(path);
  expect(await accounts.create()).toEqual(account);
  expect(vault.values.size).toBe(1);
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
test('failed imports keep metadata public and do not replace an existing identity', async () => {
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
test('recovery imports the NIP-49 specification test vector', async () => {
  // Public test data from https://github.com/nostr-protocol/nips/blob/master/49.md.
  const encoded =
    'ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p';
  const vault = new MemoryVault();
  const accounts = new Accounts('local', join(root, 'spec-vector'), vault);
  const account = await accounts.import(encoded, 'nostr');
  expect(JSON.parse((await vault.get(account.id))!).key).toBe(
    '3501454135014541350145413501453fefb02227e449e57cf4d3a3ce05378683',
  );
});
