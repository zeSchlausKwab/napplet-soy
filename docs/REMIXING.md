# Remixing

Choose **Remix this** on a napplet page and copy the command. It pins the selected manifest event, so a later publication cannot change the starting point:

```sh
soyli remix https://napplet.soy/r/EVENT_ID my-remix
cd my-remix
soyli setup
soyli dev
```

Use `--network local` with a local portable or pinned URL when developing. The CLI also accepts naddr, nevent, note and hexadecimal event identifiers. The website is an optional accelerator: relay lookup uses Applesauce, verifies signatures and matches the exact requested identity.

When the author supplies a signed `source-archive` hash URL, the CLI verifies and unpacks its bounded Git tar, checks its playable artifact against the selected manifest, and retains editable source and license files. It rejects traversal, links, Git internals and credential files. A `source-commit` is the author's recorded provenance; the downloader does not independently prove the archive came from that Git commit. Other publishers without this archive convention still support an HTML starting point using the hash-verified playable file. Missing licensing information becomes `UNLICENSED`, not an invented open-source grant.

The new project gets a fresh identifier, no original creator credentials or publishing destinations, retained runtime relay/asset hints, bundled creator skills, and a README attribution. It never executes downloaded scripts or installs dependencies automatically. Review the project before `setup` runs its build. Creator onboarding reuses or creates your own account and preserves the normal private-key backup outside Git.

