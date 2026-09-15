# Creator identity and recovery

Implemented 2026-09-13. Creator identity is a Nostr public key backed by either a locally stored private key or an existing NIP-46 remote signer. The same signing adapter works with NIP-34 Git authorization, Blossom upload authorization and NIP-5D napplet manifests. It does not expose signing to the running napplet or hold creator keys on our servers.

## First use and reuse

```sh
bun run soyli new my-experiment
bun run soyli account show
bun run soyli account check
```

Interactive project creation offers **create**, **connect existing**, or **set up later**. A selected account is reused. Local creators also get an automatic private-key backup; an existing valid backup is reused without unlocking the keystore, while saving a missing backup requires access to the stored key. Remote signers are not contacted just to scaffold a project. Noninteractive `new` reuses an existing selection, or leaves identity unset; `--identity create` explicitly enables first-use provisioning, and `--identity later` bypasses account setup entirely. If setup fails after scaffolding, the generated preview remains usable; finish setup with the account commands rather than recreating the directory.

`account create` is idempotent: it reuses the selected account. `account import` and `account connect` add and select an identity while retaining earlier entries. `account list` displays their public keys, types, status and account IDs. `account use <account-id>` verifies the stored signer before selecting it. An npub is also accepted; use the account ID when multiple sessions represent the same public key.

New projects store only `creator: {pubkey, network}` in `napplet.json`. This is a public authorship reference, not access to a key. The publisher matches it against the explicitly selected signer; cloning/remixing someone else's project must never select their credentials. A missing reference uses the current account. The local `previewId` and browser-extension identity belong to preview behavior and remain independent of the publishing signer.

## Where credentials live

