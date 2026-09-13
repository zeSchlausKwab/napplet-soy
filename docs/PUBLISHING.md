# Publishing a creation

The CLI connects creator accounts, Git/GRASP, Blossom and NIP-5D publication, with a durable retry journal. The website's [persistent relay index](INDEXING.md) now confirms address and snapshot routes. A confirmed publication returns `indexed`, `websiteReady: true` and a check timestamp; a website that is unavailable or still catching up leaves the successful relay publication at `announced_pending_index`. Authenticated named-route claims remain ahead.

## Commands available from this checkout

```sh
bun run napplet publish --project /path/to/my-experiment --network local --dry-run
bun run napplet publish --project /path/to/my-experiment --network local
bun run napplet status --project /path/to/my-experiment --network local
bun run napplet publish --project /path/to/my-experiment --network local --resume
```

Start the platform services with `bun run dev` or `bun run dev:prod`. Set up/select an account in the matching network profile. Install the sandbox-check browser once with `bunx playwright install chromium` in this checkout. The CLI still runs from the platform checkout; there is no public installer or globally installed binary yet.

`--dry-run` prints the exact selected files, source size, creator, identifier, artifact hash and resolved service destinations. It does not open a signer, run code, contact a service, create a journal, or commit source. It lists remote and browser checks still required. `status` reads the local journal only; it does not claim to observe the current remote state. `--json` writes one structured result to stdout; publication errors include `code`, `message`, `stage` and `retryable`.

An ordinary `publish` checks the current project. If a different unfinished release exists, it stops and explains `--resume`. Explicit resume finishes the saved bytes and metadata even while the editor contains newer changes. Publish again afterward to release the newer revision. There is no implicit retargeting, discard, force-overwrite, or rollback command.

## Destinations and identity

| Profile | Primary relay | Blossom | GRASP | Website route origin |
| --- | --- | --- | --- | --- |
| local | `ws://127.0.0.1:19347/relay` | `http://127.0.0.1:8081` | `http://127.0.0.1:8082` | `http://localhost:8080` |
| public | `wss://napplet.space/relay` | `https://blossom.napplet.space` | `https://git.napplet.space` | `https://napplet.space` |

Public defaults describe the intended deployment; they have not been deployed or tested here. Public mode additionally mirrors manifests to `wss://relay.damus.io` and `wss://nos.lol`. Local mode has no public mirrors or fallback. This implementation was verified exclusively against isolated local services, with no public event writes.

Override destinations with `--relay`, `--blossom`, `--grasp`, `--site` and repeated `--mirror`. Alternatively put `relay`, `blossom`, `grasp`, `site` and `mirrors` in `napplet.json.publish`; an empty `mirrors` array disables mirrors. Flags take precedence over project settings and defaults. Persist custom defaults in the project if subsequent ordinary publishes should use them without flags. `--resume` uses the journal's original destinations; conflicting overrides are rejected.

Public endpoints require HTTPS/WSS without credentials, query strings or fragments; service origins have no path. Literal private IPs and localhost/local names are rejected. Local service endpoints require literal-loopback HTTP/WS. The website link may use localhost. These CLI endpoints are operator/creator configuration, not URLs taken from untrusted gallery metadata; DNS pinning against rebinding is implemented in the gallery downloader, not this publisher.

An existing project `creator` must match the selected account and network. No credentials are selected from a project's public key. A missing creator reference uses the selected account. Each generated identifier is stable and independent of its title; older starter projects derive a stable 13-character identifier from their existing `previewId`. Changing the identity or service destinations of a published project requires a separate project. Restoring a lost journal is required to continue an existing remote identity safely; automatic adoption and remix remain ahead.

## Source and sandbox checks

The default public file set is `index.html`, `napplet.json`, `LICENSE`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `dev.ts`, `package.json`, `.gitignore`, and the three bundled `.napplet` preview files. Missing optional files are omitted. `publish.files` can specify up to 128 explicit relative files; HTML, configuration and license are always required. Paths cannot contain whitespace/traversal or symlinks. The complete selected source is limited to 40 MiB; HTML is limited to 10 MiB and must be nonempty UTF-8. A nonempty license file is required. Unsupported mandatory NAP domains are rejected.

The publisher rejects credential filenames, Git internals, dependency folders, `.env` files, Git attribute/module files and several recognizable credential formats. These checks reduce accidental disclosure; they do not prove the source contains no secrets. Dry-run and the interactive publication summary make the scope reviewable. Nothing invokes project build scripts, package lifecycle commands or Git hooks.

Source is copied into a dedicated release repository under the ignored `.napplet-space` directory. Each release commit descends from the prior published commit and retains its release tag. The ordinary working repository and its index are untouched; unrelated branches, unselected files and earlier private commits are not pushed. This intentionally revises the original proposal to commit the whole local working repository. Extra source files must be selected explicitly. Automatic preservation of an arbitrary repository's history is not implemented.

