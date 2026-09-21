# Publishing a creation

The CLI connects creator accounts, Git/GRASP, Blossom and NIP-5D publication, with a durable retry journal. The website's [persistent relay index](INDEXING.md) now confirms address and snapshot routes. A confirmed publication returns `indexed`, `websiteReady: true` and a check timestamp; a website that is unavailable or still catching up leaves the successful relay publication at `announced_pending_index`. Authors can claim named routes on the napplet page after signing in with the publishing identity.

## Commands available from this checkout

```sh
bun run soyli publish --project /path/to/my-experiment --network local --dry-run
bun run soyli publish --project /path/to/my-experiment --network local
bun run soyli status --project /path/to/my-experiment --network local
bun run soyli publish --project /path/to/my-experiment --network local --resume
```

Start the platform services with `bun run dev` or `bun run dev:prod`. Set up/select an account in the matching network profile. Install the sandbox-check browser once with `bunx playwright install chromium` in this checkout. Creators can also use the standalone `soyli` executable and public installer; see the [CLI guide](CLI.md).

`--dry-run` prints the exact selected files, source size, creator, identifier, artifact hash and resolved service destinations. It does not open a signer, run code, contact a service, create a journal, or commit source. It lists remote and browser checks still required. `status` reads the local journal only; it does not claim to observe the current remote state. `--json` writes one structured result to stdout; publication errors include `code`, `message`, `stage` and `retryable`.

An ordinary `publish` checks the current project. If a different unfinished release exists, it stops and explains `--resume`. Explicit resume finishes the saved bytes and metadata even while the editor contains newer changes. Publish again afterward to release the newer revision. There is no implicit retargeting, discard, force-overwrite, or rollback command.

## Real Git history

Source is the actual committed working repository. Save a checkpoint with
`soyli checkpoint "Describe the change"` or ordinary Git before sharing. The CLI
requires a clean source tree and builds projects with `entry: dist/index.html`
before its sandbox check. Build output and screenshots are separate release inputs;
Git commits and authorship are preserved, and the source archive is that exact tree.

Code and the ancestry reachable from the pushed main/release refs are public and
open source by default. Other local branches are not pushed automatically. History
checks reject known credential paths/content, including deleted files still reachable
in history. These checks cannot prove an absence of secrets. Ignoring a file does not
remove a previously committed version. `publish.files` may include additional release
inputs, but no longer conceals tracked files or old commits from a Git publication.

The journal retains the committed source and frozen build inputs for retry; it does
not manufacture a separate release history. `source-commit` equals the real source
HEAD. Existing synthetic-history journals require explicit migration or a fresh
publication identity; automatic adoption/rewriting is not performed.

One remix can be published independently and proposed upstream in either order.
See [collaboration](COLLABORATION.md) for proposals, built review and maintainer actions.

## Destinations and identity

| Profile | Primary relay                | Blossom                       | GRASP                     | Website route origin    |
| ------- | ---------------------------- | ----------------------------- | ------------------------- | ----------------------- |
| local   | `ws://127.0.0.1:19347/relay` | `http://127.0.0.1:8081`       | `http://127.0.0.1:8082`   | `http://localhost:8080` |
| public  | `wss://relay.napplet.soy`    | `https://blossom.napplet.soy` | `https://git.napplet.soy` | `https://napplet.soy`   |

The managed public services are deployed at napplet.soy. Starting with the pending
soyLI 0.15.0 release, new public projects additionally mirror manifests to the five
external [shared relay defaults](RELAY-DEFAULTS.md): Damus, nos.lol, Primal,
nostr.mom and Pocketstr. Existing explicit project settings are preserved. Local
mode has no public mirrors or fallback. Automated publication tests use isolated
services; public deployment checks verify existing content without writing test
publications. See the dated verification records in [deployment](DEPLOYMENT.md).

Override destinations with `--relay`, `--blossom`, `--grasp`, `--site` and repeated `--mirror`. Alternatively put `relay`, `blossom`, `grasp`, `site` and `mirrors` in `.napplet-space/project.json` under `project.publish`; an empty `mirrors` array disables mirrors. Flags take precedence over project settings and defaults. Persist custom defaults in the project if subsequent ordinary publishes should use them without flags. `--resume` uses the journal's original destinations; conflicting overrides are rejected.

Public endpoints require HTTPS/WSS without credentials, query strings or fragments; service origins have no path. Literal private IPs and localhost/local names are rejected. Local service endpoints require literal-loopback HTTP/WS. The website link may use localhost. These CLI endpoints are operator/creator configuration, not URLs taken from untrusted gallery metadata; DNS pinning against rebinding is implemented in the gallery downloader, not this publisher.

