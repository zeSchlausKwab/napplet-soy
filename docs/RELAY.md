# Managed Nostr relay

Implemented 2026-09-12. The relay is the first backing service in the publishing path. It runs as a native Go process under PM2 locally and on the VPS. The application and clients remain Bun/React/Applesauce. Blossom, GRASP, creator signing, the publish journal, and the persistent website catalog are still pending.

## Run and query

```sh
bun run dev                    # HMR app + persistent local relay + example events
PORT=3020 bun run dev:prod publicdev  # production app, Caddy, relay; optional public reads
bun run dev:doctor
bun run relay:seed              # verify/reconcile local example events
bun run test:relay              # Go race checks + Applesauce process integration
bun run dev:down                # stop this checkout's PM2 processes; retain data
```

Platform development requires Go 1.21+ with automatic toolchain downloads enabled and a C compiler. Xcode command-line tools provide the compiler on macOS; `build-essential` provides it on Debian/Ubuntu. The build runner selects Go **1.25.0** explicitly. The VPS script installs that version using pinned official SHA-256 checksums. Ordinary creators using an already generated napplet project still only need Bun and their coding tool.

The direct local endpoint is `ws://127.0.0.1:19347/relay`. A production-build launch also exposes `ws://localhost:8080/relay` through Caddy. The VPS endpoint is `wss://<domain>/relay`, requiring no additional DNS record. NIP-11 is available at the corresponding HTTP(S) URL with `Accept: application/nostr+json`. Internal health is at `http://127.0.0.1:19347/health`; it reports service, build fingerprint, and instance identity. Health is only ready after the search rebuild finishes.

Any Nostr client can query, for example:

```json
["REQ", "gallery", {"kinds": [35129, 15129, 5129], "search": "\"lunar orbit\"", "#t": ["visuals"], "limit": 20}]
```

No Space hashtag, snapshot pointer, API key, or special event kind is required. Text search includes retained content, title/name, description/about, and topics. Words are combined with AND; double quotes select phrases. It uses Bleve's standard analyzer, not semantic search or a language-detection model. Ordinary author, kind, ID, time, and tag filters still apply. Results sort by descending timestamp then ascending event ID. NIP-50 extensions such as `language:` are not implemented. COUNT/NIP-45 and management/NIP-86 are not advertised or enabled.

## Persistence and compatibility

The application pins `fiatjaf.com/nostr@v0.0.0-20260902034142-316ef6591fa2` and Bleve **2.4.4** in `services/relay/go.mod` and `go.sum`. LMDB stores the original signed events. Bleve is a disposable projection used for queries, followed by full ID/filter/deletion/expiration checks against LMDB. This avoids the upstream search adapter's metadata-phrase and candidate-filtering problems. All retained kinds are indexed, including all three napplet kinds and supporting metadata.

The service rebuilds Bleve on startup from retained events. Rebuild work grows with the number of retained events; it is not constant-time recovery. An index write failure fails subsequent requests until restart/rebuild. A process lock prevents two instances from opening the same data directory or rebuilding each other's index. Queries release database locks before sending results to slow clients. Replaceable winners, including equal-time ID tie breaks, stay consistent across storage and search. Durable owned deletion markers block replay and hide a target even if termination occurs before physical removal. Deletion markers cannot themselves be deleted or assigned an expiration. Expired events disappear immediately from queries; a minute timer physically removes up to 200 expired records per pass.

Two small upstream compatibility patches are applied by `scripts/relay-go.ts` in a temporary module copy, with exact input SHA-256 guards:

- Event serialization keeps its base as a pointer and uses `unsafe.Add`, avoiding an invalid pointer-to-integer round trip exposed by Go's pointer checks.
- LMDB query batches are capped at 500 events; a full startup scan no longer allocates its entire result limit as a batch.

The shared Go module cache is never modified. Production builds and race tests use the same patches. Race/pointer checks remain enabled. A changed upstream file requires an explicit patch review; remove the patches when upgrading to a release that contains equivalent fixes. Use the repository's build/test commands, since plain `go test` does not apply these patches.

Local state is `.local/services/relay`; production state is `/var/lib/napplet-space/relay`, outside releases. LMDB currently has a 1 GiB map; Bleve and logs need additional disk. PM2 restarts above 1 GiB resident memory and uses a 15-second termination allowance. SIGTERM/SIGINT stops the expiration worker and closes hijacked WebSockets before closing storage. Back up the data directory with the relay stopped; the search directory can be regenerated. Online backup, dynamic capacity management, and large-catalog recovery benchmarks are not implemented.

## Seeding and publication boundary

Both dev modes repair the six bundled examples, then use Applesauce to query and publish their 12 existing signed current/snapshot events through the local relay. Every acknowledged event is read back and signature-verified. A warm check skips all writes (61 ms in the local verification run). The service is reused when its build fingerprint matches. `dev:down` retains events; the next start rebuilds the projection and reconciles seeds.

Fixture publication only accepts literal loopback `ws://` destinations, never relay hints, user defaults, publicdev targets, or a production account. `publicdev` remains an independent read-only public relay import. Deployment starts an empty relay and never runs the fixture seed against it.

These fixtures do **not** constitute completed portable publications: their bytes and posters still come from the bundled collection and they have no published Blossom/source hints. The gallery still reads the existing catalog/cache. The next integration must upload bytes to Blossom, provision source through GRASP/ngit, and index relay publications into playable/named routes. The publishing contract still requires independent-client discovery and playback without the Space API.

## Operator boundary and evidence

The current relay accepts valid signed events without an account allowlist. It bounds connections (256), WebSocket messages (64 KiB), stored query responses (200), filter dimensions, search length and execution time, and per-connection publication/query rates. These are initial service limits, not a complete public-abuse or moderation system. Public launch still needs operator retention/admission controls, load testing, monitoring, and backup restoration exercises.

Verified locally: ten Go tests with the race detector; three Applesauce integration tests against a real process; 62 existing application tests; type checking; production build/start; Caddy WebSocket search and NIP-11; a Chromium public-gallery/playback check. Tests cover signature tampering, metadata phrases, combined filters, paging, replacement/ties, owned deletion/replay, interrupted deletion, expiry cleanup, restart/index corruption, process locking, fixture destination restrictions, and seed idempotence. VPS shell syntax is checked, but no Linux deployment, certificate issuance, reboot or remote rollback has been executed.
