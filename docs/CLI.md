# Creator CLI — proposed v1 behavior

Status: product/engineering proposal, updated 2026-09-13. Local `new` scaffolding, shared NAP preview, OS-backed creator accounts, NIP-46 bunker connections and encrypted recovery are implemented. The public installer and resumable publishing workflow below remain planned. `napplet-space` is a working command name, avoiding collision with the existing upstream `napplet` binary.

Interoperability is a release requirement: publish ordinary NIP-5D manifests with public Blossom `server` hints, a standard `source` reference, and required NAP domains to publicly reachable relays. Use a real creator identity, never the bundled test key. Our own relay is a publication destination, not a requirement that other clients call the Space API. Publish to interoperable default discovery relays too, and include relay hints in portable links. Optional cover/source details and website aliases must not be required to discover or run the napplet. See [PROTOCOL.md](PROTOCOL.md).

## Available today

From this checkout, run `bun run napplet new my-experiment`, then `cd my-experiment` and `bun run dev`. The generated project works independently with Bun and Git, without installing dependencies or starting the platform backend.

The preview bundles the shared verified `srcdoc` loader, pinned shim, mandatory NAP-SHELL handshake, and host services. Await `napplet.shell.ready()` before host calls. Editable project settings include `requires` for mandatory domains, `relays` for allowed read connections, and `servers` for Blossom resource hints. They default to empty arrays. Browser-extension connection, account change notifications, scoped saves, virtual file downloads and mediated resources work locally; signing and publishing remain disabled by the playback policy.

The random `previewId` is a local storage namespace, not a creator public key or manifest. Editable local bytes are hash-checked in the browser; signature admission applies to published manifests. Already-generated projects retain their bundled runtime and are not automatically upgraded.

Creator accounts are available through `account create`, `show`, `list`, `use`, `check`, `connect`, `import`, and `export`. Interactive `new` offers setup when no account is selected; existing selection is reused without opening the keystore or contacting a remote signer during scaffolding. Noninteractive `new` leaves setup for later unless `--identity create` is explicit. `--identity later` also bypasses account metadata. Only `{pubkey, network}` is written into `napplet.json`; this reference is not permission to sign as a cloned project's author. The preview's browser-extension connection remains separate from the publishing signer.

Use `--network local` for separate account metadata and keychain credentials; its bunker transport accepts only literal-loopback WS destinations. Default public mode accepts WSS signer relays. `account connect` accepts a bunker URL at a hidden prompt; `account import` accepts an nsec or encrypted NIP-49 key. Explicit stdin options support automation without putting secrets in argv. `--json` returns public account data or an error with `code` and `message`. Detailed storage, recovery, tests and current limits: [IDENTITY.md](IDENTITY.md).

## 1. The quick path

Proposed first-use command:

```sh
curl -fsSL https://napplet.space/install.sh | sh -s -- new plasma-pet
```

The installer verifies and installs a platform-specific CLI, then creates the project with working defaults. Afterward:

```sh
cd plasma-pet
napplet-space dev
# Use your existing AI coding tool in this directory.
napplet-space publish
```

For an installed CLI, the entry point is simply `napplet-space new plasma-pet`. A future `--agent <installed-tool>` option can launch the user's chosen tool with the project as its working directory. No provider API key or new model subscription is needed.

The install/create command should open the first preview and print the exact project path and next command. A child process cannot change the caller's shell directory, so the UX must not pretend the `cd` happened automatically. If the installer reads script text from stdin, intentional prompts must use the controlling terminal; noninteractive invocation uses explicit options and structured errors.

This creator preview remains lightweight. Platform contributors use `bun run dev` and the Caddy/PM2 production-build mode `bun run dev:prod`; both now include the managed relay, Blossom and GRASP services. See [LOCAL-DEVELOPMENT.md](LOCAL-DEVELOPMENT.md).

## 2. Bootstrap contract

`new` performs the following with bundled defaults:

1. Choose a destination without overwriting an existing directory. Derive a display title and generate a collision-resistant public identifier.
2. Select the existing creator identity, or offer creator setup. `--identity create|connect|later` controls setup; `account use <npub-or-account-id>` selects a previously stored signer. A supplied `npub` alone is insufficient to publish.
3. Materialize a pinned maintained template, initialize Git, and write a normal initial source commit. New projects start a new Git history; the template revision is recorded as provenance. A remix preserves source history and ancestry.
4. Install pinned project dependencies with the supported toolchain. Configure all service endpoints, source-repository naming, and tool references without a relay-selection wizard.
5. Install matching upstream napplet skills plus a short Space-specific workflow guide, using the requested agent target or a portable `AGENTS.md` default. Include examples for drawing, input, audio, saving state, checking, and publishing.
6. Run a cheap boot check, open the shared local host, and print the path and next command. A cached template can still be created when hosting services are unavailable; publication remains a later operation.

The initial template should be a small, working Vite/TypeScript canvas creation. Offer curated `canvas`, `webgl`, and `react` presets as they are tested. React is appropriate for the gallery and UI-heavy napplets; it need not be mandatory for every minigame. Each preset contains the libraries it needs, rather than installing every graphics engine in every project.

