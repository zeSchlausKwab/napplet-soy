# First implementation slice

Updated 2026-09-12. This records the boundary between working code and the larger v1 plan.

## Implemented

- Bun 1.3.11 with TanStack Start 1.168.52, Router 1.170.35, React 19.2.4, Vite 8.3.0, TypeScript, shadcn/ui, and Tailwind.
- SSR gallery, query-based topic/search/sort filters, random selection, creator pages, named routes, portable `naddr` routes, pinned snapshot routes, and exact-source views.
- Six deterministic signed starter releases, original SVG posters, and interactive single-HTML examples. Fixture keys and data are clearly separated from production identity work. No fake community statistics.
- Applesauce event-store isolation, signature verification, optional explicitly configured relay subscriptions, React context, and NIP-07 extension connection. Signing keys never enter a napplet iframe or SSR state.
- NIP-5A aggregate hashes; signature, author, snapshot, path, and hash checks; bounded artifact download; browser-only execution behind an opaque iframe and restrictive CSP. This does not yet claim full NAP interoperability or a complete hostile-content admission pipeline.
- Local CLI project creation with Git, source, license, agent instructions, and a standalone bundled copy of the same restricted preview runtime.
- A native Bun production server, PM2 ecosystem definition, local Caddy/PM2 commands, and a VPS deployment script with pinned tool downloads, candidate health checks, release directories, activation rollback, and systemd persistence.

## Relay discovery, previews, and ContextVM additions

- Idempotent example seeding runs before both development and local production startup; a warm check measured about 33 ms.
- Explicit `publicdev` imports signed kinds 35129/15129/5129 through Applesauce. No Space-specific snapshot pointer is required. Public source is Nostr relays, with bounded signed-hint Blossom fetching and a separate `.local` cache. No HTTP catalog importer remains.
- Public naddr/snapshot pages, capability availability states, hash-verified playback, and source downloads. A real relay scan found 93 valid manifests; 23 compatible artifacts are now cached. The playback host and interoperability evidence are documented in [PUBLIC-RUNTIME.md](PUBLIC-RUNTIME.md).
- Server-rendered OG/canonical/Twitter metadata and bounded PNG generation with a bundled font. The deploy script sets a trusted site origin. Native image rendering is excluded from Vite optimization and browser bundles.
- A runnable ContextVM matchmaking starter with encrypted Nostr transport and authenticated ticket ownership, plus a separate PM2 definition. Its API and the pending browser NAP-CVM integration are specified in [CONTEXTVM.md](CONTEXTVM.md). No game engine, managed creator hosting, or public ContextVM deployment is claimed.

See [PUBLIC-DEVELOPMENT.md](PUBLIC-DEVELOPMENT.md) for runtime limits and commands.

## Verification boundary

Protocol/runtime/CLI/deployment-input tests and Chromium tests cover signatures, hashes, address equivalence, traversal rejection, source inspection, SSR, hydration/navigation, gallery filters, mobile overflow, sandbox access/network restrictions, tamper rejection, and signer failure handling. The local PM2/Caddy stack is used for the final browser pass. Repeatable transport tests use bounded local NIP-01 fixtures; a separate read-only public-relay smoke run verifies actual discovery and playback. ContextVM client/server tests exercise encrypted MCP round trips and transport-derived identity.

Local PM2 checks exposed its Bun `require()` wrapper incompatibility with top-level await; the ecosystem now executes the Bun binary directly. PM2 also retains old executable/cwd settings on reload, so activation explicitly recreates the dedicated application process. React 19.3.0 triggered a Bun 1.3.11 CommonJS loader error when importing its production SSR renderer; React/React DOM are pinned to the verified 19.2.4 pair. Candidate smoke checks and the standalone server explicitly use production mode so this class of difference is tested before activation.

No VPS has been contacted or deployed to. Shell syntax and argument validation are tested; remote apt installation, Linux systemd behavior, certificate issuance, actual reboot recovery, and remote rollback remain unverified. Docker's daemon was unavailable, and no GRASP/Blossom/database deployment was substituted or claimed.

## Next vertical slice

The four web/CLI contract repairs in [CLIENT-DIRECTION.md](CLIENT-DIRECTION.md) are implemented: silent unknown messages, shared CLI playback services, NIP-65 identity preferences, and identity-change notifications without restarting the frame. The NIP-5D proposal is authoritative. The same note records the recommended Khatru/LMDB/Bleve stack and future media/flavor strategy.

Wire one real publish path through creator signing, ngit/GRASP source provisioning, Blossom upload, relay events, persistent validation/indexing, named-route assignment, and playback. The upstream shim is now pinned and playback domains are implemented; extend conformance coverage alongside the publish path. The CLI installer, remote signers, persistent naming claims, moderation, likes/comments/zaps, and a full remix/publish journal are still ahead.

Previous slice validation: 33 unit/integration tests passed; six Chromium checks passed against ordinary production mode through Caddy/PM2, plus the explicit publicdev browser check. The latter covers relay-derived naddr lookup, verified Rubik Cube playback, capability gating, and its OG endpoint. Cached public page/artifact/image URLs returned 404 when publicdev was off. The public gallery was also checked at a 390px viewport for overflow.

## Public playback addition

The player now injects the upstream shim and a NAP-SHELL handshake, with scoped saves, virtual file exports, resource mediation, and Applesauce relay/outbox reads. Cards distinguish ready artifacts from unsupported domains and failed downloads. Napplet-initiated publishing and account-changing operations are denied explicitly; the user can connect/disconnect in the host. See [PUBLIC-RUNTIME.md](PUBLIC-RUNTIME.md) for the implemented surface, constraints and real public-app checks. The standalone CLI preview now bundles these same host services; see the conformance addition below.

