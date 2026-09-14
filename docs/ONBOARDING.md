# Immediate onboarding and walkthrough (A06)

## Storyboard — 2026-09-14

The landing hero exposes the actual install/create command before scrolling, beside
a copy action. No website account or sign-in is needed to create, remix or publish.
Publishing still uses a Nostr signing identity, which the CLI creates or connects;
this does not change sign-in requirements for likes and comments. macOS/Linux, Git,
and the creator's own coding tool are the prerequisites. No global Bun/Node install.

The film is a symbolic, silent 30-second guide in the site's paper, ink, coral and
sage palette. It follows one playful orbit experiment from terminal to remix.
The accelerated sequence is illustrative, not a claim about installation time.

| Time   | Scene                                                                       | What the viewer learns                                                             |
| ------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 0–6s   | Install: a terminal types the real one-liner; a project folder unfolds.     | Start without a website account. Follow the installer's PATH instruction if shown. |
| 6–12s  | Vibe code: a symbolic editor, short agent prompt, live orbit preview.       | Open the folder in your own coding tool; run `napplet-space dev`.                  |
| 12–18s | Publish: build, posting preview, publish command and destination checklist. | Check title, description and screenshot; the CLI signs with your Nostr identity.   |
| 18–24s | Play: the orbit fills a browser canvas, with a share action.                | Open the returned link and pass it around.                                         |
| 24–30s | Remix: the preview branches into a second, coral-colored experiment.        | Use “Remix this” on any napplet; paste its install-and-remix command.              |

Remotion renders static release assets offline. The website uses native video
controls with `preload="none"`, a small poster, a caption track and a text transcript.
No autoplay or loop, including under reduced motion. The hero links to the walkthrough
on `/create` without JavaScript; with JavaScript it opens a dialog. Closing the dialog
unmounts playback. The hero's right column remains available for A07's featured work.

Implemented and verified locally on 2026-09-14; not deployed. A07's featured rotation follows.
The final 30-second MP4 is 2,711,233 bytes (2.59 MiB); the WebP poster is 22,336 bytes.

## Maintaining the guide

- `apps/web/src/lib/creator-commands.ts` owns copyable install/create/remix commands.
  `StarterCommand` is shared by the landing hero, creation page and CLI help; the
  remix dialog uses the same builder with its exact source URL and local-network rule.
- `apps/web/src/lib/creator-walkthrough.ts` owns the scene copy, transcript, caption
  text and media paths. It has no Remotion imports.
- `scripts/walkthrough/composition.tsx` is the Remotion film. Its installer scene
  imports the real command builder; it uses bundled DM Sans/DM Mono fonts and drawn
  vector art, with no third-party media or live publication requests.
- `bun run walkthrough:render` produces the MP4, WebP and WebVTT files in
  `apps/web/public/walkthrough/`. It also saves review stills under `.local/walkthrough/`.
  Set `REMOTION_BROWSER_EXECUTABLE` to an existing Chromium executable to reuse it;
  otherwise Remotion manages its rendering browser. Run this after changing the
  command, storyboard or composition and review every scene before committing assets.
- Run `bun run build` after rendering to copy the final assets into the production
  build. Ordinary builds and deploys use checked-in assets; they do not render the film.
  Remotion 4.0.524 is pinned as a development dependency and is absent from the web
  browser bundle. The render script follows the official
  [Remotion rendering APIs](https://www.remotion.dev/docs/ssr-node).

The production server serves public files with their original MIME type, content
length, `nosniff` and cache policy. Single byte ranges return 206; unsupported or
unsatisfiable ranges return 416. HEAD has no body. Without representation validators,
an `If-Range` request falls back to the complete response, avoiding mixed old/new bytes.
This enables native video seeking and does not change napplet artifact verification.

## Verification — 2026-09-14

- `bun run check`: typecheck and 185 repository tests passed, including literal shell
  argument handling for starter/remix commands. Local relay/ContextVM tests require
  loopback networking; the filesystem sandbox alone cannot run those existing tests.
- `bun test tests/services/onboarding.test.ts`: isolated production-server Chromium
  coverage for the initial command at 320×568, 390×844, 768×1024 and 1365×900, no
  horizontal overflow, no-JavaScript route/transcript, clipboard success/failure,
  no video request until Play, reduced-motion non-autoplay, all five caption cues,
  30-second duration, seeking, Escape cleanup/focus return, and HTTP range/HEAD behavior.
- The released **0.5.0 darwin-arm64** CLI passed six distribution/terminal tests using
  temporary projects and a PATH with no Bun/Node: actual installer downloads and
  checksums, new/remix, delayed keyboard input, cancellation and hidden-input behavior.
- The default boilerplate was created without an account, built, and checked in a
  browser with that native CLI, `/usr/bin:/bin` on PATH and a fresh managed toolchain
  cache. This exercises real dependency downloads on this Mac, not a new VM or all
  supported operating systems. It produced the built HTML and a verified preview.
- Scene stills and desktop/mobile UI captures were visually inspected. Local evidence:
  `.local/onboarding-check.log`, `.local/onboarding-installer.log`,
  `.local/onboarding-native.log`, `.local/onboarding-render.log`, `.local/onboarding/`
  and `.local/walkthrough/`. No new real publication or deployment was performed.
