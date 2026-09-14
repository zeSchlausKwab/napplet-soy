# Remixing

Choose **Remix this** on a napplet page and copy the command. It pins the selected manifest event, so a later publication cannot change the starting point:

```sh
napplet-space remix https://napplet.soy/r/EVENT_ID my-remix
cd my-remix
napplet-space setup
napplet-space dev
```

Use `--network local` with a local portable or pinned URL when developing. The CLI also accepts naddr, nevent, note and hexadecimal event identifiers. The website is an optional accelerator: relay lookup uses Applesauce, verifies signatures and matches the exact requested identity.

When the author supplies a signed `source-archive` hash URL, the CLI verifies and unpacks its bounded Git tar, checks its playable artifact against the selected manifest, and retains editable source and license files. It rejects traversal, links, Git internals and credential files. A `source-commit` is the author's recorded provenance; the downloader does not independently prove the archive came from that Git commit. Other publishers without this archive convention still support an HTML starting point using the hash-verified playable file. Missing licensing information becomes `UNLICENSED`, not an invented open-source grant.

The new project gets a fresh identifier, no original creator credentials or publishing destinations, retained runtime relay/asset hints, bundled creator skills, and a README attribution. It never executes downloaded scripts or installs dependencies automatically. Review the project before `setup` runs its build. Creator onboarding reuses or creates your own account and preserves the normal private-key backup outside Git.

Publication emits [NIP-5A ancestry](https://github.com/nostr-protocol/nips/blob/master/5A.md): a current remix's `a` is its immediate parent and `A` its original ancestor. A snapshot's `a` remains its own napplet address, with `A` inherited. The optional `remix-version` tag records the exact selected event; other clients can ignore it and still discover and run the remix normally.

Remix has shipped since CLI 0.3.0; the deployed CLI baseline is now 0.5.0. See the [release record](DEPLOYMENT.md#identity-configuration-and-social-release--2026-09-14).


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

Asset originals included by the publisher are browsable and downloadable too. See
[asset authoring and current gaps](ASSETS.md).


Verification: 181 repository tests pass, including source retrieval/visibility and
shared archive adversarial checks. Production-build browser checks cover desktop and
mobile file navigation, stable file links for snapshot/current-manifest IDs, inert
highlighting, byte-identical attachment downloads, missing/binary/large files, explicit
HTML fallback, pending artifact discovery and immediate moderation of cached source.
Typechecking and the production build pass. No source scripts, installs, real accounts
or production publications were used by this verification.
