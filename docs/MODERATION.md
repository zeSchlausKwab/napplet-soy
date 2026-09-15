# Site administration and moderation

The `/admin` page uses the selected Applesauce account (extension, NIP-46 or browser key). Administrators are the union of `SPACE_ADMIN_PUBKEYS` (comma-separated hex or npub) and the policy document’s managed admin keys. No website private key is needed. GRASP and optional ContextVM have separate service identities; neither grants website administration.

The initial live administrator supplied by the operator is `3aa5817273c3b2f94f491840e0472f049d0f10009e23de63006166bca9b36ea3`.

## Authentication and persistence

Requests to `/api/admin` use [NIP-98](https://github.com/nostr-protocol/nips/blob/master/98.md), including verified event signature, exact canonical URL/query and method, bounded timestamp, and a required SHA-256 payload tag on changes. Cross-origin browser requests fail. Authorization precedes body parsing; headers, body size and verification attempts are bounded. Write receipts prevent replay across restarts. An expected policy revision prevents stale edits from overwriting another administrator's change.

`SPACE_MODERATION_FILE` points to a private JSON document shared by the website, indexer, native relay and Blossom. Rules, replay receipts and the latest 500 audit actions are replaced atomically after taking a writer lock. Reasons and the audit trail are visible only to admins. The document is limited to 10,000 rules and 8 MiB. Each process reloads changed policy without restarting. A missing or malformed **configured** policy denies affected operations. An unset path is the explicit unmoderated test profile.

Initialize once with `bun scripts/moderation-init.ts /absolute/path/policy.json`. Normal startup never clears a policy. On the VPS it lives under `/var/lib/napplet-space/moderation`; releases and rollback preserve it. Back it up with the other persistent service data. If a process is killed during the brief write critical section, confirm no administrator write is running before removing a leftover `policy.json.lock`; never clear the policy itself to recover a lock.

## Membership and Featured ordering (local revision, 2026-09-15)

Administrators may add or remove another administrator using an npub/hex public key
and required reason. All admins have the same curation, moderation and membership
powers; scoped roles remain future work. Server-configured keys are protected recovery
admins, removable only by editing server configuration. The final effective admin
cannot remove itself. Managed membership is capped at 32 keys; old v1 policy files
load with an empty managed list and retain environment-admin access.

Membership and Featured ordering changes use the same NIP-98 endpoint, bounded
audit/replay records and expected revision as content blocks. Authorization is
rechecked inside the policy writer lock so revoked administrators cannot race an
already-started mutation. Removal takes effect on the next request; old browser
views confer no authority. There is no app-owned administrator private key.

Feature/unfeature accepts a standard napplet address or pinned event ID. Up/down
controls reorder the same policy collection, recording each action and signer.
The hero takes the first twelve ready, unblocked, resolvable entries; an empty
policy grants no automatic fixture privilege. See [hero behavior](COMMUNITY.md#gallery-and-featured).
These changes are implemented locally; production remains on the recorded prior release.

## Administration workspace (local revision, 2026-09-15)

The identity menu offers **Administration** when the selected public key is currently
an administrator. Access is checked after sign-in or account changes, when the menu
opens, and on window focus. `/admin` loads its signed policy request automatically;
an unavailable signer can be reconnected or retried without a page reload. Declining
a signature retains the account and any entered target/reason.

`GET /api/admin-access?pubkey=<hex>` supplies a no-store navigation hint containing
only `authorized: true|false`. It does not enumerate administrators, expose policy
or grant permissions. Missing or corrupt policy fails closed. The signed `/api/admin`
endpoint remains the authority for every policy read and mutation. Switching or
signing out clears the workspace immediately and discards late responses. A refreshed
navigation hint hides revoked access; a request rejected with 403 clears its policy.

Napplets, Creators, Revisions, Assets and Administrators each have a search field,
explicit action buttons and a required change reason. Paste an npub/hex key, naddr,
note/nevent/event ID or SHA-256 according to the section. Standard `/n/<naddr>` and
`/r/<id>` links (including `/play`), profile links and hash-based Blossom URLs are
accepted without fetching those URLs. Named aliases should be resolved to their
napplet's naddr first. The selected canonical identifier is shown before a change.

Search is local to the authorized response: up to 2,000 recent indexed manifests,
publicdev cache entries, cached creator names and saved policy targets. It includes
blocked entries, loads no executable/media and never queries a remote service while
typing. Exact identifiers work even outside this search window. Search results are
limited to eight at a time; saved lists show up to twenty matching entries. An unavailable
index or profile cache does not prevent management by identifier.

Each entity offers Block/Unblock; Napplets and Revisions additionally offer
Feature/Remove from Featured; Administrators offer Add/Remove. Recovery keys remain
protected. The Featured order section shows titles and exact targets with up/down
and remove buttons, sharing a required ordering reason. Button feedback carries
pending/success/error/retry states. A stale revision refreshes the policy while
retaining the draft for an explicit retry; failed requests never auto-apply changes.

These changes are local and awaiting deployment. Browser verification covers immediate
sign-in access, declined signatures and retries, identifier/title search, protected
keys, live grants/revocation, late responses after sign-out and narrow layouts.

## Rule scope

| Target | Effect |
| --- | --- |
| Author (`npub` or hex pubkey) | Hides their website entries and cached playback/previews, filters managed relay reads/live delivery and rejects future publications. Blossom refuses new uploads and hides blobs with a claim from that author. |
| Napplet (`naddr` or `35129:pubkey:d`; root `15129:pubkey:` also supported) | Hides that address and snapshots linking it under the same author; rejects future revisions on the managed relay. |
| Revision (`note`, `nevent`, or event ID) | Blocks one signed event and its website entry/playback/preview. It does not automatically block a separate snapshot ID. |
| Blob (SHA-256) | Denies that exact object on Blossom, website artifact/resource endpoints and supported cached preview paths; blocks manifests referencing it on the managed relay. |

Named routes, naddr routes, snapshots, source views, OG/linked previews and playback admission all recheck policy. Moderation applies equally to bundled examples, indexed publications and publicdev imports. Optional index hydration skips blocked manifests. New content and image responses use `no-store` so subsequent network requests recheck policy; already downloaded copies, running frames and caches created by older versions cannot be remotely revoked.

These are operator serving decisions, not NIP-09 deletions or modifications of signed events. Blocked authors may still submit valid deletion requests to the managed relay and delete their own Blossom claims. Unblocking restores eligible retained content. A napplet/revision block does not automatically turn every related byte into a global hash block: use a blob rule when the bytes themselves must be refused.

**GRASP scope:** this first administration UI does not manage native GRASP repository moderation or erase Git objects. Its repository relay is separate from the managed napplet relay. Operators must handle Git-source restrictions through GRASP's reviewed repository-blacklist configuration and recovery procedures. Do not describe a website block as removal from Git hosting or other Nostr clients. Automatic cross-service repository policy synchronization, delegated admin roles, public reports/appeals and signed public moderation-list export are future work.

## Development and verification

The dev launcher initializes `.local/services/moderation/policy.json` idempotently and passes the same policy to participating services. Set `SPACE_ADMIN_PUBKEYS` before launching development; no fixture key is silently made administrator. For example, `SPACE_ADMIN_PUBKEYS=<your-public-key> bun run dev`.

Tests cover unauthorized/forged/expired/misbound requests, changed payloads, replay, conflicting revisions, atomic persistence, block/unblock, direct content/preview bypasses, native relay search/broadcast/write behavior, real Blossom HTTP reads/uploads/deletion and a Chromium extension-signing flow against the production build.

## Reference review

[Plebeian AdminManager](https://github.com/PlebeianApp/market/blob/master/src/server/AdminManager.ts) and [BlacklistManager](https://github.com/PlebeianApp/market/blob/master/src/server/BlacklistManager.ts) separate author membership from address-based item lists and load an app-authored kind-10000 list. The two classes alone do not establish signature, authorized issuer, ordering or persistence checks for every incoming update; their callers may do that. Napplet borrows the separation of targets, not their NDK implementation. This version uses operator-controlled public-key authorization and durable local policy, avoiding dependence on relay availability for enforcement. No new napplet protocol tags or app signing key are introduced.