An existing project `creator` must match the selected account and network. No credentials are selected from a project's public key. A missing creator reference uses the selected account. Each generated identifier is stable and independent of its title; older starter projects derive a stable 13-character identifier from their existing `previewId`. Changing the identity or service destinations of a published project requires a separate project. Restoring a lost journal is required to continue an existing remote identity safely; automatic journal adoption remains separate work; remix is supported.

## Source and sandbox checks

Tracked source and selected release inputs are inspected, up to 128 files and
40 MiB; playable HTML is limited to 10 MiB. A nonempty LICENSE is required. Managed
Git history is bounded to 10,000 reachable objects and 40 MiB of blobs. Regular
relative paths are required; symlinks, submodules, Git attributes/modules, private
state/dependency folders and likely credentials are refused. Git hooks are disabled.

The CLI builds source only on explicit publish/propose/build commands. Library
callers supply their built artifact; checks and merely opening a review do not run
project scripts. Standard build metadata and required NAP domains are checked.

The browser check runs the frozen HTML under our current shared host, CSP, opaque iframe sandbox and shim. It checks startup, the shell handshake, script errors and CSP violations, while blocking external network requests. It does not use an inherited preview server or modified runtime bundle. This is a startup smoke check, not comprehensive gameplay, performance, NAP, or external-service conformance testing. The compiler runs in a fresh Bun process to avoid the pinned runtime's known build/read issue after networking. The check report records the runtime profile and browser version.

The archive is Git's tar of the exact frozen commit and contains the selected regular files. The playable artifact is the archived entry selected in `napplet.json`: `index.html`
for legacy projects or `dist/index.html` for the upstream boilerplate. Built projects
include Git-visible source files plus their ignored built HTML by default, so the
release journal retains editable TypeScript, the locked toolchain configuration and
the executable artifact. The Git repository and source tar preserve the actual
committed source tree; ignored build output is a separate Blossom artifact. The
publisher reads standard `napplet-requires` metadata from built HTML in addition to
configured requirements. CLI publish/propose build dist projects before calling the
sandbox checker; the checker itself executes only the frozen HTML. This records exact bytes,
not an independently reproducible-build attestation. Both tar and HTML are uploaded to Blossom and independently retrieved/hash-checked.

## Journal and retry behavior

`.napplet-space/<network>/index.json` selects the pending/latest job. Each job directory stores its public plan, clean source repository, separate frozen `files/` inputs, archive, signed events, checks and receipts. The journal has a schema and content fingerprints. An exclusive SQLite lock covers the project across processes and network profiles; OS process exit releases it. Atomic JSON replacement and fsync preserve completed checkpoints. Native Git objects and source files are also retained locally. Keep this directory when moving to another machine: dropping it loses the retry/concurrency history.

1. Inspect the source and selected identity. Query the newest remote current manifest and Git announcement/state with an explicit completed relay query.
2. Run the sandbox check; reject edits made during that check. Freeze the file set, commit and source archive.
3. Persist the job, then signed Git authorization and snapshot/current events before sending any of them.
4. Publish Git source and all retained release refs, using a lease on the main branch. Verify Git refs and signed source metadata.
5. Check Blossom ownership and bytes. Reuse verified owned blobs; otherwise issue a scoped signed upload and independently verify retrieval.
6. Publish the snapshot first, then the current manifest. Require each event to be queryable. A lost acknowledgement leaves the same signed event available for retry.
7. Attempt optional mirrors, then check the website's exact current/snapshot projection and verified artifact. Save confirmed or pending website status without changing the signed publication.

Repeating the same release rechecks storage/relay evidence, repairs missing blobs/events and retries unavailable mirrors without creating another snapshot or source commit. `unchanged` means the release identity and bytes were reused, even if missing remote data needed repair. A change in source, title, topics or required domains creates a new release; identical HTML alone does not make metadata changes a no-op.

