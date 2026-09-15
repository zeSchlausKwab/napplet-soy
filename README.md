# napplet.soy

A playground for self-contained games, visual experiments, and digital nonsense.

Implementation details and current limits live in the feature documents and the
[NAP review](docs/NAP-REVIEW.md). The original [plan](PLAN.md) is design history;
[deployment evidence](docs/DEPLOYMENT.md) records what has shipped.

This is the first working implementation slice: Bun + React + TanStack Start, shadcn/ui, and Applesauce. It includes six signed local examples, SSR and client navigation, named/Nostr/pinned URLs, hash-verified sandbox playback, source inspection, a standalone creator CLI, and Caddy/PM2 deployment tooling.

Released 2026-09-14 with CLI **0.5.0**: [napplet settings](docs/CONFIGURATION.md),
gallery social actions/rankings, anonymous zap invoices, and [shared sign-in](docs/IDENTITY.md)
through extensions, NIP-46 and memory-only key import. The CLI supports both bunker
links and `account pair` QR onboarding. See [compatibility](docs/COMPATIBILITY.md)
and [deployment evidence](docs/DEPLOYMENT.md) for verified behavior and remaining work.

## Start developing

Platform development requires Bun **1.3.11**, Node **18+** for PM2, Git, Go **1.21+**, Rust **1.97.1**, and a C compiler. Linux additionally needs `pkg-config` and OpenSSL development headers. The relay build selects Go **1.25.0** automatically. See [relay setup](docs/RELAY.md) and [Git hosting](docs/GRASP.md).

```sh
bun install --frozen-lockfile
bun run dev
```

Open <http://localhost:3000>. The persistent Khatru/LMDB/Bleve relay, [Blossom storage](docs/BLOSSOM.md), and [GRASP source hosting](docs/GRASP.md) start automatically; no wallet or account is needed to explore the starter collection. Every dev launch checks and repairs the six examples, verifies their bytes and ownership in local Blossom, and reconciles their 12 signed events through the local relay. It also reconciles six Git repositories through signed Nostr state and Git HTTP. Unchanged blobs, source commits and fixture files are not rewritten. A warm source check takes about 1.2 seconds. The browser opens no public relay connections by default. Set `VITE_NOSTR_RELAYS` to an explicit comma-separated relay list to enable the Applesauce subscription; restart/rebuild after changing public configuration.

## Browse public napplets

```sh
bun run dev publicdev
# Force a refresh, or use the production stack:
bun run dev publicdev --refresh
PORT=3020 bun run dev:prod publicdev
```

This discovers signed napplet manifests from Nostr relays through Applesauce and caches verified Blossom artifacts. Repeat starts reuse a 15-minute cache. Public entries resolve through naddr/snapshot routes; unsupported required capabilities are shown explicitly. No Nappelin/HTTP directory is used. See [public development and OG previews](docs/PUBLIC-DEVELOPMENT.md).

Click a playable card's preview to run it inline. Only one card runs at a time; fullscreen preserves its session, and scrolling it away stops it. Click its title for the detail page. The player provides the upstream NAP shim, scoped saves, virtual file exports, verified resource loading, and Nostr reads. File exports appear below the player for download. Napplet-initiated writes remain disabled. Connecting or disconnecting in the host notifies the running napplet and isolates its account data. See the [public runtime capabilities and limits](docs/PUBLIC-RUNTIME.md).

Every napplet page includes server-rendered Open Graph metadata and a 1200×630 PNG preview. `SPACE_SITE_ORIGIN` controls absolute share URLs; the VPS script sets it from the deployment domain.

The gallery searches and filters the full retained index, with 24 results per page.
Paste a portable Nostr napplet link into search to discover a creation not yet
indexed here. Cold links trigger a bounded relay lookup, including server-rendered
share metadata once the signed manifest is available. See [discovery and OG](docs/DISCOVERY.md).

## ContextVM starter

A small encrypted ContextVM matchmaking service is available with join, status, and leave tools:

```sh
SPACE_CVM_RELAYS=ws://127.0.0.1:19347/relay bun run cvm
```

Start the platform dev stack first to provide the relay. The server creates a persistent local key automatically. The draft NAP-CVM browser bridge and a playable multiplayer demo are next; the player does not advertise that capability yet. See the [API and provider design](docs/CONTEXTVM.md).

## Make a local napplet

No platform checkout, Bun or Node installation is needed.