Publication emits [NIP-5A ancestry](https://github.com/nostr-protocol/nips/blob/master/5A.md): a current remix's `a` is its immediate parent and `A` its original ancestor. A snapshot's `a` remains its own napplet address, with `A` inherited. The optional `remix-version` tag records the exact selected event; other clients can ignore it and still discover and run the remix normally.

Remix has shipped since CLI 0.3.0; the deployed CLI baseline is now 0.5.0. See the [release record](DEPLOYMENT.md#identity-configuration-and-social-release--2026-09-14).

## Genealogy on napplet pages

Implemented and verified locally on **2026-09-15**, agenda A21; not deployed.
**The family tree** appears on detail pages when the selected signed manifest
declares ancestry. It connects known ancestors down to **You are here**, linking
each parent release and its creator’s Nostr profile. It loads separately from the
player and never downloads or executes ancestor artifacts.

NIP-5A at [a2494f4f81d46684e5814a9bf35e2b1df978f955](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/5A.md)
supplies the ancestry semantics, with NIP-5D’s selected napplet kinds retained.
A current manifest’s single `a` names the immediate parent; `A` names the origin.
For kind-5129 snapshots, `a` names the snapshotted napplet itself, **never a remix
parent**. An `A` without an immediate parent produces an explicitly incomplete
tree and a separate declared-origin link. There is no invented connection across
missing generations. Standards-only publishers work without Space metadata.

When present, the optional `remix-version` pins the exact parent event. The event’s
signature, manifest and identity must validate; a current child’s declared parent
address must agree with that exact event. Without a revision pin, an address-linked
parent is labeled as its **current release**, which can change after the remix.
These are author-declared relationships, not proof that code was copied or rebuilt.

Lookup starts with the local index/cache and uses configured relays for missing
ancestors. It follows at most twelve generations, detects repeated identities/IDs,
and permits at most four remote requests within a nine-second scheduling window
(each existing relay request has its own 2.5-second deadline). Four tree requests
may run concurrently per web process. Exact retrieved manifests use the bounded
community event cache. Missing, ambiguous, mismatched, blocked/deleted, cyclic and
truncated ancestry have explicit gaps; an ancestor’s absence never blocks playback.
This slice shows ancestors, not a reverse index of every descendant or sibling remix.

Verification: unit cases cover standard manifests, snapshot self-addresses, pinned
generations, origin-only gaps, missing/ambiguous/mismatched parents, cycles, depth
limits and forged events. The production-build profile/browser test displays a
three-generation chain and verifies its ordering and creator links.

## Browsing a release’s original files

Implemented, verified and deployed on **2026-09-14** in release
`20260914151021458-42270`. See the [deployment record](DEPLOYMENT.md#source-browser-release--2026-09-14). **Browse source** on each
napplet opens `/r/EVENT_ID/source`; `?file=src/main.ts&view=project` links to a file
in that exact signed release. The tree lists the bounded source archive, offers its
license file and author-recorded commit, and displays selected text with syntax
highlighting. Downloads retain the original bytes. **Remix this** reuses the same
pinned event in both the installed-CLI and install-and-remix commands.

The signed `source-archive` URL must end in its SHA-256 digest (optionally `.tar`).
The browser verifies downloaded bytes and uses the same Git-tar parser as the CLI:
50 MiB archive, 40 MiB expanded files, 128 files, no traversal, symlinks, special
entries, conflicting paths or credential files. It never clones a repository, runs
build/scripts, extracts to disk or renders HTML/SVG/Markdown as active documents.
Lowlight 3.3.0 and selected Highlight.js 11.11.1 grammars produce text/span tokens;
the tree uses native disclosure controls. This avoids loading an editor or the full
language catalogue. These dependencies load with the source route, not the gallery.

Only the selected file’s text is sent to the page. Text over 200 KiB and binary files
have a download state; highlighting stops at 64 KiB. Unknown file extensions use
plain text. A missing path stays missing instead of silently selecting another file.
Downloads are attachments with `nosniff` and a sandbox CSP, including HTML and SVG.

Public retrieval uses bounded HTTPS requests, enforces public DNS/IP destinations
at connection time and refuses redirects. Development permits only the configured
`SPACE_INDEX_LOCAL_BLOSSOM` loopback origin/path. There are at most two simultaneous
archive fetches and twelve new fetches per minute per web process; requests for the
same URL share a download. The cache retains at most eight entries / 96 MiB for ten
minutes, with a 30-second failure cache. Event visibility and archive-hash moderation
are checked again even on cache hits and after downloads.

**Built HTML** (`?view=html`) is an explicit fallback using the existing verified
artifact store. A publisher without the archive convention still has this view and
its author-supplied source reference. An external repository link may change and is
labeled accordingly. No license is inferred when missing; read the author’s license
before reusing files. Missing or invalid source metadata never affects playback.

A pinned URL never follows a later publication. Snapshot manifests remain available
under the index’s normal retention policy. Superseded replaceable manifests may
become unavailable if neither the index nor a relay retains them; the source browser
does not create an independent permanent event archive or substitute the new version.
The signed archive digest proves the author selected those bytes; `source-commit`
and source-to-build correspondence remain author claims, not a verified rebuild.

### README excerpt on detail pages

Local addition (2026-09-15, pending deployment): “Peek at the source” lazily loads a
root README as the section nears the viewport. Names are case-insensitive, preferring
`README.md`, then `README.markdown`, `README`, and `.txt`/`.rst`; nested dependency/docs
READMEs are not substituted. The terminal shows the first ten physical lines, keeping
blank lines and normalizing CRLF. Each displayed line is capped at 1,000 characters.
“Read full file” opens that exact file in the pinned source browser.

This shares the verified archive download and cache described above. It returns only
the excerpt, not the repository tree or full README. Non-UTF-8/binary, empty or >200 KiB
files, missing archives and failed retrievals omit this optional preview. Visibility
and hash moderation are rechecked even on cache hits. React escapes all text: embedded
HTML, links and images cannot execute, navigate or load resources from the excerpt.
The README and its terminal presentation introduce no manifest requirement.

Asset originals included by the publisher are browsable and downloadable too. See
[asset authoring and current gaps](ASSETS.md).

Verification: 181 repository tests pass, including source retrieval/visibility and
shared archive adversarial checks. Production-build browser checks cover desktop and
mobile file navigation, stable file links for snapshot/current-manifest IDs, inert
highlighting, byte-identical attachment downloads, missing/binary/large files, explicit
HTML fallback, pending artifact discovery and immediate moderation of cached source.
Typechecking and the production build pass. No source scripts, installs, real accounts
or production publications were used by this verification.