Previous runtime checkpoint validation: **43 unit/integration tests and 11 Chromium tests passed**. Five public/runtime checks ran through Caddy/PM2, including the real 78 MiB packaged-resource fixture; six existing app checks ran against the same production build with public mode disabled. Public page/artifact/OG/resource endpoints returned 404 in ordinary mode. Mobile public compatibility labels remain visible at 390px with no horizontal overflow. Production build and startup succeeded. The runtime checkpoint is `95b88f4`; subsequent verification, accessibility and documentation changes are committed separately.


## Standard manifests across catalog sources

Fixture and public playback now share `validateManifest` and `preparePlayback`, including required-domain checks and author/address/aggregate storage identity. Current and pinned routes validate the manifest actually being played. Known fixture manifests use the same resource endpoint and policy as relay imports, and the host receives the configured publicdev relay set for either source. Fixture seeds no longer emit the custom snapshot pointer or Space discovery hashtag; browser subscriptions query all three napplet kinds without branding filters.

The interoperability contract now requires ordinary public relay discovery and independently verifiable Blossom retrieval for every future CLI publication. Extra descriptors, source details, categories, covers, and site aliases are optional presentation/remix data; they never determine whether a supported manifest can be discovered or played. At this checkpoint fixture posters remained bundled artwork and public cards used generated OG fallbacks; the linked-preview addition below implements descriptor resolution. The UI explicitly identifies the local examples as unpublished.

Latest validation: **48 unit/integration tests, type checking, production build/startup, and four Chromium public/runtime checks passed** through local Caddy/PM2. Coverage includes fixture/import playback parity, unbranded relay discovery, resource access for both sources, capability rejection, and storage isolation between authors/apps and consistency between current/snapshot views. The 78 MiB resource test was deliberately not repeated in this pass. Public publishing and independent-client acceptance remain unfinished.


## Linked preview addition

Optional NIP-5A `app` references now resolve through signed Nostr metadata to NIP-89 pictures/profile fallback and Zapstore kind-32267 screenshots/icons. A bounded Node/Applesauce worker performs metadata queries during refresh, including public relay hints. Images are fetched with DNS/IP checks, raster-decoded with Sharp, normalized, and cached independently of playable artifacts. Gallery/player covers use the cached PNG and OG cards incorporate it. Missing, malformed, unsupported, or unreachable metadata does not block playback. See [PREVIEWS.md](PREVIEWS.md).

The current public scan still contains 93 napplets and no app links. A separate signed offline browser fixture proves visible linked previews, and a read-only live query retrieved a real NIP-89 descriptor through the production metadata worker. No synthetic events were inserted into the normal public catalog or published. Test and build results for this addition are recorded in PREVIEWS.md.

## Topic taxonomy

The gallery now derives optional topics from signed NIP-24 `t` tags for every manifest. Fixed categories and the separate “Public napplets” filter are removed. Clickable tags, catalog counts, search, and shareable `?tag=...` filters work across discovery sources; details and generated OG images use the same vocabulary. Untagged napplets remain in Everything and text search. Cards show up to three topics with a link to the full list; available filters come from the loaded collection, not a fixed taxonomy. Generated preview images fit inside their cards without cropping their titles.

Fixture manifests and snapshots now carry meaningful topic tags, and new CLI projects include editable topic suggestions. The 93 currently cached relay manifests have no `t` tags; the client does not invent topics for them. This is presentation metadata, not a new admission rule or a publishing implementation. See [PROTOCOL.md](PROTOCOL.md) for normalization and bounds, and [../CONTEXT.md](../CONTEXT.md) for vocabulary.

Validation: 60 unit/integration tests, type checking, production build/startup, seven Chromium app/linked-preview checks, and a relay Rubik Cube playback check passed. The linked-preview fixture verifies that the same topic filter includes both bundled and imported napplets. Desktop and 390px mobile layouts were inspected; tag navigation, reload/history, missing-topic behavior, and idempotent seeding are covered. Local PM2/Caddy is running the updated build.


## Focused NIP-5D/NAP conformance repairs

Unknown message types are silently ignored, including future operations in recognized domains, before quota accounting. Known denied operations still return policy errors. `identity.getPublicKey` is an immediate successful snapshot even when asynchronous services are at quota. `identity.getRelays` reads the newest verified user kind-10002 event, preserves read/write directions, and keeps the operator allowlist independent.

Connecting or disconnecting preserves the running frame and sends `identity.changed` after cancelling outstanding requests, prompts, resources and subscriptions. Shared saves are isolated by account; instance storage and virtual files are fresh for each account scope. Late callbacks cannot reply into the new scope, including when request IDs are reused. Napplets must react to identity changes to clear their own in-memory state.

New CLI projects bundle the website's prelude builder, pinned shim, NAP-SHELL bootstrap, host, artifact verifier, sandbox policy and resource responder. The local server's only policy difference is admitting the current editable local revision instead of looking up a published signed manifest. It creates no signing key or fake publication. Project `previewId` provides stable local save identity, while `requires`, `relays` and `servers` configure the preview. Browser-extension identity, save/link prompts and file downloads work in the standalone host. No dependency installation or running Space backend is required after scaffolding.

Regression checks cover an independently spawned generated project, actual loopback relay traffic, CSP inheritance, source/config reloads, tampered bytes, unsupported requirements, account changes and cancelled work. Public relay writes remain absent.

Validation for this repair: type checking and **62 unit/integration tests passed**. **15 Chromium checks passed**: nine covering the standalone CLI, linked previews, public playback and runtime through the relevant local servers, plus six ordinary-mode gallery/SSR/sandbox checks. Production build and Caddy/PM2 startup passed. The opt-in 78 MiB packaged-resource test was not repeated.
