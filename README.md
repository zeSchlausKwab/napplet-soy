# napplet.space

A playground for self-contained games, visual experiments, and digital nonsense.

This is the first working implementation slice: Bun + React + TanStack Start, shadcn/ui, and Applesauce. It includes six signed local examples, SSR and client navigation, named/Nostr/pinned URLs, hash-verified sandbox playback, source inspection, a local starter CLI, and Caddy/PM2 deployment tooling.

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

Open a card marked **Ready to play**, then click **Play napplet**. The player now provides the upstream NAP shim, scoped saves, virtual file exports, verified resource loading, and Nostr reads. File exports appear below the player for download. Napplet-initiated writes remain disabled. Connecting or disconnecting in the host notifies the running napplet and isolates its account data. See the [public runtime capabilities and limits](docs/PUBLIC-RUNTIME.md).

Every napplet page includes server-rendered Open Graph metadata and a 1200×630 PNG preview. `SPACE_SITE_ORIGIN` controls absolute share URLs; the VPS script sets it from the deployment domain.

## ContextVM starter

A small encrypted ContextVM matchmaking service is available with join, status, and leave tools:

```sh
SPACE_CVM_RELAYS=ws://127.0.0.1:19347/relay bun run cvm
```

Start the platform dev stack first to provide the relay. The server creates a persistent local key automatically. The draft NAP-CVM browser bridge and a playable multiplayer demo are next; the player does not advertise that capability yet. See the [API and provider design](docs/CONTEXTVM.md).

## Make a local napplet

From this repository:

```sh
bun run napplet new my-napplet --template soft-orbit
cd my-napplet
bun run dev
```

Open <http://localhost:4173> and point your existing coding agent at the new project. It contains HTML source, a Git repository, MIT licensing, agent instructions, and a bundled copy of the shared preview runtime. The preview automatically reloads saved changes, injects the same pinned shim and NAP-SHELL handshake, and provides the same storage, identity, relay/resource and file services as the website. Optional `requires`, `relays`, and `servers` settings live in `napplet.json`. It works independently of the platform checkout after creation; existing generated projects retain their bundled runtime.

## Creator identity

Interactive `new` offers a new identity, an existing remote signer, or setup later. Once selected, the same identity is reused across projects. Noninteractive creation can use `--identity create`; `--identity later` creates just the preview project.

```sh
bun run napplet account create          # create once, then reuse
bun run napplet account connect         # paste a bunker link at the hidden prompt
bun run napplet account show
bun run napplet account export "$HOME/napplet-recovery.ncryptsec"
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
bun run napplet account create --network local
bun run napplet new local-experiment --network local
bunx playwright install chromium
bun run napplet publish --project local-experiment --network local --dry-run
bun run napplet publish --project local-experiment --network local
bun run napplet status --project local-experiment --network local
# After interruption, finish the saved bytes even if the editor has newer changes:
bun run napplet publish --project local-experiment --network local --resume
```

The current result is `announced_pending_index`: the relay and storage are verified, while website indexing and named routes remain ahead. Keep `.napplet-space` with the project for retry history. Public destinations can be configured, but the intended production defaults have not been deployed or verified here. See [publishing commands, source scope and recovery](docs/PUBLISHING.md).

## Deploy to a VPS

Point your website hostname, `blossom.<website-hostname>` and `git.<website-hostname>` at a dedicated Debian/Ubuntu VPS with systemd, SSH access, and reachable ports 80/443:

```sh
bun run deploy --host root@your-vps --domain napplet.example
# Optional: --blossom-domain files.example --git-domain source.example
```

The script installs Bun, Caddy, PM2 and pinned Go/Rust toolchains, creates an unprivileged service account, uploads a source archive excluding local secrets and dependencies, builds on the VPS, tests a candidate release on a loopback port, and activates it under PM2. Caddy manages HTTPS, and systemd restores both services after a reboot. Failed activation attempts restore the previous release/configuration where available. See [deployment details](docs/DEPLOYMENT.md).

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

`bun run fixtures` regenerates the deterministic signed local examples and SVG posters. The fixture signing key is public test data and must never be used as an account. Dev startup writes fixture events, blobs and Git source only to literal-loopback services; public relays and storage never receive fixtures. The CLI now connects creator source, artifact publication and relay discovery; persistent website indexing remains ahead. Fixtures use the same manifest validation and runtime policy as relay imports. The local posters are bundled illustrations. Relay imports resolve linked NIP-89 pictures and Zapstore screenshots/icons, cache safe raster images for gallery/player/OG previews, and fall back to generated cards when unavailable. See [linked previews](docs/PREVIEWS.md) for formats and limits.

Our publishing contract is standard NIP-5D manifests, public relays, retrievable Blossom bytes, and open source by default. Additional Space metadata and named routes are optional overlays. Publishing is not complete until an independent client discovers and runs a release without the Space API; see [the interoperability contract](docs/PROTOCOL.md).

## What is still ahead

The default site reads validated bundled fixtures; publicdev adds a bounded relay-discovered catalog. There is no persistent community index or complete public publishing flow yet. Postgres/workers, production naming claims, comments/likes/zaps, and the public one-line installer remain planned. The player supports the single-HTML profile and the documented playback NAP domains. Composability, ContextVM's browser bridge, publishing permissions, and full upstream conformance remain ahead.

The deployment script deploys this foundation, including the [managed relay](docs/RELAY.md), [signed Blossom storage](docs/BLOSSOM.md), and [GRASP source hosting](docs/GRASP.md). The next slice must connect CLI-published relay events → persistent website indexing → named playable link through the operator services described in [PLAN.md](PLAN.md).
