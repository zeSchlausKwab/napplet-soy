# Creator identity and recovery

Implemented 2026-09-13. Creator identity is a Nostr public key backed by either a locally stored private key or an existing NIP-46 remote signer. The same signing adapter works with NIP-34 Git authorization, Blossom upload authorization and NIP-5D napplet manifests. It does not expose signing to the running napplet or hold creator keys on our servers.

## First use and reuse

```sh
bun run napplet new my-experiment
bun run napplet account show
bun run napplet account check
```

Interactive project creation offers **create**, **connect existing**, or **set up later**. A selected account is reused. Local creators also get an automatic private-key backup; an existing valid backup is reused without unlocking the keystore, while saving a missing backup requires access to the stored key. Remote signers are not contacted just to scaffold a project. Noninteractive `new` reuses an existing selection, or leaves identity unset; `--identity create` explicitly enables first-use provisioning, and `--identity later` bypasses account setup entirely. If setup fails after scaffolding, the generated preview remains usable; finish setup with the account commands rather than recreating the directory.

`account create` is idempotent: it reuses the selected account. `account import` and `account connect` add and select an identity while retaining earlier entries. `account list` displays their public keys, types, status and account IDs. `account use <account-id>` verifies the stored signer before selecting it. An npub is also accepted; use the account ID when multiple sessions represent the same public key.

New projects store only `creator: {pubkey, network}` in `napplet.json`. This is a public authorship reference, not access to a key. The publisher matches it against the explicitly selected signer; cloning/remixing someone else's project must never select their credentials. A missing reference uses the current account. The local `previewId` and browser-extension identity belong to preview behavior and remain independent of the publishing signer.

## Where credentials live

