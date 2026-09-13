# Napplet interoperability and publishing contract

Implementation update (2026-09-13): local fixtures and relay imports use the same manifest validator, capability checks, artifact verification, NAP host, and resource policy. See [PUBLIC-RUNTIME.md](PUBLIC-RUNTIME.md) for implemented operations and limits. The [resumable publisher](PUBLISHING.md) now signs Git source, uploads artifacts/archives and publishes standard snapshot/current manifests. Persistent website indexing and social writes remain planned. Linked preview metadata is implemented; see [PREVIEWS.md](PREVIEWS.md). The six bundled examples are local test fixtures; they have not been published to public relays or Blossom.

Standing product rule: a napplet created here is an ordinary public napplet. The client must not require a Space descriptor, hashtag, repository host, alias, or CLI provenance to discover or play it. Optional metadata enriches presentation; it never selects a privileged runtime or determines protocol identity. Apply the same capability, availability, and moderation policies to every publisher. The user has selected the NIP-5D proposal as authoritative, regardless of merge status. Pin its revision and referenced NAP contracts, and treat implementation mismatches as bugs. Known gaps and future relay/media/flavor design are recorded in [CLIENT-DIRECTION.md](CLIENT-DIRECTION.md).

## 1. Compatibility baseline

The current [NIP-5D proposal at commit 24711d9](https://github.com/dskvr/nips/blob/24711d9c47bbdd07908bf1d52bf677d9cbc530f0/5D.md) defines named napplets as kind `35129`, root napplets as `15129`, and immutable snapshots as `5129`. It adopts the file-manifest tag schema and aggregate-hash algorithm from [NIP-5A](https://github.com/nostr-protocol/nips/blob/master/5A.md). Generic nsites use different kinds; they must not be silently treated as sandboxed napplets.

The client accepts named, root, and snapshot manifests. Our publisher will default to named napplets and additionally publish snapshots for pinned links; snapshots are not a prerequisite for playing another publisher's current manifest. The source repository has its own NIP-34 identity.

The tested release must record exact SDK, shim, template, conformance, ngit, GRASP, Blossom, and protocol revisions. Reading an old README or choosing the latest versions independently is insufficient. The registry's NAP-SHELL handshake language differs from the newer NIP-5D domain-injection language; the compatibility spike must select and document one working contract without asserting compatibility with both.

## 2. Domain identities

| Entity | Identifier | Meaning |
| --- | --- | --- |
| Creator | Nostr public key | Author who signs the napplet's releases |
| Napplet | `35129:<author-hex>:<d-tag>` or `15129:<author-hex>:` | Stable identity across title changes and releases |
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
- Current host capabilities and operation limits are recorded in [PUBLIC-RUNTIME.md](PUBLIC-RUNTIME.md). Required domains are checked from the signed manifest for every napplet, including fixtures. Direct browser networking remains blocked; supported resource and relay operations go through the host.

The hash algorithm is the upstream NIP-5A algorithm. Implement it once, with vectors shared by CLI, API, and browser. Reject malformed hashes, duplicate/conflicting paths, invalid signatures, inconsistent aggregate hashes, and unsupported required capabilities.

Covers, metadata, and source archives live on Blossom too, but are not playable `path` entries. This preserves a single self-contained runtime artifact.

## 4. Optional presentation and source metadata

Topics use optional lowercase `t` hashtags from [NIP-24](https://github.com/nostr-protocol/nips/blob/master/24.md), on the signed manifest and its snapshot. Multiple tags are welcome; there is no fixed category enum and no mandatory Space hashtag. The client derives topics from verified manifests for both fixtures and relay imports; provenance is not a topic or filter. Missing tags leave a napplet in Everything and text search. A selected `?tag=generative` filter matches that topic, combined with `q` and `sort`; cards and details link to the same filter. Facet counts cover the loaded catalog, including entries whose playback is unavailable. They are not network-wide counts.

The display/search projection trims a leading `#` and surrounding whitespace, normalizes NFC and lowercase, deduplicates in author order, and accepts up to 32 topics of at most 64 Unicode code points. Empty values, embedded whitespace, control/bidi characters, and embedded `#` are omitted from the projection without changing the signed event or its admission. Unknown well-formed topics are preserved; no topics are inferred from titles, capabilities, source, or linked preview descriptors. The CLI seeds editable `topics` in local project configuration; the publisher serializes them as standard `t` tags.

Use upstream manifest fields for identity, playable paths, aggregate hash, required domains, Blossom `server` hints, title, description, and `source`. A `source` reference can identify a NIP-34 repository through `nostr://` or a public HTTPS repository/archive. Our publisher defaults to retrievable open source. Source availability affects inspection/remixing, not whether this client can discover and play an otherwise supported napplet.

Prefer existing descriptor conventions over inventing a parallel manifest. [NIP-5A's upstream app descriptors](https://github.com/nostr-protocol/nips/blob/master/5A.md#upstream-app-descriptors) allow an optional `app` reference to an addressable descriptor event. Linked previews support NIP-89 application pictures and Zapstore kind-32267 screenshots/icons, with signed fixtures and a live descriptor lookup checked. Other descriptor formats require a separate adapter and interoperability evidence. There is no Space-specific screenshot field required for playback.

Category, cover, aspect ratio, license details, exact source commit, build provenance, and remix references may enrich the gallery. Keep site aliases and curation separate from signed protocol identity. Verify any signed descriptor and its association before trusting its claims. Missing, unknown, invalid, or unavailable optional descriptors fall back to the ordinary manifest and a generated poster; they do not hide a valid napplet or block playback. An optional descriptor may never override signed paths or required capabilities.

Preview implementation today: the fixtures have bundled SVG illustrations; relay imports resolve supported linked descriptors into bounded cached raster images. Gallery/player covers and OG images use those images, with generated cards for missing or unusable metadata. The latest 93-entry relay cache has no app links, so those cards still use the fallback. A generic card does not prove the author supplied no screenshot through another format. Metadata crawling never executes napplet code. The same descriptor parser and image indexer are available to the future publisher; see [PREVIEWS.md](PREVIEWS.md).

Removing all optional Space metadata must leave the same napplet address, playable bytes, and NAP behavior. No client should need the Space website API or a `napplet-space` hashtag to discover our publications.

## 5. Current version, snapshots, and ancestry

The named manifest is the current pointer and carries standard playable tags, required capabilities, source URL, and any optional descriptor reference. Our publisher also produces a snapshot with the same artifact and an `a` reference to the napplet's own address. A snapshot has no `d` tag. Each event is independently valid and playable without retrieving the other.

Do not add a mandatory custom current-to-snapshot pointer. The publisher can retain the exact pair in its local journal and the site index. Validate each manifest independently and check source address, signer, and artifact when associating a pair; matching code alone does not identify the exact release metadata. Public playback does not require a snapshot pair. Fixtures use these same rules and no longer emit a custom snapshot pointer or discovery hashtag.

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

Every release made by our publisher should include retrievable source, an exact commit, a license, dependency lockfile, and the documented build recipe. This is a creator-tool default, not a requirement for indexing other publishers' manifests. Retain a source archive on Blossom for convenient inspection and recovery. Validate archive paths, links, expanded size, and file count before extracting; validate its tracked tree against the referenced Git revision before claiming it is that source.

The publisher retains Git release refs so published commits remain reachable after branches move. It includes optional `source-commit` and `source-archive` provenance tags alongside the standard `source` repository URL. These two convenience tags are Space conventions, not protocol requirements; clients can ignore them and discover/play the same manifest. Large original media can be represented in a content-addressed source asset lockfile and restored during remix; every required source asset must be retained and hash-checked too. V1 can keep normal small assets in Git and introduce that lockfile only when needed.

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

1. Obtain and verify the signed manifest. Fetch and verify all referenced playable bytes and recompute the aggregate hash. Resolve optional descriptors separately for presentation; their absence cannot prevent execution.
2. Construct a fresh `srcdoc` document, placing the host's CSP first and its selected runtime prelude before creator scripts. Hash verification happens before those host additions; additions are excluded from the signed artifact hash.
3. Use `sandbox="allow-scripts"` without `allow-same-origin`. Do not grant forms, popups, downloads, top navigation, or devices by default.
4. Scope each inbound message to the registered iframe `Window`, full app address, release, and current session. Reject malformed/oversized payloads and unknown senders; silently ignore unknown message types as the pinned protocol requires. Bound pending operations and message rates.
5. Remove bindings, subscriptions, object URLs, audio, and pending work when the player closes or navigates. A changed document must not inherit an old session's privileges.

Sandboxing alone does not block network requests. Use the pinned proposal's restrictive CSP, including `connect-src 'none'`, no external scripts, no child frames, and no workers initially. For media creations allow only embedded `data:`/`blob:` audio/image sources; permit WebAssembly byte compilation only if the chosen profile needs it. Do not enable JavaScript `unsafe-eval` as a shortcut. Host-page response headers must enforce controls such as `frame-ancestors` that a CSP meta element cannot enforce. See [CSP Level 3](https://www.w3.org/TR/CSP3/).

Test self-navigation as well as fetch, WebSocket, image beacons, popups, workers, message spoofing, and stale iframe references. CSP and a sandbox do not guarantee absence of every exfiltration channel or hard per-iframe CPU limits. Do not send secrets or signing credentials into the iframe. Infinite loops can still harm a browser tab; posters, one running player, and process isolation where available reduce exposure without guaranteeing a CPU quota.

Store saves in host-owned storage scoped by viewer/anonymous local profile and full napplet address. Default saves are device-local; cross-device persistence is later. Treat storage `shared` as shared within that napplet's permitted scope, never across unrelated creators. Decide update/migration behavior explicitly so changing an artifact does not inadvertently erase saves. Reassess capabilities on every signed release: the artifact hash excludes capability metadata, so identical bytes do not imply identical grants.

## 9. Protocol-level acceptance checks

- Publish from our CLI with a real creator identity, then discover the signed manifest using only standard Nostr kind/address filters in a second implementation. That client must retrieve the hinted Blossom bytes, verify the same aggregate hash, and run the creation without the Space API, alias, hashtag, or optional descriptor. This acceptance check is pending until publishing is implemented.
- Import that publication back through the same relay ingestion path as any other publisher. Local fixtures and imported copies must receive identical validation, capabilities, resource access, and storage identity.
- Removing optional presentation metadata still yields a discoverable, playable napplet with a generated poster.
- Another operator can reconstruct the napplet, source, metadata, and ancestry from exported signed events, Git, and Blossom without our Postgres database.
- An update preserves the stable social thread; a pinned link remains pinned.
- Two authors with matching `d-tag` and artifact hash do not share permissions or storage.
- Retried publication does not duplicate snapshots or lose references.
- A missing or corrupt blob prevents execution and produces a useful retry state.
- Unknown profile extensions do not cause unsafe capability fallback.
- Social duplicates, forged references, retractions, and invalid zap receipts reduce correctly.

Rebuilding content does not recreate the site name registry, local curation, moderation history, private saves, or every event lost by all relays. Back up those operator/private datasets separately and state their portability limits. Portable Nostr routes continue to identify creations independently of the name registry.
