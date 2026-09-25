# Dynamic backends

`soy.backends.v1` adds creator-defined persistent rules over the existing NAP-CVM
transport. It is implemented in the shell, soyLI and provider, with a separately
qualified Linux deployment path. Hosting is available only to admitted creators.
A website/CLI release alone does not admit public code execution. The operator must
explicitly enable this service and admit creator accounts and Git source origins.
Administrators then manage additional creator grants in `/admin` → **Backend slots**.
No CEP is being proposed; that decision remains deferred. Upstream pins are unchanged.

For authoring, see [the creator guide](DYNAMIC-BACKENDS-CREATOR.md). Fresh projects
receive it as `docs/napplet-dynamic-backends.md`, the `soy-backends` skill for both
agent directories, the optional frontend helper and MiniCraft handler/schema example.
Existing projects get managed guidance with `soyli skills update`; edited files are
preserved and reported. `backend init-module` creates a counter, not a required game.

The [playable MiniCraft demo](../packages/dynamic-backends/demo/README.md) runs with
`bun run demo:minicraft`. It is a separate local preview, not a public gallery entry.
The game uses ordinary creator-defined rules; no special world logic lives in the
provider. Preview persists under the project's `.napplet-space/backend/` and never
silently promotes local worlds into production.

## Execution and provenance

The initial `soy-ts-quickjs-v1` profile accepts one self-contained TypeScript handler,
a manifest and bounded JSON schemas. Bun transpiles the source on the provider.
The artifact is JavaScript executed inside pinned QuickJS 0.31.0 WebAssembly, not a
standalone uploaded WASM binary. There are no imports, npm installs, creator build
scripts, timers, network, filesystem, raw SQL or background jobs. Frontend Rust/WASM
support is separate; Rust/Extism backend plugins are not implemented.

Each release receipt binds the Git commit, selected file hashes, compiler/runtime
versions, artifact, schemas, execution policy and isolation profile. Existing worlds
remain pinned when a creator activates a new release. There is no automatic migration.
The provider signature attests what it built; it is not cryptographic proof that a
provider executes honestly. Local same-machine repeat builds are tested; independent
cross-toolchain reproducibility is not claimed.

Public source acquisition uses bounded Git smart HTTP: approved HTTPS origin,
author-qualified GRASP path, exact advertised/reachable commit, no redirect or private
DNS destination, at most 1 MiB ref advertisement and 16 MiB pack, 30-second download
lifetime. The current fetch includes reachable history; a large repository can exceed
this budget even if its handler is small. Only manifest/handler/schema regular files
enter compilation. Offline Git validates and reads the pack in a separate sandbox;
there is no checkout, credential helper, hook, submodule or networked Git process.
The baseline Bun runtime uses a bundled Node HTTPS worker to retain guarded DNS and
normal certificate/SNI verification.

The Linux profile uses root-owned bubblewrap, private user/PID/network/IPC/UTS/cgroup
namespaces, no capabilities or nested user namespaces, readonly runtime/system tools,
128 MiB private scratch space and no mounted service credentials, database or checkout.
Workers communicate through bounded JSON lines; only scoped state calls reach the
provider. Each worker gets a fresh cgroup: 256 MiB memory, no swap, 32 tasks and one
CPU. The whole CVM service is capped at 1 GiB, 128 tasks and two CPUs. At most two
invocations and one build run at once in the public profile. The QuickJS heap remains
16 MiB with a 500 ms interrupt deadline; an outer five-second process deadline also
applies. Source decoding has a separate 30-second deadline. Failed/aborted workers and
their descendants are killed and reaped. These are enforced limits, not throughput
promises or certification against every kernel/runtime vulnerability.

State transactions validate input, stored records and output; failures commit nothing.
Concurrent operations use instance-wide revision checks. Exact retry receipts expire
within five minutes. Schemas/ACLs bind identity to signed account proofs, never an
input-provided role. Public player-created tracks/drawings still normally use NIP-78;
fast gameplay traffic belongs on WebRTC. Private worlds are access-controlled at the
provider, not end-to-end encrypted against its operator.

## Operator rollout

Dynamic hosting defaults off. On the existing Ubuntu 24.04/systemd deployment, add
public configuration to the private `/opt/napplet-space/shared/server.env`:

