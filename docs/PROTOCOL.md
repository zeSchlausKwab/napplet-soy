# Space v1 — proposed interoperability profile

Implementation update (2026-09-12): see [PUBLIC-DEVELOPMENT.md](PUBLIC-DEVELOPMENT.md) for automatic seeds, relay-only publicdev, and SSR/PNG previews, and [CONTEXTVM.md](CONTEXTVM.md) for the multiplayer service boundary. The remaining infrastructure and extensions below are still a plan. Public clients accept ordinary named/root/snapshot manifests without requiring Space extensions.

Status: draft proposal, 2026-09-11. This is an application profile, not an adopted NIP or NAP. It extends existing formats only where the gallery/release workflow needs additional metadata. Compatibility must be demonstrated before publishing this profile as stable.

## 1. Compatibility baseline

The current [NIP-5D proposal at commit 24711d9](https://github.com/dskvr/nips/blob/24711d9c47bbdd07908bf1d52bf677d9cbc530f0/5D.md) defines named napplets as kind `35129`, root napplets as `15129`, and immutable snapshots as `5129`. It adopts the file-manifest tag schema and aggregate-hash algorithm from [NIP-5A](https://github.com/nostr-protocol/nips/blob/master/5A.md). Generic nsites use different kinds; they must not be silently treated as sandboxed napplets.

Space v1 uses named napplets and snapshots. Root napplets are unnecessary for the first product. The source repository has its own NIP-34 identity.

The tested release must record exact SDK, shim, template, conformance, ngit, GRASP, Blossom, and protocol revisions. Reading an old README or choosing the latest versions independently is insufficient. The registry's NAP-SHELL handshake language differs from the newer NIP-5D domain-injection language; the compatibility spike must select and document one working contract without asserting compatibility with both.

## 2. Domain identities

| Entity | Identifier | Meaning |
| --- | --- | --- |
| Creator | Nostr public key | Author who signs the napplet's releases |
| Napplet | `35129:<author-hex>:<d-tag>` | Stable identity across title changes and releases |
| Release | Signed kind-5129 snapshot event ID | Immutable reference to one publication |
| Artifact | NIP-5A aggregate hash | Identity of the playable files, independent of metadata |
| Source repository | `30617:<maintainer-hex>:<repo-id>` | NIP-34 repository address |
| Source revision | Repository address plus exact Git object ID | Source selected for a release |
| Remix | New napplet address plus parent release reference | Independent creation with explicit ancestry |

Use a short generated `d-tag`, for example `plasma-k4m2`, with a separate editable display title. Limit generated IDs to 1–13 lowercase letters/digits/hyphens, with no trailing hyphen, as a conservative profile choice; do not claim the current napplet implementation itself enforces that length. Never derive identity solely from a mutable title or globally reserve titles.

The runtime's protocol tuple `(dTag, aggregateHash)` does not replace the full public identity. Host-owned storage, permission records, and social grouping must also include the author-qualified napplet address. Two authors can intentionally publish identical code and identifiers.

## 3. Playable package

- Exactly one executable artifact: `/index.html`, UTF-8, containing the application's code, CSS, and required playable assets.
- No CDN scripts, external fonts, dynamic imports fetched over the network, direct fetch/WebSocket calls, or service-worker dependencies in the initial profile.
- Build-time dependencies are allowed. They are bundled into the result rather than resolved on the viewer's device.
- Proposed limits: 10 MiB uncompressed playable artifact, 50 MiB source archive, 1 MiB cover, 64 KiB release descriptor. These are admission limits, subject to empirical tuning.
- The local preview and public player use the same runtime library and production bundle policy. A normal unsandboxed Vite page does not prove the napplet will run on the website.
- Initial host capabilities: only the compatible foundational behavior and optionally scoped storage. Audio and visual output are browser behavior within the sandbox. Additional NAP domains are introduced deliberately after the first profile works.

The hash algorithm is the upstream NIP-5A algorithm. Implement it once, with vectors shared by CLI, API, and browser. Reject malformed hashes, duplicate/conflicting paths, invalid signatures, inconsistent aggregate hashes, and unsupported required capabilities.

Covers, metadata, and source archives live on Blossom too, but are not playable `path` entries. This preserves a single self-contained runtime artifact.

## 4. Release descriptor extension

Propose one application-specific manifest tag:

```json
["space", "v1", "<sha256-of-descriptor-bytes>"]
```

This tag is not standardized. Its schema, validation, preservation in snapshots, and compatibility behavior are Space's responsibility. Existing upstream tools must be adapted or extended to preserve it; their current metadata-copy behavior must not be assumed to do so.

The descriptor is UTF-8 JSON stored on the manifest's hinted Blossom servers. Hash the exact uploaded bytes. Consumers verify that hash before parsing. A typed serializer makes our output deterministic, but consumers need not reserialize JSON to verify it.

Illustrative shape, with placeholders rather than real identifiers:

```json
{
  "schema": "space-release/v1",
  "runtimeProfile": "space-v1",
  "nappletAddress": "35129:<author-hex>:plasma-k4m2",
  "artifactAggregateHash": "<sha256>",
  "title": "Plasma Pet",
  "description": "A tiny creature made of interference patterns.",
  "category": "visual",
  "tags": ["plasma", "interactive"],
  "source": {
    "repositoryAddress": "30617:<author-hex>:plasma-k4m2",
    "cloneUrl": "nostr://<repository-naddr>",
    "commit": "<git-object-id>",
    "archive": { "sha256": "<sha256>", "mediaType": "application/gzip" },
    "license": "MIT",
    "licensePath": "LICENSE",
    "attributionPath": "ASSETS.md"
  },
  "cover": { "sha256": "<sha256>", "mediaType": "image/webp", "width": 960, "height": 600 },
  "presentation": { "aspectRatio": "16:10", "inputs": ["pointer", "touch"], "audio": false },
  "build": { "templateRevision": "<commit>", "toolchainRevision": "<profile-version>" },
  "remix": null
}
```

A remix descriptor adds its immediate parent's full napplet address, exact snapshot event ID, artifact hash, source commit, and original napplet address. The descriptor must not reference its own snapshot event ID: that would create a hash/signature cycle.

The signed manifest binds the descriptor hash; the descriptor binds source and presentation metadata. Check that its napplet address and artifact hash match the enclosing manifest. Where title/description exist in both places, require agreement. Index only descriptor versions the validator supports; unknown versions can remain valid upstream napplets without being eligible for our gallery.

Standard manifest `source` tags should still expose a clone URL for clients unaware of the extension. A `t` tag such as `napplet-space` can provide relay discovery. The extension is additive: another conformant host can still verify and play the HTML without implementing our gallery.

## 5. Current version, snapshots, and ancestry

The named manifest is the current pointer and carries the standard playable tags, required capabilities, source URL, and descriptor tag. Each publication also produces a snapshot with the same artifact/descriptor and an `a` reference to the napplet's own address. A snapshot has no `d` tag.

The current manifest additionally points to its exact snapshot using a proposed profile convention: `["e", "<snapshot-id>", "<relay-hint>", "snapshot"]`. The `snapshot` marker is a Space convention, not an upstream guarantee. Validate that this event has the same author, napplet address, playable mappings, descriptor, and required capabilities. This removes ambiguity when several releases have identical HTML. Sign the snapshot first, then construct the current manifest; the snapshot never refers back to the current event ID.

Follow the pinned upstream schema for the named manifest's `a` immediate-parent and `A` original-ancestor tags on remixes. Snapshot `a` means the snapshotted napplet, not its remix parent. Put the exact parent snapshot in the descriptor so those meanings do not collide.

Keep URLs explicit:

```text
/n/<naddr>            latest valid publication
/r/<snapshot-event>  pinned publication
/@<handle>/<slug>     site alias for the stable napplet address
```

Titles and vanity slugs are display aliases. A fork gets a new creator-qualified address and repository, and starts from the exact referenced source commit rather than whatever is at `main` today. Do not grant a remixing creator write access to the original repository. A remix is an independent project, not an automatic PR.

The site's authenticated name registry maps a normalized creator handle and napplet slug to the decoded kind/pubkey/d-tag tuple. Multiple naddrs with different relay hints can denote that same tuple. Alias changes do not mutate the napplet's protocol identity, release ancestry, storage scope, or social thread. Retain previous names for the same creation. Site alias ownership is an operator-managed record, not a new Nostr naming standard; see [WEB-ARCHITECTURE.md](WEB-ARCHITECTURE.md).

Rollback republishes an earlier artifact/descriptor under a new current event and a new snapshot. It does not delete history. Guard timestamps against clock skew and resolve competing current events according to Nostr ordering; a stale local publication must not silently overwrite a newer release. Require an explicit override when this conflict is detected.

If the newest signed current manifest is invalid or unavailable, surface that state. The site may offer the last verified playable release, but must label it as an older version rather than quietly calling it current. Nostr ordering and gallery eligibility are separate decisions.

## 6. Source guarantees

Every gallery-eligible release includes retrievable source, an exact commit, a license, dependency lockfile, and the documented build recipe. Retain a source archive on Blossom for convenient inspection and recovery. Validate archive paths, links, expanded size, and file count before extracting; validate its tracked tree against the referenced Git revision before claiming it is that source.

Retain Git release refs so published commits remain reachable after branches move. Large original media can be represented in a content-addressed source asset lockfile and restored during remix; every required source asset must be retained and hash-checked too. V1 can keep normal small assets in Git and introduce that lockfile only when needed.

A creator signature and matching source archive prove what the creator published and claimed. They do not prove the HTML was built from that source. Initially label the association as creator-declared. Only show a stronger reproducible-build claim after an independent isolated rebuild reproduces the artifact hash. That verification is a later worker capability, not a prerequisite for every quick first publish.

## 7. Social event mapping

| Interaction | Protocol | Space aggregation rule |
| --- | --- | --- |
| Profiles | Nostr kind 0 | Existing author identity; merge updates according to Nostr rules |
| Like | [NIP-25](https://github.com/nostr-protocol/nips/blob/master/25.md), kind 7 | Include required target `e` and addressable `a` reference; count one active like per actor and napplet address across releases |
| Comment | [NIP-22](https://github.com/nostr-protocol/nips/blob/master/22.md), kind 1111 | Root at napplet address; include the required root/parent tags, author tags, kinds, and current target event reference |
| Reply | NIP-22, kind 1111 | Preserve root napplet scope, point parent at the comment |
| Zap | [NIP-57](https://github.com/nostr-protocol/nips/blob/master/57.md), request 9734 and receipt 9735 | Pay creator; use address reference and the relevant event reference; aggregate validated receipts across versions |
| Retraction | NIP-09 deletion request | Apply only where ownership and protocol rules authorize it; do not promise network-wide erasure |

Persist raw signed events and deduplicate by event ID. Resolve event-only legacy references through known manifest history where possible; do not invent missing relationships. Validate referenced authors and event kinds rather than trusting tags alone. For reactions, a deleted old like must not erase a newer like; define active-event reduction and cover it with fixtures.

Validate zap receipts against NIP-57, including provider identity, request, invoice amount and description binding. Deduplicate payment hashes as well as event IDs. A receipt is the provider's assertion of payment, not trustless proof or a reliable anti-Sybil signal. Wallet setup and optional wallet-connect support belong to the site, not the game iframe.

## 8. Browser trust boundary

1. Obtain and verify the signed release and its descriptor. Fetch and verify all referenced playable bytes. Recompute the aggregate hash.
2. Construct a fresh `srcdoc` document, placing the host's CSP first and its selected runtime prelude before creator scripts. Hash verification happens before those host additions; additions are excluded from the signed artifact hash.
3. Use `sandbox="allow-scripts"` without `allow-same-origin`. Do not grant forms, popups, downloads, top navigation, or devices by default.
4. Scope each inbound message to the registered iframe `Window`, full app address, release, and current session. Reject malformed/oversized payloads and unknown senders; silently ignore unknown message types as the pinned protocol requires. Bound pending operations and message rates.
5. Remove bindings, subscriptions, object URLs, audio, and pending work when the player closes or navigates. A changed document must not inherit an old session's privileges.

Sandboxing alone does not block network requests. Use the pinned proposal's restrictive CSP, including `connect-src 'none'`, no external scripts, no child frames, and no workers initially. For media creations allow only embedded `data:`/`blob:` audio/image sources; permit WebAssembly byte compilation only if the chosen profile needs it. Do not enable JavaScript `unsafe-eval` as a shortcut. Host-page response headers must enforce controls such as `frame-ancestors` that a CSP meta element cannot enforce. See [CSP Level 3](https://www.w3.org/TR/CSP3/).

Test self-navigation as well as fetch, WebSocket, image beacons, popups, workers, message spoofing, and stale iframe references. CSP and a sandbox do not guarantee absence of every exfiltration channel or hard per-iframe CPU limits. Do not send secrets or signing credentials into the iframe. Infinite loops can still harm a browser tab; posters, one running player, and process isolation where available reduce exposure without guaranteeing a CPU quota.

Store saves in host-owned storage scoped by viewer/anonymous local profile and full napplet address. Default saves are device-local; cross-device persistence is later. Treat storage `shared` as shared within that napplet's permitted scope, never across unrelated creators. Decide update/migration behavior explicitly so changing an artifact does not inadvertently erase saves. Reassess capabilities on every signed release: the artifact hash excludes capability metadata, so identical bytes do not imply identical grants.

## 9. Protocol-level acceptance checks

- A second implementation verifies the same aggregate hash and opens a known good creation.
- Another operator can reconstruct the napplet, source, metadata, and ancestry from exported signed events, Git, and Blossom without our Postgres database.
- An update preserves the stable social thread; a pinned link remains pinned.
- Two authors with matching `d-tag` and artifact hash do not share permissions or storage.
- Retried publication does not duplicate snapshots or lose references.
- A missing or corrupt blob prevents execution and produces a useful retry state.
- Unknown profile extensions do not cause unsafe capability fallback.
- Social duplicates, forged references, retractions, and invalid zap receipts reduce correctly.

Rebuilding content does not recreate the site name registry, local curation, moderation history, private saves, or every event lost by all relays. Back up those operator/private datasets separately and state their portability limits. Portable Nostr routes continue to identify creations independently of the name registry.