With the prepared soyLI 0.8.1 upload fix, slower transfers can continue while data
arrives. Upload and independent verification have separate time budgets; see
[Blossom timeout policy](BLOSSOM.md#upload-timeout-correction--prepared-for-soyli-081).
After upgrading and deploying the server fix, retry an interrupted frozen publication
with `soyli publish --resume` from the existing project. Preserve its `.napplet-space`
journal and identity. Completed blobs are reverified and reused; a partially uploaded
blob is resent in full with the same frozen bytes/hash.

Checks before and after remote stages reject unknown competing current or source events. Timestamps increase monotonically with a bounded clock-skew check. A Git lease protects the branch update. Nostr relays do not provide a distributed compare-and-swap transaction: a concurrent event can still arrive between checks. The CLI detects an observed conflict and stops instead of claiming it can roll back already-public events. There is no automatic destructive conflict override.

Source state retains at most 128 release refs in this initial adapter. Reaching that limit stops without deleting refs; a scalable retention policy is future work. Optional mirrors may be offline while primary publication succeeds. Stored receipts are observations, not promises of permanent hosting. Back up the journal and creator recovery material separately.

## Protocol output

Publication uses the authoritative [pinned NIP-5D proposal](https://github.com/dskvr/nips/blob/24711d9c47bbdd07908bf1d52bf677d9cbc530f0/5D.md), the [NIP-5A manifest tag schema](https://github.com/nostr-protocol/nips/blob/master/5A.md), and [NIP-34 Git URLs/state](https://github.com/nostr-protocol/nips/blob/master/34.md). Named current events are kind 35129, snapshots are kind 5129 without a `d` tag, and both carry the same single `/index.html` mapping, aggregate, server hints, title/description, required domains and optional topic hashtags. Snapshot `a` references its own napplet address. `source` is an ordinary `nostr://` repository URL.

Two optional provenance tags, `source-commit` and `source-archive`, carry the exact Git commit and content-addressed source tar URL. These are Space publishing conventions, not NIP-5D requirements. Clients may ignore them; ordinary `source`, manifest and Blossom discovery still work. There is no mandatory descriptor, branded hashtag or current-to-snapshot pointer. Automatic screenshots and optional video descriptor authoring are supported; metadata from other clients remains optional.

## Verification

```sh
bun run check
bun run test:publish
# Optional native OS store test: creates and deletes its own temporary credential IDs.
bun run test:publish:native
```

The deterministic tests cover interrupted uploads, lost relay acknowledgements, unchanged retries, metadata-only updates, modified working/frozen source, forged saved signatures, competing remote versions, concurrent processes, identity/target isolation, failed mirrors and repair of missing data. Native service tests use the actual Khatru/GRASP/Blossom implementations, the browser check, an independent Nostr wire reader, tar extraction and independent Git clone/fetch. An opt-in test drives the real CLI across processes with temporary native Keychain credentials.

Persistent website ingestion, confirmed playable links, authenticated names, the public installer, preview descriptors and remix are implemented. Additional build profiles, explicit journal adoption/conflict recovery, broader native keystore acceptance, and publication/discovery acceptance in an external public client remain separate work. See [the interoperability contract](PROTOCOL.md) and the dated [deployment verification](DEPLOYMENT.md).

## Visible project destinations and previews

Run `soyli config` to inspect effective destinations without an account,
build, or network request. `soyli config init` materializes the current
network's targets in `.napplet-space/project.json` under `project.publish`. New projects and remixes
include explicit public and local profiles:

```json
{
  "publish": {
    "networks": {
      "public": {
        "relay": "wss://relay.napplet.soy",
        "blossom": "https://blossom.napplet.soy",
        "grasp": "https://git.napplet.soy",
        "site": "https://napplet.soy",
        "mirrors": [
          "wss://nos.lol",
          "wss://relay.primal.net",
          "wss://nostr.mom",
          "wss://relay.pocketstr.com"
        ]
      },
      "local": {
        "relay": "ws://127.0.0.1:19347/relay",
        "blossom": "http://127.0.0.1:8081",
        "grasp": "http://127.0.0.1:8082",
        "site": "http://localhost:8080",
        "mirrors": []
      }
    }
  },
  "preview": { "delayMs": 1500 }
}
```

Merge this into the existing project configuration; do not replace its identity,
entry, license, or other metadata. Precedence is CLI target flags, selected
`publish.networks` profile, legacy direct `publish` fields, then built-in defaults.
`publish.files` can add release inputs but does not remove tracked Git history. Top-level `relays` and `servers`
are runtime read/resource hints; they are never upload destinations.

`relay` receives signed manifests and preview descriptors. `blossom` receives
HTML, source archives and PNG previews. `grasp` must be a compatible NIP-34/GRASP
Git service. `site` determines share links and indexing checks. `mirrors` are
best-effort extra copies after primary acknowledgement, not substitute primaries;
set `mirrors: []` to disable them. A failed primary stops publication and leaves
an exact resumable journal; it does not silently switch services.

Edit e.g. `publish.networks.public.blossom` to choose another server. New releases
may change Blossom, site or mirrors. Changing the identity, primary relay or Git
service of an existing journal requires migration of their published history;
the CLI refuses to overwrite competing state. Pending releases always resume with
their original destinations. Keep earlier stores available for existing snapshots.

See [preview capture and metadata](PREVIEWS.md#creator-capture-and-publication-2026-09-14)
for automatic screenshots and choosing an inspected image. `soyli skills
update` refreshes the bundled integration note in an existing project while
preserving creator edits and upstream skill bodies.