```sh
SPACE_DYNAMIC_ENABLED=1
SPACE_DYNAMIC_CREATORS=<comma-separated-admitted-creator-hex-pubkeys>
SPACE_DYNAMIC_SOURCE_ORIGINS=https://git.napplet.soy
```

Use real values without angle brackets. Admission applies to the verified creator
account, not the player's session key. Grants are reloaded from the signed admin policy without restart. Operator
grants from `SPACE_DYNAMIC_CREATORS` are protected in the UI. Existing authors
retain disable/delete controls when removed from deployment admission, while new
builds, activation and re-enabling are denied. Existing worlds keep running. Players follow their instance ACL and operation
schemas. Eight modules per creator, 32 releases/module and build/request quotas apply.
Live record storage is bounded provider-wide; stored artifacts have an additional
128 MiB provider allowance. These are operational limits, not billing or ownership of
client code. Other providers can choose their own limits.

The ordinary deployment command, when enabled, installs the distribution bubblewrap
package and a dedicated root-owned `/opt/napplet-space/tools/soy-bwrap`. Ubuntu receives
an AppArmor user-namespace exception **only for that executable**; the global restriction
is unchanged. Worker bundles are built from the release, then isolated runtime and
backup/restore tests run before switching live services. Public startup fails closed
if namespace, cgroup or admission configuration is missing.

The enabled CVM runs as `napplet-cvm.service`, separate from PM2, with delegated
per-worker cgroups and a supervisor subgroup. Its environment contains only explicit
CVM configuration. The service can write its CVM state directory; workers cannot see
that directory. A release-local marker makes rollback select systemd or legacy PM2
appropriately. A disabled release continues using PM2. Health checks require the
advertised family, Linux isolation profile and explicit admission mode.

Useful operator checks:

```sh
systemctl status napplet-cvm.service
journalctl -u napplet-cvm.service -n 80 --no-pager
systemctl show napplet-cvm.service -p MemoryCurrent -p MemoryPeak -p TasksCurrent
```

`backup.sh` stops/drains the selected CVM manager before copying SQLite and resumes
it afterwards. Existing backup tooling includes the identity and dynamic database in
`state/cvm`; restore into a new directory first. Preserve the provider identity,
source/build receipts and old pinned releases with world data. Do not restore a database
while a service is using it, or silently replace the current state. Restoring an older
backup can roll back acknowledged operations and expired retry receipts; coordinate
recovery with users before retrying mutations.

## Verification and remaining scope

The Linux qualification test is opt-in (`SPACE_TEST_BACKEND_SANDBOX=1`) and must run
inside the same delegated service limits with `SPACE_DYNAMIC_BUNDLE_DIR` pointing to
`scripts/backend-workers.ts` output. It tests forbidden host access/network, compilation,
CPU/memory exhaustion and recovery, offline real Git pack decoding, world persistence,
exact retry after restore and signed release pins through `backup-data.py`. Normal
unit tests cover schemas, author/session proofs, ACLs, conflicts, rollback, deletion,
revocation, source HTTP bounds and packaged CLI guidance. Skipped Linux tests on a Mac
are not evidence of Linux qualification.

On 2026-09-25, all three Linux qualification tests passed on the deployment VPS's
baseline Bun 1.3.8 under the intended cgroup and filesystem restrictions, including
encrypted provider startup and denied admission. An independent creator built a
shared garden using only the packaged soyLI and shipped materials: two-player edits,
permissions, conflicts, exact retry after a lost response and full preview restart
passed. Touch emulation passed; no physical-phone or public deployment is claimed.
The project check passed 414 tests; production web build and native darwin-arm64
soyLI scaffolding/module compilation passed. This evidence supports a controlled,
admitted rollout, not unrestricted arbitrary-code hosting.

Still outside this slice: automatic migrations, exports, instance discovery/management
GUI, backend source watching, coordinated frontend/backend releases, background jobs,
streaming simulation and additional build profiles. Physical mobile/LAN acceptance
and full public operator rollout remain distinct from local/browser tests.
Recovering an unknown instance after all creation replies are lost and its retry
window expires also requires a future instance-discovery flow.