Creator CLI: **napplet soyLI**, command `soyli`. The local 0.6.0 rename is pending
release; see [upgrading and compatibility](docs/CLI.md#rename-and-upgrade--2026-09-15).

```sh
curl -fsSL https://napplet.soy/install.sh | sh -s -- new my-napplet
# Follow the printed PATH instruction if needed.
cd my-napplet
soyli dev
```

Open <http://localhost:4173> and point your existing coding agent at the new project.
It contains the pinned creator-maintained [napplet/boilerplate](https://github.com/napplet/boilerplate):
TypeScript source, its SDK/Vite plugin, lockfile, documentation, MIT license and
eight official Napplet skills. The CLI prepares a private Node/pnpm toolchain and
builds the self-contained `dist/index.html`; nothing needs installing globally.
The preview watches the upstream build and uses the same sandbox and supported
NAP services as the website. Run `soyli build` before check/publish after
editing. See [the creator CLI guide](docs/CLI.md) for verification commands,
upstream pins and `skills update` for existing projects. The six single-file
example starters remain available through explicit `--template` options.

## Creator identity

Interactive `new` offers a new identity, an existing remote signer, or setup later. Once selected, the same identity is reused across projects. Noninteractive creation can use `--identity create`; `--identity later` creates just the preview project.

```sh
bun run soyli account create          # create once, then reuse
bun run soyli account connect         # paste a bunker link at the hidden prompt
bun run soyli account show
bun run soyli account export "$HOME/napplet-recovery.ncryptsec"
```

Local keys and NIP-46 session credentials use the OS credential store. New projects contain only the selected creator's public key and network. Export creates a passphrase-encrypted NIP-49 recovery file; `account import` restores it or imports an nsec through hidden input. `account list` and `account use <account-id>` switch saved identities. Add `--network local` for separate test credentials. Linux creator accounts need an unlocked Secret Service/keyring; there is no plaintext fallback. See [identity and recovery](docs/IDENTITY.md).

## Run the production build locally

```sh
bun run dev:setup
bun run dev:prod
```

This downloads a checksum-verified Caddy **2.10.2** binary into `.local/bin`, builds the application, and starts Caddy, the Bun server, Nostr relay, Blossom and GRASP under an isolated PM2 **7.0.4** instance. Open <http://localhost:8080>. Blossom uses the separate origin <http://127.0.0.1:8081>, with its direct loopback origin at port 19348 available in either dev mode. Git hosting and its repository relay share <http://127.0.0.1:8082>. Both dev modes start the same Caddy proxy and backing services. Stop the ordinary dev server first, or select another backend port with `PORT=3020 bun run dev:prod`.

```sh
bun run dev:doctor
bun run dev:down
```

These commands affect only this checkout's `.local/pm2` state. They do not install global PM2 services or modify the OS trust store. Local HTTP is the initial convenience mode; `SPACE_SITE_ADDRESS=https://localhost:8443` selects Caddy's local HTTPS. For that mode, install/trust its local CA separately before browsing; readiness checks also need the local CA trusted. Public HTTPS is configured by the VPS deploy script.

## Publish a creation

The CLI now freezes selected source, checks it in the shared browser sandbox, pushes a Git release, uploads HTML and a source archive to Blossom, and publishes standard snapshot/current manifests. Retries reuse saved signatures and commits. Try it against the running local services with a matching local creator:

```sh
bun run soyli account create --network local
bun run soyli new local-experiment --network local
bunx playwright install chromium
bun run soyli publish --project local-experiment --network local --dry-run
bun run soyli publish --project local-experiment --network local
bun run soyli status --project local-experiment --network local
# After interruption, finish the saved bytes even if the editor has newer changes:
bun run soyli publish --project local-experiment --network local --resume
```

Publication returns `indexed` once the website confirms the exact current/snapshot pair and verified artifact. If the website is still catching up, it returns `announced_pending_index`; use `bun run soyli status --project local-experiment --network local --refresh` to check again without signing or publishing. Keep `.napplet-space` for retry history. Signed creator handles and permanent named routes are available from the napplet detail page; and the public defaults target the deployed napplet.soy services. See [publishing and recovery](docs/PUBLISHING.md) and [persistent indexing](docs/INDEXING.md).

## Deploy to a VPS

Point your website hostname, `relay.<website-hostname>`, `blossom.<website-hostname>` and `git.<website-hostname>` at a Debian/Ubuntu VPS with systemd, SSH access, and reachable ports 80/443:

```sh
bun run deploy --host root@your-vps --domain napplet.example
# Optional: --relay-domain relay.example --blossom-domain files.example --git-domain source.example
# Use --shared-caddy when sharing an existing Caddy installation with other sites.
```

The script installs Bun, Caddy, PM2 and pinned Go/Rust toolchains, creates an unprivileged service account, uploads a source archive excluding local secrets and dependencies, builds on the VPS, tests a candidate release on a loopback port, and activates it under PM2. Caddy manages HTTPS, and systemd restores both services after a reboot. Failed activation attempts restore the previous release/configuration where available. See [deployment details](docs/DEPLOYMENT.md).

The managed public relay is `wss://relay.napplet.soy`. The old `wss://napplet.soy/relay`
address remains compatible with existing publications and project settings. CLI
0.4.1 uses the subdomain by default. Deployment also installs daily verified state
backups; see [backup and recovery](docs/RECOVERY.md) for restoration and off-VPS copies.

## Verify

```sh
bun run check
bun run test:relay
bun run test:blossom
bun run test:grasp
bun run test:identity
bun run test:publish
bun run build
bunx playwright install chromium
# With the web server running:
bun run test:browser
# Or verify through the actual local PM2/Caddy stack:
TEST_ORIGIN=http://localhost:8080 bun run test:browser
```

`bun run fixtures` regenerates the deterministic signed local examples and SVG posters. The fixture signing key is public test data and must never be used as an account. Dev startup writes fixture events, blobs and Git source only to literal-loopback services; public relays and storage never receive fixtures. The CLI now connects creator source, artifact publication and relay discovery; persistent website indexing confirms portable current and snapshot routes. Fixtures use the same manifest validation and runtime policy as relay imports. The local posters are bundled illustrations. Relay imports resolve linked NIP-89 pictures and Zapstore screenshots/icons, cache safe raster images for gallery/player/OG previews, and fall back to generated cards when unavailable. See [linked previews](docs/PREVIEWS.md) for formats and limits.

Our publishing contract is standard NIP-5D manifests, public relays, retrievable Blossom bytes, and open source by default. Additional Space metadata and named routes are optional overlays. Publishing is not complete until an independent client discovers and runs a release without the Space API; see [the interoperability contract](docs/PROTOCOL.md).

## What is still ahead

The gallery merges the persistent SQLite relay index and optional publicdev collection by Nostr identity. Examples enter through the same discovery path as other creations; Featured is an explicit administrator selection. Its separate PM2 worker verifies manifests, downloads artifacts and resolves linked previews. Signed naming claims, comments, likes, zaps, full-index pagination and inline playback are implemented. The public installer distributes standalone macOS/Linux creator packages. The player supports the single-HTML profile and documented playback NAP domains. ContextVM's browser bridge, user-created site layouts, publishing permissions, and full upstream conformance remain ahead; composability is outside the current scope.

The deployment script includes the [managed relay](docs/RELAY.md), [signed Blossom storage](docs/BLOSSOM.md), [GRASP source hosting](docs/GRASP.md), and [persistent website index](docs/INDEXING.md). Creators can claim permanent `/@handle/slug` links, remix pinned source, and comment, like or zap from detail pages. See [remixing](docs/REMIXING.md) and [community actions and limits](docs/COMMUNITY.md).

Standalone creator installation, requirements and release procedure: [CLI guide](docs/CLI.md).

### Remix and share

Open a napplet and choose **Remix this** for an exact-version CLI command. Signed source archives retain source and attribution; other napplets provide a verified HTML starting point. Connect the author's Nostr signer to claim a permanent **Named link**. Comments, replies, likes and zaps appear below the player.

CLI 0.4.0 and these website features are live on napplet.soy. The CLI adds the local Listing preview and screenshot capture controls. The website offers install-and-remix, comment likes/zaps, and an initially empty admin Featured collection. For future releases, upload CLI archives before deploying the website. Existing CLI users can rerun the installer and restart `soyli dev`; `soyli skills update` refreshes their creator guidance. Readable links require a one-time **Named link** claim on the website and then follow future releases. See [CLI instructions](docs/CLI.md) and [community behavior](docs/COMMUNITY.md).

Creator media: see [where to put assets and current limitations](docs/ASSETS.md).
Creator profiles and the remix family tree are implemented and verified locally,
pending deployment: [Nostr profiles](docs/PROFILES.md) and
[genealogy](docs/REMIXING.md#genealogy-on-napplet-pages). Creator labels open portable
`/p/<npub>` pages; connected authors can edit their optional kind-0 profile.
The deployed website includes a [pinned original-source browser](docs/REMIXING.md#browsing-a-releases-original-files); its release status is recorded in [deployment history](docs/DEPLOYMENT.md).
