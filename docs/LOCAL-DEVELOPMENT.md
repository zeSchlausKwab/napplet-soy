# Local development and production parity

Implementation update (2026-09-13): the [managed Khatru/LMDB/Bleve relay](RELAY.md), [Bun Blossom storage](BLOSSOM.md), and pinned [ngit-grasp source hosting](GRASP.md) run natively under PM2 in both dev modes. Caddy also runs in both modes, exposing the website at localhost:8080, Blossom at 127.0.0.1:8081, and Git/its root Nostr relay at 127.0.0.1:8082. Dev startup checks fixtures through signed relay, Blossom and Git/Nostr requests. Warm Git reconciliation takes about 1.2 seconds without new publications. The same native services, PM2 definitions and shared GRASP configuration are used by the VPS script. Local GRASP ignores inherited operator keys/dotenv, disables index/default peer publication and admits only literal-loopback event-directed connections. The community database, index/preview workers, local HTTPS and the complete creator publication transaction below remain a design target. See [PUBLIC-DEVELOPMENT.md](PUBLIC-DEVELOPMENT.md) for read-only relay discovery and [CONTEXTVM.md](CONTEXTVM.md) for multiplayer.

Status: required direction with partial implementation, 2026-09-11. The user subsequently requested Caddy and PM2 for VPS deployment. The current web foundation runs directly under Bun for HMR and under PM2 + Caddy for production-build checks; see [README.md](../README.md) and [DEPLOYMENT.md](DEPLOYMENT.md) for implemented commands. The database/worker and local HTTPS topology described below remains a design target. The implemented backing services deploy directly under PM2, without containers.

## 1. Developer experience

Proposed commands from the platform repository:

```sh
bun run dev:setup   # first use: prerequisites, local origins/TLS, isolated config
bun run dev         # complete local stack, app hot reload, readiness checks
bun run dev:prod    # complete stack using production application builds
bun run dev:doctor # meaningful health, hostname, TLS, and endpoint diagnostics
bun run dev:down    # stop this checkout’s PM2 services while preserving state
```

`dev` should converge an existing installation and be safe to rerun. It starts real GRASP, Blossom, social relay, Postgres, index worker, preview worker, web server, and reverse proxy. The web service serves both SSR and API endpoints. The dev overlay runs our editable services with watch/reload; implemented upstream services use pinned native builds. `dev:prod` uses the production Bun build and PM2 startup commands with local data and origins. Each invocation reports its origin, selected mode, and readiness.

Ordinary napplet creators still use the lightweight `napplet-space dev` command; they do not need this platform stack. Platform contributors use the full stack to exercise publishing and discovery end to end.

## 2. Shared deployment definition

Implemented definitions:

```text
infra/Caddyfile                    local web, blob and Git origins
infra/*.ecosystem.config.cjs       shared PM2 service definitions
services/relay                    pinned Khatru/LMDB/Bleve service
services/blossom                  Bun blob service
services/grasp/upstream.json       native ngit-grasp and compiler pins
services/grasp/config.cjs          shared Node/Bun runtime configuration
scripts/dev.ts                    local readiness and fixture reconciliation
scripts/deploy-remote.sh          VPS prerequisites, build, activation/recovery
```

State is outside release directories. Local HTTP and public HTTPS use the same service protocols and backends. Postgres/workers and trusted local HTTPS still need shared definitions and integration checks.

| Must match | Permitted environment differences |
| --- | --- |
| Service implementation and pinned release | Hostnames, credentials, local fixtures |
| Database schema and migration path | Local CA versus public TLS certificates |
| Upload/signature/Git authorization rules | Resource budgets, replicas, external redundancy |
| Production sandbox, CSP, origin boundaries | Application HMR in `dev` only |
| Storage backend type and retention logic | Host volume paths and backup destinations |
| Protocol event formats and publish state machine | CPU architecture, with an explicit CI check on the production architecture |

Start with the same disk-backed Blossom storage approach locally and on the initial VPS deployment. If production later changes backend, make that backend available to the local stack too. Pin a multi-architecture image index and record the resolved platform digests; matching release names alone do not prove identical behavior. `dev:prod` should also accept an exact CI image to reproduce a deployed build.

## 3. Origins, HTTPS, and container networking

Example local origins:

```text
https://napplet.test                     web, SSR, API
wss://relay.napplet.test                 social relay
https://git.napplet.test                 Git HTTP
wss://git.napplet.test                   GRASP relay
https://blossom.napplet-content.test      untrusted blob origin
```