The implementation uses [Bun's native Secrets API](https://bun.sh/docs/runtime/secrets), through a small `Vault` interface. Local keys and NIP-46 client credentials use the OS keychain, without retaining consumed pairing secrets on new connections. Plain account metadata lives at `${XDG_CONFIG_HOME:-~/.config}/napplet-space/accounts/<network>/accounts.json`. `SPACE_ACCOUNT_HOME` overrides the `napplet-space` directory, but account state and recovery destinations are rejected inside Git trees, including symlinked paths.

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
bun run soyli account connect
```

Paste a `bunker://` link at the hidden prompt. Do not put it in command arguments: it can contain an authorization secret. The connection uses Applesauce 6.2.2 and [NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md), with encrypted kind-24133 relay traffic. The client queries `get_public_key` separately from the bunker transport pubkey and verifies the user key again whenever the session is reopened. A changed key requires an explicit account connection.

The client requests `get_public_key` and signing permission for kinds 30617, 30618, 24242, 32267, 35129, 15129 and 5129. It verifies every returned signature, author and exact requested event contents. Other event kinds are rejected. Signer denial, cancellation and a 60-second response timeout close the session. The wrapper also clears outstanding RPC promises because the pinned SDK does not do this on close. SDK logging of plaintext RPC parameters is disabled for these sessions.

Signer-provided authorization links are displayed only in an interactive terminal; they are validated HTTP(S) URLs and are not opened automatically. JSON/noninteractive mode reports that authorization must be completed in the signer. WSS relays are accepted in public mode. `--network local` accepts only literal-loopback WS relays, never public fallback destinations.

Client-generated pairing is available in CLI 0.5.0:

```sh
soyli account pair
# Optional signer transport override and native app opening:
soyli account pair --signer-relay wss://relay.napplet.soy --open
soyli account check
```

The command displays a `nostrconnect://` URI and a terminal QR. Scan, paste, or open
it in a NIP-46 signer and approve the connection within 120 seconds. `--timeout`
accepts 1–600 seconds; Ctrl+C cancels without selecting an account. A retry creates
a fresh client key and secret. Keep the one-time URI private. `--json` emits a
pairing progress record containing that URI, then the final account or error;
redirected text output omits the terminal QR. `--open` is opt-in and unavailable
in JSON mode. The URI is intentionally supplied to the OS URL opener only when
requested; no creator private key is passed to a process.

The pairing secret is required before accepting the signer transport pubkey.
A bare `ack` cannot claim a client-initiated session. New bunker connections discard
the consumed secret after authorization; persisted client keys authenticate later
sessions. Existing saved credentials remain readable. `account check` reconnects
with the stored client key, and validates the same user before any publication.
A revoked client must pair again in the signer application.

Signer transport defaults to `wss://relay.napplet.soy` (local mode:
`ws://127.0.0.1:19347`). `--signer-relay` can be repeated up to three times.
It does not change `napplet.json` or publication relay/Blossom/Git destinations.
Automatic relay negotiation, remote session revocation management and a wider
external-signer compatibility matrix remain follow-ups. Remote identities are
backed up in their signer application, not exported as local creator keys.

## Website sign-in

The shell and social prompts open the same account chooser. Choose a NIP-07
extension, create a NIP-46 connection code/link, paste a `bunker://` link, or import
an nsec/hex private key after acknowledging the warning. The selected account signs
comments, likes, identified zaps, named links and admin authentication. Website
remote permissions are limited to kinds 5, 7, 1111, 9734 and 27235 plus public-key
lookup; creator publishing retains its separate scope. NIP-46 auth challenges are
shown as validated links in the chooser, including during later signing requests.

The original deployed release is memory-only. **The 2026-09-15 local revision adds
remembered accounts using `applesauce-accounts@6.2.0`; deployment is pending.** The
[official AccountManager API](https://github.com/hzrd149/applesauce/blob/ec51f7d4ecfd3db6099e786e8eec0062255588d4/apps/docs/apps/accounts/manager.md)
and custom `BaseAccount` adapter own selection, serialization and queued signing.
This is the user-confirmed package; no `applesauce/session` export is used. It is
compatible with our pinned core 6.2.0 and signers 6.2.2.

**Remember this connection** defaults on for extensions and NIP-46. **Remember this
private key** defaults off for imported/generated keys and has an explicit device
risk explanation. Without it, keys stay in the current tab's memory. The chooser
lists up to eight accounts and allows selection or forgetting; connecting a different
account retains the current one until the new signer verifies. Each remembered
session expires thirty days after connection, rather than being silently renewed
on every page load. Reconnect explicitly after expiry.

Stored credentials and account metadata are encrypted together using AES-GCM with
a random IV and origin-bound additional data. IndexedDB `napplet-sessions-v1` holds
the envelope and a non-exportable AES-256 CryptoKey; there is no plaintext key in
localStorage/sessionStorage. NIP-46 stores only the approved client key, signer
transport pubkey and relay hints, not consumed pairing secrets or the user's remote
private key. Nothing is copied to the server or napplet frames. The relay carries
encrypted kind-24133 envelopes. At-rest encryption is not a separate unlock factor:
same-origin code or someone using an unlocked browser profile can access/sign with
saved credentials. Use a trusted device; external signers keep user keys outside
this website. Browser storage is not a backup.

Reload restores the active selection and checks the signer's public key again.
Locked or revoked signers retain a selected/reconnect state; a changed signer key
cannot silently assume the saved identity. A cancelled/failed signing prompt no
longer logs out the account: retry reopens that same signer and checks the exact
requested event, identity and allowed kind. Explicit connection cancellation,
switching and sign-out still reject late approvals/signatures and close transports.

**Sign out** stops the active signer and persists a null selection. Remembered
accounts remain available; visit-only keys are dropped. **Forget** removes one
account from the vault and stops it if active. BroadcastChannel and focus refresh
synchronize account changes; atomic revision checks reject stale writes from other
tabs. Restore/reconnect does not rewrite the vault or trigger cross-tab login loops.
Storage errors show a warning and permit use in this tab. If forgetting cannot be
saved, clear this site's browser data on a shared device. Retrying a revoked NIP-46
client may require pairing again in the signer; forgetting here does not revoke the
client in that external application. Owned key bytes are wiped where possible;
JavaScript strings/runtime copies cannot be guaranteed erased.

Browsing is anonymous; signed-out visitors can still request anonymous zap invoices.
Anonymous zaps use a separate ephemeral key per invoice, never the selected signer.
These sessions are separate from CLI OS-keystore accounts and multiplayer rooms.

## Recovery and automation

### Browser key generation and recovery

Deployed and verified on 2026-09-14 in `20260914192251320-98168`; see the
[release record](DEPLOYMENT.md#onboarding-about-and-key-recovery-release--2026-09-14).
Live generation, encrypted backup and same-key recovery were checked using a temporary
browser identity. In the login chooser, **Create
identity** generates a key using the browser's cryptographic random source. Only
its public identity is shown. The new key does not replace a connected account
until the user prepares a recovery backup, saves the file or encrypted text,
acknowledges preserving it and its passphrase, and chooses Continue. Closing the
dialog discards an unused draft and cancels its cryptographic work.

**Back up private key** in a connected browser-key session exports that same key
again. It is unavailable for extensions and remote signers: back those up through
their signer applications. No private-key export permission is requested from them.

Backups are standard passphrase-encrypted [NIP-49](https://github.com/nostr-protocol/nips/blob/master/49.md)
`ncryptsec` text files. They use scrypt logN 16 and security byte 0 (the key has been
handled by a web application). The passphrase is 12–1024 characters and must be
confirmed. A download link appears after encryption; the browser cannot prove the
file was saved, so the creation flow explicitly asks the user to confirm that.
Encrypted text is also available for manual preservation. Keep the passphrase and
file separately; losing either may mean losing the identity.

Restore through **Private key → Recovery file**, or paste the encrypted text and
enter its passphrase. Existing nsec/hex import still works. The CLI's existing NIP-49
import can restore these backups too. Parsing checks checksum, version, length and
scrypt work factor (10–18) before decryption. Wrong passphrases and corrupt files
return generic errors. Encryption and decryption run in a cancellable worker with
a 30-second timeout, so the login stays responsive.

Keys and passphrases never go to our server or napplet frames. Remembered active keys
use the encrypted device vault described above; backup passphrases are never saved.
The recovery file is downloaded locally; its temporary object URL is revoked when
the backup view closes. Draft/active key bytes are wiped on disposal where possible;
JavaScript cannot guarantee erasure of all runtime copies. Backup does not itself
persist a login; the separate Remember choice controls device sessions. [Agenda A20](../AGENDA.md#a20--nostr-sessions-through-applesauce-sessions)
records the local account-session implementation and release status.

Verification: key-format interoperability/bounds tests and the production browser
integration cover generation, required backup acknowledgement, repeat export,
same-key restore, wrong passphrases, canceled work, refresh/disconnect and absence
from requests/localStorage/sessionStorage. The existing extension and NIP-46 browser
checks remain required regressions. All tests use disposable identities.

### CLI backups

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
bun run soyli account backup
bun run soyli account import --stdin < /path/to/key.nsec
```

The second command restores the same identity into the OS credential store.
Remote keys remain with the signer, which owns their backup workflow.
An encrypted export is also available:

```sh
bun run soyli account export "$HOME/napplet-recovery.ncryptsec"
bun run soyli account import
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

The [resumable publisher](PUBLISHING.md) now uses these components. The standalone installer, gallery indexing and named routes are implemented; release evidence and remaining compatibility work are tracked in DEPLOYMENT.md and AGENDA.md.

### Account-session verification — 2026-09-15

Local verification passed typecheck and production build; 195 repository tests plus
the added Forget-failure regression (eight focused account-session tests); seven
production-browser integrations for admin/Featured, extension/NIP-46, encrypted
IndexedDB, key generation/recovery, onboarding and social behavior. A separate
running-frame check confirms account changes retire pending prompts and isolate
storage/files without restarting the napplet. No production events or payments
were sent, and this revision has not been deployed.