Use Bun to install/run our tested templates, but reconcile the upstream template's pnpm scripts and lockfile deliberately. Do not swap package managers in an untested checkout and assume it works.

## 3. Dependency and platform policy

Our orchestration CLI can be a [Bun-compiled executable](https://bun.sh/docs/bundler/executables). This removes a runtime requirement for executing that CLI; it does not magically supply Git, a package manager for the generated project, the upstream napplet binary, ngit, or a browser conformance runner.

Distribute a versioned toolchain manifest. Install supported missing user-space tools to a managed location and invoke them by absolute path. Pin and verify tool downloads. Preserve existing user installations and Git settings. Git and its remote helper must both be discoverable in the CLI's child-process environment. System Git installation may require an OS interaction; test that path explicitly before advertising a fresh-machine setup guarantee.

Initial support target: macOS ARM64/x64 and Linux x64 with a supported desktop/key-store environment; Windows/WSL and other architectures become supported only after the same end-to-end checks pass. Provide a PowerShell installer when native Windows is supported. Cold browser-engine downloads must be visible in progress and cached between checks.

## 4. Project and account state

| Location | Contents | Commit? |
| --- | --- | --- |
| `.napplet/config.json` | Existing napplet deployment fields, service defaults, public signer reference | Yes, portable nonsecret fields only |
| `napplet.space.json` | Optional presentation, source license, template revision, remix ancestry | Yes; not a runtime requirement |
| `bun.lock` and `package.json` | Dependencies and standard development scripts | Yes |
| `LICENSE`, `ASSETS.md` | Source license and asset attribution | Yes |
| `.napplet-space/` | Local deployment journal, receipts, source/build fingerprints, cached progress | No |
| User config / OS key store | Selected identity, credentials, machine-specific tool paths | No; outside the project |

Do not make users maintain the same title, capabilities, and service configuration in multiple files. Derive the release descriptor from these authoritative project fields and the build results. Validate schema versions and migrations.

Configuration precedence is explicit flags, project configuration, user preferences, then bundled defaults. Public-service discovery can update recommendations but must not silently rewrite the target hosts of an in-progress publication. A cloned project's signer reference never authorizes use of another creator's key; remix explicitly selects the current user's identity.

Platform testing uses an explicit `--network local` profile with separate credentials, defaults, and deployment journals. Selecting that profile substitutes all network-specific defaults before explicit endpoint overrides are applied and validated. A job records its resolved environment and destinations; a later command cannot resume it against production by changing a default. Public-facing commands must reject accidental local fixture identities/targets, and local mode must not silently fall back to public services.

## 5. Commands

| Command | Behavior |
| --- | --- |
| `new [directory] [--template canvas]` | Create an editable project with defaults; no public repository yet |
| `dev` | Build/watch and load through the same constrained host used on the site |
| `check` | Type/build checks, profile validation, conformance, size and packaging checks |
| `publish [--dry-run] [--json]` | Prepare source and execute/resume the release workflow; dry-run plans without signing or network writes |
| `status [--json]` | Explain the current local publication and required recovery work |
| `remix <release-or-napplet-url> [directory]` | Resolve, inspect, and fork exact source into a new project |
| `account connect` / `account export` | Pair an existing signer or deliberately export a recovery secret |
| `doctor [--json]` | Diagnose tools, key-store availability, host reachability, and protocol compatibility |

Use stable JSON objects on stdout and progress on stderr. Every failure has a machine-readable code, stage, retryability flag, and human explanation. Agents should not parse spinner text. Avoid storing raw secrets in output, crash reports, command arguments, or child-process environments. Export is an explicit operation with a deliberate destination, never part of routine diagnostics.

## 6. Publish state machine

Persist a job keyed by creator, napplet address, source revision, full release-descriptor fingerprint, and manifest policy fields including required capabilities. An unchanged completed job is a no-op; a metadata or capability change can create a new release even when playable bytes are identical. Lock publication per project, check for newer remote state, and retain the exact signed events for safe retries.

| Stage | Work | Durable evidence / retry behavior |
| --- | --- | --- |
| Check | Validate identity, supported toolchain, inputs, license, service limits, latest remote state | Explain unsupported prerequisites before mutating remote state |
| Freeze source | Build an explicit source file set; reject included secrets; include accepted edits in a local release commit | Commit ID and file fingerprint; never blind `git add .` |
| Build and verify | Build that frozen source, check the profile, run browser conformance, choose/generate a cover, create source archive and descriptor | Fixed hashes and build report; a changed tree invalidates this stage |
| Ensure repository | Use ngit/NIP-34 and GRASP to announce/provision this creator's repository | Repository address and announcement receipt; recheck existing ownership on retry |
| Push source | Let ngit handle signed state events and Git pushes; retain a release ref | Fetch/verify the commit from the designated Git host; a state event alone is insufficient |
| Upload | Upload HTML, descriptor, cover, source archive, and any required source assets to Blossom | Hash/size-checked retrieval and per-server receipts; skip existing verified blobs |
| Snapshot | Sign/publish the immutable snapshot with the fixed metadata | Save signed event before sending; resend the same event after an uncertain response |
| Current | Sign/publish the standard addressable current manifest after the snapshot is available; no custom snapshot pointer required | Check accepted/retrievable state, timestamp ordering, and concurrent updates |
| Verify link | Wait for validated site resolution or return a bounded pending state | Exact public link, snapshot ID, source revision, mirror/index status |

Preparing a source archive and build must exclude account credentials, local journals, `.env` secrets, ignored cache directories, and unrelated files. Secret scanning reduces accidental exposure but does not prove their absence. Build commands receive no signing material; only the publishing layer can request signing.

Publication is itself the user's instruction to make the selected project public. Show a compact first-publish summary of identity, title, source scope, and license as part of that command; do not introduce a separate confirmation prompt for every service or event. If the source set contains a detected secret or identity conflict, stop with a concrete resolution instead of guessing.

Define success for the default service profile as a verified source commit, at least one complete retrievable blob set, snapshot/current events accepted and retrievable on the designated publication relay, and a site-resolvable release. Optional mirror failures produce a degraded-redundancy result. If site indexing is delayed, return `announced_pending_index` with the event IDs and recovery command; public events cannot be rolled back merely because a later step failed.

Use short-lived Blossom authorization scoped to the action, content hash, and intended server. A successful HEAD request proves neither blob integrity nor retention rights for a new uploader. Verify bytes and establish the release's storage ownership/pin even when a remix reuses an already-present hash.

After a release is resolvable, register/reuse the creator's default handle and this napplet's slug through the authenticated site API. Return a friendly `/@creator/slug` link, the portable `/n/<naddr>` link, and the pinned `/r/<snapshot>` link. Name collisions receive readable suffixes. Naming failure is independently retryable and does not turn a successful portable publication into a failed release or create another snapshot.

The upstream CLI already uploads before relay publication and accepts success when at least one server has the complete file set. Our additional work is durable recovery, source orchestration, descriptor preservation, designated-host checks, and honest product status. Do not bypass this work by wrapping a single `napplet deploy` subprocess and treating its exit code as complete product publication.

## 7. Remix contract

Resolve a normal napplet URL to a concrete snapshot before cloning. Verify the signed release and locate its exact source commit. Retrieve through the Nostr repository pointer and validate the commit; use the source archive as a documented recovery fallback, without claiming full Git history if it is unavailable.

Restore the original's source and dependency lockfile, preserve its license/credits, record the precise parent snapshot, create a new public identifier, and point publication at the remixing creator's repository. Keep an upstream reference for inspection, but never make an ordinary publish push to the original repository.

Remix content is untrusted. Clone/read first; avoid automatically executing inherited hooks or lifecycle scripts, and do not install another creator's agent instructions as trusted policy. Use the curated build recipe and agent guide for the supported profile. Projects requiring custom executable setup need an explicit trust step, so the instant path should keep that need rare. Native credential storage is not a sandbox against arbitrary processes running as the same OS user.

## 8. Signer adapter: mandatory early spike

Implemented checkpoint: the shared Applesauce adapter now signs directly for the GRASP and Blossom publication libraries and NIP-5D manifests. An isolated native-service test verifies all three with one reopened creator. Native macOS CLI reuse/recovery and an encrypted loopback NIP-46 provider are tested; Linux/Windows credential stores and external signer applications still need acceptance coverage. See [IDENTITY.md](IDENTITY.md).

The upstream napplet CLI and ngit both have local/remote signing support, but they do not automatically share a credential format or fallback policy. Prove one of these integration approaches in this order:

1. A shared compatible credential provider selected by public identity, with secure storage and no secret in project configuration.
2. An explicit signer interface available to the publish library and ngit through a supported or contributed adapter.
3. A narrowly scoped local signer bridge if upstream extension is required; document process lifetime, authorization, and recovery.

Do not use `--nsec <secret>` as the zero-configuration integration strategy. Do not build a general remote signer service merely to avoid understanding the existing tools. The acceptance criterion is the same identity completing source and artifact publication on every supported OS, including key-store unavailable and remote-signer-denied cases.

## 9. Server involvement

The browser IDE can later call the same publisher library from an isolated workspace. For v1, compilation and source preparation happen locally. Servers validate events/blobs and render previews; they do not execute repository build scripts or hold creator keys.

The API provides metadata queries, service limits, and publication status. A CLI hint that a release is ready can reduce index latency, but relay events remain independently ingestible. External hosting remains possible: discovery and playback use the same standard manifest, capability, and availability rules for all authors. A Space descriptor, source-host choice, or use of our CLI cannot be an admission requirement. Optional missing source metadata affects remix support only.

Test first publish, repeat publish, a partial upload, an acknowledged-but-disconnected relay, GRASP state arriving before Git objects, concurrent publication, stale timestamps, changing files during a build, missing source, and resuming after process termination. These failures define whether the simple command is actually dependable.

The publishing milestone is complete only after another client discovers and runs a CLI publication from public relays and Blossom without querying the Space API or understanding any additional metadata. Keep local fixture identity and endpoints out of this test; local seeding must never perform public writes.