The implementation uses [Bun's native Secrets API](https://bun.sh/docs/runtime/secrets), through a small `Vault` interface. Local keys and NIP-46 client credentials use the OS keychain, including any bunker pairing secret. Plain account metadata lives at `${XDG_CONFIG_HOME:-~/.config}/napplet-space/accounts/<network>/accounts.json`. `SPACE_ACCOUNT_HOME` overrides the `napplet-space` directory, but account state and recovery destinations are rejected inside Git trees, including symlinked paths.

| State | Location |
| --- | --- |
| Local creator private key | OS credential store, `space.napplet.creator.<network>` service, random credential ID |
| Portable local private-key backup | `<public-key>.nsec` beside account JSON, mode 0600, outside Git projects |
| Remote client key and connection credentials | Same credential store; the creator's private key remains with the remote signer |
| Public keys, credential IDs, type, selection, pending status | Account JSON, mode 0600 in a mode-0700 directory |
| Process ownership | SQLite lock beside the account JSON; automatically released after process exit |
| Project creator reference | Public key and network only |

Missing, locked or unavailable native storage produces an actionable error. Signing has no file/env fallback: restoring a backup is an explicit import into the credential store. Linux needs a running, unlocked Secret Service such as GNOME Keyring or KWallet; headless Linux without one cannot persist creator credentials through this implementation. The VPS services have separate service identities and do not need a creator account. Native macOS behavior is tested; Linux and Windows credential stores are not yet validated here.

A public pending reservation is flushed before storing a credential. Activation happens only after reading that credential back. If the process dies between those steps, another account setup recovers the reserved identity instead of silently generating a replacement. A pending reservation with no stored credential can be discarded safely because it was never activated or published. Missing keys for an already selected account never trigger key rotation. Damaged metadata is reported and preserved. Previously selected identities remain available when importing/connecting fails.

The OS credential store protects the signing credential at rest. The portable nsec backup is unencrypted, protected by owner-only filesystem permissions; preserve a private copy. JavaScript must still hold key material temporarily to sign or export; strings and OS/runtime memory cannot be guaranteed fully erased. No private key is passed to Git, a build command, a generated preview bundle, SSR, or project configuration.

## Existing remote identity

```sh
bun run napplet account connect
```

Paste a `bunker://` link at the hidden prompt. Do not put it in command arguments: it can contain an authorization secret. The connection uses Applesauce 6.2.2 and [NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md), with encrypted kind-24133 relay traffic. The client queries `get_public_key` separately from the bunker transport pubkey and verifies the user key again whenever the session is reopened. A changed key requires an explicit account connection.

The client requests `get_public_key` and signing permission for kinds 30617, 30618, 24242, 35129, 15129 and 5129. It verifies every returned signature, author and exact requested event contents. Other event kinds are rejected. Signer denial, cancellation and a 60-second response timeout close the session. The wrapper also clears outstanding RPC promises because the pinned SDK does not do this on close. SDK logging of plaintext RPC parameters is disabled for these sessions.

Signer-provided authorization links are displayed only in an interactive terminal; they are validated HTTP(S) URLs and are not opened automatically. JSON/noninteractive mode reports that authorization must be completed in the signer. WSS relays are accepted in public mode. `--network local` accepts only literal-loopback WS relays, never public fallback destinations.

Current scope is bunker-link pairing and reconnection. Client-generated `nostrconnect://` QR pairing, automatic relay switching, remote session revocation management and an external signer compatibility matrix remain ahead. Remote identities are backed up in their signer application, not exported as local creator keys.

## Recovery and automation

`new` and `account create` automatically save a local creator's key to
`${XDG_CONFIG_HOME:-~/.config}/napplet-space/accounts/<network>/<public-key>.nsec`
and report its absolute path. `SPACE_ACCOUNT_HOME` changes the base directory.
This file stays outside Git trees and all project source/artifacts. It is written
atomically with mode 0600. Existing files are validated against the creator's
public key and reused; damaged files, mismatched keys, symlinks and hard links
are refused without overwrite. A backup failure leaves the selected identity
intact: fix the destination and retry `account backup`.

Existing local identities can create or locate their backup explicitly:

```sh
bun run napplet account backup
bun run napplet account import --stdin < /path/to/key.nsec
```

The second command restores the same identity into the OS credential store.
Remote keys remain with the signer, which owns their backup workflow.
An encrypted export is also available:

```sh
bun run napplet account export "$HOME/napplet-recovery.ncryptsec"
bun run napplet account import
```

Export prompts twice for a passphrase of at least 12 characters and writes an encrypted [NIP-49](https://github.com/nostr-protocol/nips/blob/master/49.md) `ncryptsec` recovery key to a new mode-0600 file outside Git projects. It refuses overwrite. Keep the file and passphrase separately. Import accepts that encrypted value and passphrase, or an nsec at the hidden prompt. No routine command displays private keys.

The recovery parser checks the Bech32 checksum, format and scrypt cost before decryption. It accepts logN 10–18 and exports at logN 16; larger-cost backups must be handled with another trusted recovery tool. Wrong passphrases and invalid keys produce a generic error without echoing input. The bundled public fixture key cannot become a public creator identity.

`--json` reports public account data or `{error: {code, message}}`. Successful local `new` and `account create` include `backupFile`; `account backup` returns `{backupFile, format: "nsec"}`. Only paths are reported, never private keys. For automation, `account connect --stdin` reads a bunker URL. `account import --stdin` reads the recovery value on line 1 and, for an encrypted value, its passphrase on line 2. `account export <path> --passphrase-stdin` reads a passphrase. Input is bounded; do not place secrets in shell arguments or command history. Both public and local profiles use the same code with separate metadata and credential namespaces.

## Verification and remaining publication work

```sh
bun run check
bun run test:identity
# Opt-in: creates and deletes temporary credentials in the native OS store.
bun run test:identity:native
```

Tests cover reuse, independent process access, two generated projects, encrypted recovery, missing/unavailable storage, interrupted setup, concurrent setup, path isolation, identity substitution, encrypted NIP-46 pairing/reopening, remote denial, altered events, timeouts and cancellation. The native test uses temporary account metadata and removes only its own random credential IDs; it never accesses the user's default account selection.

The service integration test uses one reopened creator to publish source through native ngit-grasp, upload HTML through Blossom, and sign a standard manifest on Khatru. An independent Git clone and relay/Blossom reader recover the expected source and playable bytes. All test services and signing traffic are loopback-only.

The [resumable publisher](PUBLISHING.md) now uses these components. The public installer, persistent gallery indexing/naming transaction and independent-client public publication acceptance remain ahead.