Use two distinct site domains locally to exercise the same cookie/origin separation as production. A Caddy reverse proxy is the recommended shared ingress, with a local CA for development and public certificates in production. The first setup installs or explains the required local name resolution and CA trust. Those OS operations may require a one-time user action; they must not recur on every startup. Caddy documents local HTTPS and the need to establish trust separately, especially in containers. [Caddy HTTPS](https://caddyserver.com/docs/automatic-https).

The same advertised URLs must work from the host browser, host CLI, and containers. On the host, names resolve to the loopback-published proxy. On the Compose network, aliases resolve those same names to the proxy container. Do not advertise `localhost` or a Compose service name in an event that another client must resolve. Keep public origins separate from internal database/service connection settings.

Mount only the local CA certificate into client containers that need to trust it; do not distribute the CA private key. Verify trust for browsers, Git HTTP, ngit relay TLS, the napplet CLI, Bun, and workers individually. The ngit source inspected during planning distinguishes bundled roots from the optional `native-tls-roots` build feature. Pin a supported trust-capable build/profile and test it in both environments. Installing a CA in the OS is not proof that every client uses it. Never fix local HTTPS with a blanket certificate-verification disable flag.

Development needs a narrowly scoped SSRF-policy exception for the configured local service origins; it must not disable private-network destination checks generally. Route signed HTTP authorization through the same public URL so canonical request URLs and server scopes agree.

## 4. Isolation and fixtures

Use a separate `local` CLI network/account profile, separate keys, and a separate publish journal namespace. `napplet-space publish --network local` resolves all service defaults from that profile. Freeze resolved targets into the publish job so a later profile change cannot redirect an in-flight release. Show local mode clearly in the browser and CLI.

The local runtime must not accidentally publish fixtures to public relays or use production signing/wallet credentials. Override ngit discovery/default relay sets and disable public peer synchronization in the local profile; enforce runtime egress restrictions after dependencies/images are downloaded. Explicitly list exceptions needed for any integration test. Never rely only on changing the primary relay URL.

Seed several playable creations, source repos, a remix chain, and social activity through the same protocol boundaries as real publication. Avoid populating only derived database rows, which would bypass the actual integration. Store fixture job state so reseeding is idempotent. Add small unit-test mocks for targeted failures, while the full local path continues to use real services.

Zaps need special treatment: routine tests use clearly marked synthetic receipts and endpoint fixtures, not real payments. An optional integration profile can run a local Lightning regtest setup. Testing a live payment provider is a separate explicit step; the ordinary dev stack does not require a wallet or funds.

Keep persistent volumes scoped to a project/environment. `dev:down` preserves them. A distinct reset command explicitly targets only local volumes and explains the data it removes. Local CA trust and project data have separate lifecycles.

## 5. Startup and readiness

`dev` starts ingress and backing services, waits for meaningful health checks, runs the normal migration job once, starts application/worker services, and ensures fixtures are indexed. Avoid migrations racing in every web replica. Check that the relay accepts/returns a fixture event, GRASP can serve a fixture repo, Blossom returns the expected hash, and the gallery can resolve a seeded release before reporting ready.

Browser HMR uses the normal local HTTPS origin through the proxy. The platform's own app can hot reload, but the napplet runtime preview continues to load a built single-file artifact with production restrictions. Unsandboxed HMR working is not a substitute for that check.

Bind development ports to loopback by default. Phone testing is an explicit LAN mode with working hostnames and certificate trust on the phone. Avoid exposing databases, dashboards, or signing processes just to test the player on another device.

## 6. CI and parity checks

Build the production images once, start the base plus local overlay in a fresh CI environment, migrate, seed, and run the creation → publish → named link → play → remix flow. Test SSR metadata without JavaScript, browser hydration/playback, signed Git pushes, Blossom authorization, and interrupted publication against that stack.

Check the merged Compose/configuration output for accidental development mounts, missing policies, public test destinations, and version drift. Then exercise restoration from backups and service failure recovery. Use an additional staging deployment for real DNS, public TLS, the production CPU architecture, and provider/network differences that a laptop cannot reproduce.

The target is matching application behavior and service contracts. Local machines do not reproduce production scale, disk failure modes, public relay behavior, or real Lightning settlement automatically. Keep those limits visible in the release checks.