The browser check runs the frozen HTML under our current shared host, CSP, opaque iframe sandbox and shim. It checks startup, the shell handshake, script errors and CSP violations, while blocking external network requests. It does not use an inherited preview server or modified runtime bundle. This is a startup smoke check, not comprehensive gameplay, performance, NAP, or external-service conformance testing. The compiler runs in a fresh Bun process to avoid the pinned runtime's known build/read issue after networking. The check report records the runtime profile and browser version.

The archive is Git's tar of the exact frozen commit and contains the selected regular files. In this profile the playable artifact is directly the archived `index.html`; no build-derived source association is claimed for arbitrary toolchains. Both tar and HTML are uploaded to Blossom and independently retrieved/hash-checked.

## Journal and retry behavior

`.napplet-space/<network>/index.json` selects the pending/latest job. Each job directory stores its public plan, source repository, archive, signed events, checks and receipts. The journal has a schema and content fingerprints. An exclusive SQLite lock covers the project across processes and network profiles; OS process exit releases it. Atomic JSON replacement and fsync preserve completed checkpoints. Native Git objects and source files are also retained locally. Keep this directory when moving to another machine: dropping it loses the retry/concurrency history.

1. Inspect the source and selected identity. Query the newest remote current manifest and Git announcement/state with an explicit completed relay query.
2. Run the sandbox check; reject edits made during that check. Freeze the file set, commit and source archive.
3. Persist the job, then signed Git authorization and snapshot/current events before sending any of them.
4. Publish Git source and all retained release refs, using a lease on the main branch. Verify Git refs and signed source metadata.
5. Check Blossom ownership and bytes. Reuse verified owned blobs; otherwise issue a scoped signed upload and independently verify retrieval.
6. Publish the snapshot first, then the current manifest. Require each event to be queryable. A lost acknowledgement leaves the same signed event available for retry.
7. Attempt optional mirrors, then check the website's exact current/snapshot projection and verified artifact. Save confirmed or pending website status without changing the signed publication.

Repeating the same release rechecks storage/relay evidence, repairs missing blobs/events and retries unavailable mirrors without creating another snapshot or source commit. `unchanged` means the release identity and bytes were reused, even if missing remote data needed repair. A change in source, title, topics or required domains creates a new release; identical HTML alone does not make metadata changes a no-op.

Checks before and after remote stages reject unknown competing current or source events. Timestamps increase monotonically with a bounded clock-skew check. A Git lease protects the branch update. Nostr relays do not provide a distributed compare-and-swap transaction: a concurrent event can still arrive between checks. The CLI detects an observed conflict and stops instead of claiming it can roll back already-public events. There is no automatic destructive conflict override.

Source state retains at most 128 release refs in this initial adapter. Reaching that limit stops without deleting refs; a scalable retention policy is future work. Optional mirrors may be offline while primary publication succeeds. Stored receipts are observations, not promises of permanent hosting. Back up the journal and creator recovery material separately.

## Protocol output

Publication uses the authoritative [pinned NIP-5D proposal](https://github.com/dskvr/nips/blob/24711d9c47bbdd07908bf1d52bf677d9cbc530f0/5D.md), the [NIP-5A manifest tag schema](https://github.com/nostr-protocol/nips/blob/master/5A.md), and [NIP-34 Git URLs/state](https://github.com/nostr-protocol/nips/blob/master/34.md). Named current events are kind 35129, snapshots are kind 5129 without a `d` tag, and both carry the same single `/index.html` mapping, aggregate, server hints, title/description, required domains and optional topic hashtags. Snapshot `a` references its own napplet address. `source` is an ordinary `nostr://` repository URL.

Two optional provenance tags, `source-commit` and `source-archive`, carry the exact Git commit and content-addressed source tar URL. These are Space publishing conventions, not NIP-5D requirements. Clients may ignore them; ordinary `source`, manifest and Blossom discovery still work. There is no mandatory descriptor, branded hashtag or current-to-snapshot pointer. Automatic screenshot/video upload and linked descriptor authoring remain ahead; the existing reader continues to accept other clients' optional preview metadata.

## Verification

```sh
bun run check
bun run test:publish
# Optional native OS store test: creates and deletes its own temporary credential IDs.
bun run test:publish:native
```

The deterministic tests cover interrupted uploads, lost relay acknowledgements, unchanged retries, metadata-only updates, modified working/frozen source, forged saved signatures, competing remote versions, concurrent processes, identity/target isolation, failed mirrors and repair of missing data. Native service tests use the actual Khatru/GRASP/Blossom implementations, the browser check, an independent Nostr wire reader, tar extraction and independent Git clone/fetch. An opt-in test drives the real CLI across processes with temporary native Keychain credentials.

Still ahead: persistent website ingestion and confirmed playable links, authenticated names, public installer, automatic media descriptors, remix, additional build profiles, explicit journal adoption/conflict recovery, Linux/Windows native keystore acceptance, and publication/discovery in an external public client. No VPS or public hosting verification is claimed.
