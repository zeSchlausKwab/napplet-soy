# napplet.space

A playground for self-contained games, visual experiments, and digital nonsense.

This is the first working implementation slice: Bun + React + TanStack Start, shadcn/ui, and Applesauce. It includes six signed local examples, SSR and client navigation, named/Nostr/pinned URLs, hash-verified sandbox playback, source inspection, a local starter CLI, and Caddy/PM2 deployment tooling.

## Start developing

Requires Bun **1.3.11**, Node **18+** for PM2, and Git.

```sh
bun install --frozen-lockfile
bun run dev
```

Open <http://localhost:3000>. No relay, database, wallet, or account is needed to explore the starter collection. Every dev launch checks and repairs the six examples, rewriting only changed files. The browser opens no public relay connections by default. Set `VITE_NOSTR_RELAYS` to an explicit comma-separated relay list to enable the Applesauce subscription; restart/rebuild after changing public configuration.

## Browse public napplets

```sh
bun run dev publicdev
# Force a refresh, or use the production stack:
bun run dev publicdev --refresh
PORT=3020 bun run dev:prod publicdev
```

This discovers signed napplet manifests from Nostr relays through Applesauce and caches verified Blossom artifacts. Repeat starts reuse a 15-minute cache. Public entries resolve through naddr/snapshot routes; unsupported required capabilities are shown explicitly. No Nappelin/HTTP directory is used. See [public development and OG previews](docs/PUBLIC-DEVELOPMENT.md).

Open a card marked **Ready to play**, then click **Play napplet**. The player now provides the upstream NAP shim, scoped saves, virtual file exports, verified resource loading, and Nostr reads. File exports appear below the player for download. Publishing and account changes remain disabled. See the [public runtime capabilities and limits](docs/PUBLIC-RUNTIME.md).

Every napplet page includes server-rendered Open Graph metadata and a 1200×630 PNG preview. `SPACE_SITE_ORIGIN` controls absolute share URLs; the VPS script sets it from the deployment domain.

## ContextVM starter

A small encrypted ContextVM matchmaking service is available with join, status, and leave tools:

```sh
SPACE_CVM_RELAYS=ws://127.0.0.1:7777 bun run cvm
```

Supply an actual relay. The server creates a persistent local key automatically. The draft NAP-CVM browser bridge and a playable multiplayer demo are next; the player does not advertise that capability yet. See the [API and provider design](docs/CONTEXTVM.md).

## Make a local napplet

From this repository:

```sh
bun run napplet new my-napplet --template soft-orbit
cd my-napplet
bun run dev
```

Open <http://localhost:4173> and point your existing coding agent at the new project. It contains HTML source, a Git repository, MIT licensing, agent instructions, and a bundled copy of the shared preview runtime. The preview automatically reloads saved changes. It works independently of the platform checkout after creation.

## Run the production build locally

```sh
bun run dev:setup
bun run dev:prod
```

This downloads a checksum-verified Caddy **2.10.2** binary into `.local/bin`, builds the application, and starts Caddy and the Bun server under an isolated PM2 **7.0.4** instance. Open <http://localhost:8080>. Stop the ordinary dev server first, or select another backend port with `PORT=3020 bun run dev:prod`.

```sh
bun run dev:doctor
bun run dev:down
```

These commands affect only this checkout's `.local/pm2` state. They do not install global PM2 services or modify the OS trust store. Local HTTP is the initial convenience mode; `SPACE_SITE_ADDRESS=https://localhost:8443` selects Caddy's local HTTPS. For that mode, install/trust its local CA separately before browsing; readiness checks also need the local CA trusted. Public HTTPS is configured by the VPS deploy script.

## Deploy to a VPS

Point a domain's DNS to a dedicated Debian/Ubuntu VPS with systemd, SSH access, and reachable ports 80/443:

```sh
bun run deploy --host root@your-vps --domain napplet.example
```

The script installs Bun, Caddy, and PM2, creates an unprivileged service account, uploads a source archive excluding local secrets and dependencies, builds on the VPS, tests a candidate release on a loopback port, and activates it under PM2. Caddy manages HTTPS, and systemd restores both services after a reboot. Failed activation attempts restore the previous release/configuration where available. See [deployment details](docs/DEPLOYMENT.md).

## Verify

```sh
bun run check
bun run build
bunx playwright install chromium
# With the web server running:
bun run test:browser
# Or verify through the actual local PM2/Caddy stack:
TEST_ORIGIN=http://localhost:8080 bun run test:browser
```

`bun run fixtures` regenerates the deterministic signed local examples and SVG posters. The fixture signing key is public test data and must never be used as an account. Generated events are not published to relays. They use the same manifest validation and runtime policy as relay imports. The posters are bundled illustrations; public entries currently use generated OG cards, so their appearance does not establish whether the author supplied a screenshot.

Our publishing contract is standard NIP-5D manifests, public relays, retrievable Blossom bytes, and open source by default. Additional Space metadata and named routes are optional overlays. Publishing is not complete until an independent client discovers and runs a release without the Space API; see [the interoperability contract](docs/PROTOCOL.md).

## What is still ahead

The default site reads validated bundled fixtures; publicdev adds a bounded relay-discovered catalog. There is no persistent community index or public publishing service yet. GRASP/ngit repository provisioning, Blossom uploads, Postgres/workers, production naming claims, key provisioning/remote signers, comments/likes/zaps, and the public one-line installer remain planned. The player supports the single-HTML profile and the documented playback NAP domains. Composability, ContextVM's browser bridge, publishing permissions, and full upstream conformance remain ahead.

The deployment script deploys this foundation. It does not claim to provision those remaining services. The next vertical slice should connect one real creation → Git/Blossom publication → relay indexing → named playable link through the operator services described in [PLAN.md](PLAN.md).
