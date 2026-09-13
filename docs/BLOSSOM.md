# Blossom storage

Implemented 2026-09-13. The same Bun service and build run locally and on the VPS, with disk-backed content-addressed bytes and SQLite ownership metadata. No Docker service or external database is needed for this component.

## Protocol contract

The implementation is pinned to Blossom revision [`b5bd2801d1763aa635fc8fea7a76597e0eb18990`](https://github.com/hzrd149/blossom/tree/b5bd2801d1763aa635fc8fea7a76597e0eb18990), including the current separation of authorization and management into BUD-11 and BUD-12.

| Contract | Implemented behavior |
| --- | --- |
| [BUD-01](https://github.com/hzrd149/blossom/blob/b5bd2801d1763aa635fc8fea7a76597e0eb18990/buds/01.md) | Root `GET/HEAD /<sha256>[.extension]`, CORS and OPTIONS, stored MIME with `nosniff`, ETag, single byte ranges including suffix ranges and If-Range |
| [BUD-02](https://github.com/hzrd149/blossom/blob/b5bd2801d1763aa635fc8fea7a76597e0eb18990/buds/02.md) | Signed `PUT /upload`, streamed SHA-256 verification, 201 for a new blob and 200 for an existing one; descriptor includes an extension-bearing URL, hash, byte length, MIME and upload timestamp |
| [BUD-06](https://github.com/hzrd149/blossom/blob/b5bd2801d1763aa635fc8fea7a76597e0eb18990/buds/06.md) | Optional `HEAD /upload` admission check using X-SHA-256, X-Content-Type and X-Content-Length; PUT works without a preceding HEAD |
| [BUD-11](https://github.com/hzrd149/blossom/blob/b5bd2801d1763aa635fc8fea7a76597e0eb18990/buds/11.md) | Verified kind-24242 events with readable content, past creation, future expiration, matching action and blob hashes; optional domain-only server scopes checked against configured origin |
| [BUD-12](https://github.com/hzrd149/blossom/blob/b5bd2801d1763aa635fc8fea7a76597e0eb18990/buds/12.md) | Owner-authorized `DELETE /<sha256>` and `GET /list/<pubkey>?limit=100&cursor=<last-hash>`; descending upload time and deterministic hash order for ties |

Our upload policy requires Content-Length and X-SHA-256. A missing MIME defaults to `application/octet-stream`; a supplied MIME is normalized, stored and reused regardless of the requested extension. This is not a media-inspection or transcoding service. Multi-range requests return 416; deprecated list `since`/`until` filters are not implemented. Mirroring, optimization, server discovery announcements and paid storage are outside this slice.

The shared uploader uses an Applesauce signer, emits base64url authorization scoped to one server/action/hash for five minutes, verifies the returned descriptor, then downloads from the configured upload origin and checks the exact hash. It never follows redirects or a server-provided descriptor URL. A descriptor may legitimately advertise a separate CDN/public origin. Server authorization also accepts canonical legacy base64 for older clients. Valid authorizations without `server` tags retain their standard unscoped meaning.

## Storage and ownership

`blobs/<sha256>` holds committed bytes. `index.sqlite` and its WAL hold descriptors and uploader claims. `incoming/<uuid>.part` holds in-flight uploads. A separate `process.sqlite` transaction prevents two service processes from opening the same data directory; the OS releases that lock after a crash.

An upload streams into a private temporary file, checks length and hash, syncs the file, then enters a serialized commit queue. That queue rechecks quotas, renames the verified file, syncs its directory, and commits the descriptor/claim with SQLite synchronous FULL. The response is sent after commit. Startup removes interrupted temporary files and unreferenced hash files left between disk and metadata commits. Missing files return 404; an exact re-upload repairs them. Clients still verify hashes on download, including against later disk corruption.

Identical bytes have one stored descriptor and can have several uploader claims. Deletion removes the signer's claim; bytes remain while another uploader has a claim. The last deletion removes both metadata and bytes. An uploader cannot delete somebody else's claim. Listing is private to the signing uploader and requires pagination; a stale or unknown cursor returns 400.

Current per-service defaults:

- 50 MiB per blob, 2 GiB total committed bytes, 10,000 distinct blobs.
- 256 MiB and 1,000 claims per uploader; 100,000 total claims. Shared bytes count toward each owner's allowance.
- Four concurrent streamed uploads, a 20-second body deadline, and 600 signed upload/list/delete admission attempts per minute across the service.
- One PM2 process, 512 MiB memory restart threshold and 15-second shutdown allowance.

These are bounded initial operator policies, not sybil-resistant moderation. Temp-file space is additional to the committed-byte quota. Limits are defined in the server configuration; deployment currently uses these defaults. Back up the complete data directory with the service stopped or a coordinated filesystem snapshot, including SQLite WAL state. Copying only the main SQLite file while live is insufficient. There is no automatic retention, migration/rollback of data schemas, replication or production backup scheduler yet.

## Local use and VPS wiring

```sh
bun run dev                      # web HMR, relay and Blossom
PORT=3020 bun run dev:prod publicdev # production web build, Caddy, relay and Blossom
bun run blossom:seed             # verify/repair the six local HTML blobs
bun run dev:doctor
```

The direct local origin is `http://127.0.0.1:19348`. In dev:prod, Caddy also serves the same root endpoints at `http://127.0.0.1:8081`, separate from the website at `http://localhost:8080`. Descriptors keep the direct loopback origin so they work in HMR mode too. This is the explicit local HTTP profile; the VPS advertises HTTPS. Runtime fetching of arbitrary public napplets continues to reject private networks; the local upload helper's exception does not relax that policy.

Data lives under `.local/services/blossom`, outside builds. Dev startup verifies fixture signatures and hashes, checks signed ownership listing, then downloads/hash-checks each existing blob. It uploads only missing, damaged or unowned blobs, through the shared uploader with the public fixture key. A warm six-blob check performs no disk rewrites. Publicdev never supplies fixture write targets; the seeder accepts only literal loopback HTTP origins. No fixtures are seeded during VPS deployment.

```sh
bun run deploy --host root@your-vps --domain napplet.example
# Optional separate content hostname:
bun run deploy --host root@your-vps --domain napplet.example --blossom-domain files.example
```

Point both DNS names at the VPS. Blossom defaults to `blossom.<website-domain>` and cannot share the website hostname. Caddy owns the root of that hostname and proxies to loopback 19348. Blob responses include CORS, a restrictive sandbox CSP and `nosniff`; active documents are attachments. Napplet execution still occurs through the verified iframe runtime. There is no cookie/session authentication on the blob service.

The VPS build creates `bin/blossom.js` and its build marker in each release. PM2 runs it with data at `/var/lib/napplet-space/blossom`; health reports the build and instance. Activation checks this identity, and rollback restores the previous executable without replacing stored data. Local and VPS builds use the same entrypoint, PM2 definition and pinned Bun version. Configuration is passed through `SPACE_BLOSSOM_ORIGIN`, `SPACE_BLOSSOM_DATA`, `SPACE_BLOSSOM_PORT`, `SPACE_BLOSSOM_INSTANCE` and the explicit local-only `SPACE_BLOSSOM_LOCAL=1` flag.

## Verification and remaining publishing work

`bun run test:blossom` exercises actual HTTP requests, signed authorization failures, hash mismatches, shared ownership/deletion, cursors, ranges, quotas under concurrency, idempotent seeding, damaged-file repair, and process locking. A standalone bundled process survives both SIGTERM and SIGKILL with acknowledged bytes and claims intact. A separate local Khatru process accepts a signed NIP-5D manifest; Applesauce discovers it and its standard `server` hint resolves the independently hash-verified blob.

The shared uploader additionally rejects inconsistent descriptors, changed download bytes and redirects. Full application checks and the local PM2/Caddy stack are exercised alongside this service. No VPS, certificate issuance, physical power failure or full-disk recovery has been tested.

For the opt-in browser check, run `TEST_BLOSSOM=1 TEST_ORIGIN=http://localhost:8080 bunx playwright test tests/browser/blossom.spec.ts` against dev:prod. It uploads a temporary signed blob from the website origin through Caddy, hash-checks its bytes, checks a range read and deletes it; existing local fixtures remain intact.

This supplies the storage boundary for publication. The normal fixture relay manifests still omit live service hints, and the website still reads its existing fixture/publicdev catalogs. GRASP/ngit source provisioning, creator identity, the CLI publish journal, public relay publication and persistent website indexing/naming must connect those pieces before we claim an independent-client publishing flow.
