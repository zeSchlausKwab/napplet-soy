# Git source hosting

The source service runs **ngit-grasp v3.0.2**, with Git smart HTTP and a Nostr relay at the same root origin. Its authority is signed NIP-34 repository metadata and state, using the upstream GRASP protocol. A Git HTTP request alone cannot authorize a new branch tip. Anyone can clone public source.

## Reviewed upstream

[`services/grasp/upstream.json`](../services/grasp/upstream.json) pins release commit `cdda4a23fe5dede2411e18aaa8b82c1747c97ddf`, the Cargo lockfile digest, Rust 1.97.1, and the reviewed GRASP specification commit. The release was resolved from the maintainer's signature-verified kind-30618 event `c3db2b89615bb51246ae78355cf1021437b5b7df344a1fe269f6c598f7bcabe4` on `wss://relay.ngit.dev`. The maintainer's pubkey is recorded in the pin. The build fetches the [upstream Git repository](https://relay.ngit.dev/npub15qydau2hjma6ngxkl2cyar74wzyjshvl65za5k5rl69264ar2exs5cyejr/ngit-grasp.git), verifies the commit and lockfile, then builds with `cargo --locked`.

The deployment build makes three checksum-guarded changes: lock the working directory against a second writer; add a local profile that ignores inherited operator credentials/dotenv and restricts event-directed connections to literal loopback; and identify the guarded build in NIP-11. Protocol admission and Git authorization remain upstream code. A changed upstream source file makes the patches fail closed. NIP-11 reports `3.0.2-cdda4a23+space.<build-id>`.

See the [GRASP protocol](https://ngit.dev/protocol/grasp) and [NIP-34](https://github.com/nostr-protocol/nips/blob/master/34.md). This service is separate from the Khatru gallery/social relay because GRASP couples Git availability to repository-event admission.

## Source publication adapter

`packages/grasp/src/client.ts` uses an Applesauce-compatible signer. It prepares a kind-30617 announcement with the repository identifier, HTTPS clone URL, relay URL and earliest unique commit, followed by kind-30618 authorizing a commit at `refs/heads/main`. Metadata is signed and checked before network activity. The adapter accepts a committed, clean repository with one root and publishes its selected commit as `main`; multi-branch/tag management is left to a full ngit client.

Publish those events to GRASP, push the authorized Git objects, then verify both relay events and the advertised branch tip. GRASP initially holds repository metadata in purgatory until the required objects exist. A successful relay acknowledgement alone is insufficient. The adapter supports retrying the same signed publication; it does not re-sign on retry. Private keys never go to the Git subprocess.

`scripts/grasp.ts` exercises this path for the six local examples, storing a public retry journal outside each source repository. Unchanged seeds verify existing events and Git refs without new commits or publications. These repositories currently demonstrate the source component; catalog manifests and the creator CLI are not yet wired into a complete source/Blossom/release publication transaction.

## Verification

`bun test tests/services/grasp.test.ts` starts the actual pinned native service in a temporary directory. It checks signed creation and updates, independent Git cloning, refusal of unauthorized tips and forged signatures, idempotent fixture seeding, exclusive process ownership, and recovery after graceful termination and SIGKILL. Local mode generates its own private operator key even when production credentials are present in the parent environment. The tests do not publish to public relays.

## Operations

Keep the entire working directory together: Git storage, relay LMDB, `.relay-owner.nsec`, migration/checkpoint files and the process lock all belong to this service. The key is generated with mode 0600. Stop the service before copying the state for backup; preserve permissions. Never place service keys in the source tree, release archive, PM2 arguments or logs.

ngit-grasp 3.x has storage migrations. A binary rollback is not a database downgrade. Before changing the pinned upstream version, stop writes and back up the complete state; rehearse migration and restore on a copy. Monitor disk usage: request/pack limits are not a total storage quota. Peer synchronization, Git object expansion and repeated public repositories also consume storage. This integration does not yet provide operator quotas or abuse-management tools.

Local builds require Git, a C compiler and Rust 1.97.1 on PATH; Linux also needs `pkg-config` and OpenSSL development headers. Build artifacts and dependencies are cached under `.local/grasp-build`. No VPS deployment has been executed yet.
