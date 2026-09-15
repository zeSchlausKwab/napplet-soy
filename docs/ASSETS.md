# Assets in a napplet

Audited **2026-09-14** against the vendored upstream boilerplate and its pinned
`@napplet/vite-plugin` **0.11.2**. This is the supported small-asset workflow today.
The complete large-media workflow described below is still missing. Runtime assets and gallery previews
are separate things.

## Small assets: keep them in the project and import them

Use an ordinary source directory, for example:

```text
src/
  main.ts
  style.css
  assets/
    images/player.png
    sounds/jump.ogg
    fonts/display.woff2
    videos/intro.webm
```

From `src/main.ts`, import assets explicitly so the upstream Vite build sees them:

```ts
import playerUrl from './assets/images/player.png?url';
import jumpUrl from './assets/sounds/jump.ogg?url';
import introUrl from './assets/videos/intro.webm?url';
import './style.css';

const player = document.createElement('img');
player.src = playerUrl;
const jump = new Audio(jumpUrl); // Call jump.play() from a user gesture.
const intro = document.createElement('video');
intro.src = introUrl;
intro.controls = true;
```

From `src/style.css`:

```css
@font-face {
  font-family: 'Display';
  src: url('./assets/fonts/display.woff2') format('woff2');
}
```

The maintained boilerplate uses `artifactMode: 'single-file'`. In plugin 0.11.2,
that sets an effectively unlimited Vite `assetsInlineLimit`, disables CSS splitting,
and inlines entry scripts/styles into `dist/index.html`. Imported media/font URLs
become embedded data URLs. The napplet's runtime file is this **one HTML document**,
not a website served from its source directory. Browser codec support still applies;
embedding a file does not prove a browser can decode or play it.

Do not rely on `public/`, `/assets/sound.ogg`, or strings such as
`'./src/assets/player.png'` being served after publication. Copied `public/` files
normally fail the plugin's check for leftover output files. Dynamically constructed
paths may escape a build-time check and still fail inside the sandbox. Explicit
imports/CSS URLs are the supported path. Avoid `?no-inline` and separate chunks.

Run `soyli build`, then `soyli dev` and exercise every scene that
loads media. Use the listing preview to check name, description and cover, and run
`soyli check` before publishing. The smoke check verifies startup, not every
possible asset, interaction, scene or codec. A successful build alone is insufficient.

## Audio and host media sessions

The [NAP-MEDIA proposal](https://github.com/napplet/naps/pull/10) defines a separate
host capability for media sessions, including shell-owned playback: the napplet gives
the host a source and requests playback/control; the host owns the player and policy.
This is different from embedded sound effects or Web Audio inside the sandbox.

As of **2026-09-15**, neither soyLI's local host nor the website implements `media`.
The upstream SDK exposing `media.createSession` does not make it available in our
host. Capability discovery omits it, and a manifest requiring `media` cannot launch.
An optional media feature should report unavailability or offer a user-confirmed
external link. A successful relay lookup only proves the station metadata is readable;
it does not prove the host can play its stream.

Do not substitute direct remote `<audio src>` URLs or loosen the sandbox CSP.
`resource.bytes` downloads a bounded complete resource; its 10 MiB/20-second limits
make it unsuitable for an indefinite live radio stream. Shell-owned streaming needs
a NAP-MEDIA implementation, with source policy, user activation, supported actions,
state/errors and lifecycle cleanup shared by CLI preview and deployed playback.
This gap is not fixed by refreshing skills or reinstalling the same CLI version.

## Where the bytes go

- **Runtime:** embedded media goes inside the hash-addressed HTML uploaded to the
  configured Blossom target. The HTML has a **10 MiB** limit, including base64's size
  overhead. Keep videos especially small.
- **Editable originals:** for a built boilerplate project, the publisher selects
  Git-tracked and unignored files by default and includes them in the Git release and
  its hash-addressed source archive. `publish.files` can override the selection.
  Keep required original assets in that selection so a remix can rebuild the project.
  Source currently permits **128 files / 40 MiB total**, with a **50 MiB tar** ceiling.
  Files must pass the source path, regular-file and credential checks. Asset licensing
  and original attribution belong in the source too.
- **Gallery cover:** `napplet.json` preview settings and the screenshot workflow
  produce a separate image, referenced by the signed listing metadata. A runtime
  image or video does not automatically become a cover. See [previews](PREVIEWS.md).
- **Destinations:** `napplet.json`'s publishing configuration chooses relay, Blossom,
  Git/GRASP and site; CLI target flags override it. Runtime Blossom `servers` hints
  are a separate configuration, not the upload target. See [publishing](PUBLISHING.md).

## Larger assets: the gap

The host supports verified resource loading through the upstream `napplet.resource`
domain, including content-addressed `blossom:sha256:…` references and signed server
hints. That is a runtime capability, **not yet an asset manager**. There is no complete
creator workflow that discovers large local assets, uploads them, writes a hash/URL
lockfile, updates hints, verifies every reference, restores assets during remix and
previews everything with production-equivalent behavior.

Direct HTTP fetching from the sandbox is disabled; use the host resource capability
when developing a manual external-resource integration. Host requests currently have
a 10 MiB per-resource limit and bounded time/concurrency. Font and common image/audio/
MP4 MIME signatures are recognized. WebM is not yet explicitly identified by the
external-resource MIME policy; do not promise a universal managed WebM path from the
current implementation. Embedded WebM and external resource loading are distinct.

A19 will define automatic embedding versus separate immutable resource uploads,
visible destinations, resumable publication, local/prod parity, licensing, source
retention, format support and failure diagnostics. A09 remains responsible for
creating short listing-preview videos. Neither pipeline is declared complete today.

Implementation evidence: [upstream pin](../apps/cli/vendor/boilerplate.json),
[source selection](../packages/publish/src/project.ts),
[publisher](../packages/publish/src/index.ts),
[resource policy](../packages/backend/src/resource-response.ts),
[runtime limits](PUBLIC-RUNTIME.md).
