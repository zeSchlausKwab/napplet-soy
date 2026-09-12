# First implementation slice

Updated 2026-09-12. This records the boundary between working code and the larger v1 plan.

## Implemented

- Bun 1.3.11 with TanStack Start 1.168.52, Router 1.170.35, React 19.2.4, Vite 8.3.0, TypeScript, shadcn/ui, and Tailwind.
- SSR gallery, query-based category/search/sort filters, random selection, creator pages, named routes, portable `naddr` routes, pinned snapshot routes, and exact-source views.
- Six deterministic signed starter releases, original SVG posters, and interactive single-HTML examples. Fixture keys and data are clearly separated from production identity work. No fake community statistics.
- Applesauce event-store isolation, signature verification, optional explicitly configured relay subscriptions, React context, and NIP-07 extension connection. Signing keys never enter a napplet iframe or SSR state.
- NIP-5A aggregate hashes; signature, author, snapshot, path, and hash checks; bounded artifact download; browser-only execution behind an opaque iframe and restrictive CSP. This does not yet claim full NAP interoperability or a complete hostile-content admission pipeline.
- Local CLI project creation with Git, source, license, agent instructions, and a standalone bundled copy of the same restricted preview runtime.
- A native Bun production server, PM2 ecosystem definition, local Caddy/PM2 commands, and a VPS deployment script with pinned tool downloads, candidate health checks, release directories, activation rollback, and systemd persistence.

## Relay discovery, previews, and ContextVM additions

- Idempotent example seeding runs before both development and local production startup; a warm check measured about 33 ms.
- Explicit `publicdev` imports signed kinds 35129/15129/5129 through Applesauce. No Space-specific snapshot pointer is required. Public source is Nostr relays, with bounded signed-hint Blossom fetching and a separate `.local` cache. No HTTP catalog importer remains.
- Public naddr/snapshot pages, capability availability states, hash-verified playback, and source downloads. A real relay scan found 93 valid manifests; 13 artifacts were cached, and Rubik Cube ran successfully in Chromium.
- Server-rendered OG/canonical/Twitter metadata and bounded PNG generation with a bundled font. The deploy script sets a trusted site origin. Native image rendering is excluded from Vite optimization and browser bundles.
- A runnable ContextVM matchmaking starter with encrypted Nostr transport and authenticated ticket ownership, plus a separate PM2 definition. Its API and the pending browser NAP-CVM integration are specified in [CONTEXTVM.md](CONTEXTVM.md). No game engine, managed creator hosting, or public ContextVM deployment is claimed.

See [PUBLIC-DEVELOPMENT.md](PUBLIC-DEVELOPMENT.md) for runtime limits and commands.

## Verification boundary

Protocol/runtime/CLI/deployment-input tests and Chromium tests cover signatures, hashes, address equivalence, traversal rejection, source inspection, SSR, hydration/navigation, gallery filters, mobile overflow, sandbox access/network restrictions, tamper rejection, and signer failure handling. The local PM2/Caddy stack is used for the final browser pass. Repeatable transport tests use bounded local NIP-01 fixtures; a separate read-only public-relay smoke run verifies actual discovery and playback. ContextVM client/server tests exercise encrypted MCP round trips and transport-derived identity.

Local PM2 checks exposed its Bun `require()` wrapper incompatibility with top-level await; the ecosystem now executes the Bun binary directly. PM2 also retains old executable/cwd settings on reload, so activation explicitly recreates the dedicated application process. React 19.3.0 triggered a Bun 1.3.11 CommonJS loader error when importing its production SSR renderer; React/React DOM are pinned to the verified 19.2.4 pair. Candidate smoke checks and the standalone server explicitly use production mode so this class of difference is tested before activation.

No VPS has been contacted or deployed to. Shell syntax and argument validation are tested; remote apt installation, Linux systemd behavior, certificate issuance, actual reboot recovery, and remote rollback remain unverified. Docker's daemon was unavailable, and no GRASP/Blossom/database deployment was substituted or claimed.

## Next vertical slice

Wire one real publish path through creator signing, ngit/GRASP source provisioning, Blossom upload, relay events, persistent validation/indexing, named-route assignment, and playback. Establish the upstream SDK/shim/conformance compatibility pins at that boundary before expanding the public gallery. The CLI installer, remote signers, persistent naming claims, moderation, likes/comments/zaps, and a full remix/publish journal are still ahead.

Final validation for this slice: 33 unit/integration tests passed; six Chromium checks passed against ordinary production mode through Caddy/PM2, plus the explicit publicdev browser check. The latter covers relay-derived naddr lookup, verified Rubik Cube playback, capability gating, and its OG endpoint. Cached public page/artifact/image URLs returned 404 when publicdev was off. The public gallery was also checked at a 390px viewport for overflow.
