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
| 6–12s  | Vibe code: a symbolic editor, short agent prompt, live orbit preview.       | Open the folder in your own coding tool; run `soyli dev`.                  |
| 12–18s | Publish: build, posting preview, publish command and destination checklist. | Check title, description and screenshot; the CLI signs with your Nostr identity.   |
| 18–24s | Play: the orbit fills a browser canvas, with a share action.                | Open the returned link and pass it around.                                         |
| 24–30s | Remix: the preview branches into a second, coral-colored experiment.        | Use “Remix this” on any napplet; paste its install-and-remix command.              |

## Inline terminal revision — 2026-09-15

The user replaced the original dialog and “Watch the flow” action with an inline
expandable terminal. Its command and copy action remain visible. The native summary
is keyboard accessible; opening it mounts the muted, inline, autoplay video directly
under the command. Collapsing unmounts playback; reopening starts a fresh video.
There is no loop or download before expansion. Reduced motion does not suppress
explicitly requested playback; native controls allow pause. With JavaScript disabled,
the same disclosure shows the video with manual native controls and the five steps.

The walkthrough is now five short, visible steps below the video, without a second
transcript disclosure. No website account is needed. The terminal identifies the
CLI as **napplet soyLI**, command **`soyli`**. Commands in the film/captions and all
creator guidance match the renamed executable. The hero's right column remains
available for A07's featured work. Remotion still renders offline and is absent
from the site's browser runtime.

**This revision is deployed with CLI 0.7.0 in `20260915084016730-23084`.** The original
modal version was deployed on 2026-09-14 in `20260914192251320-98168`; the historical
verification below describes that release. See [CLI upgrade compatibility](CLI.md#rename-and-upgrade--2026-09-15).

## Combined creator guide — 2026-09-15

`/create` is the combined onboarding and download route. It retains the starter
command and inline walkthrough, account-free creation, coding/publishing steps,
listing/screenshot checks, upstream skills and verification commands, OS requirements,
Chromium libraries, upgrade instructions and all platform downloads/checksums.
Section links jump to setup, skills, platforms, upgrading and downloads.
`/cli` permanently redirects (308) to `/create`, preserving the selected template
and section fragment. Existing `/cli/download/<version>/<file>` links remain unchanged.
The landing hero's Setup help links directly to `/create#setup`. Deployed 2026-09-15.

Local follow-up, 2026-09-18: `/docs` adds a linked soyLI field guide for day-to-day
commands, identities, publishing and collaboration. `/about#faq` answers common
questions, including pseudonymous publication and identity reuse. `/create` keeps
all setup and download information and now includes a Git checkpoint before
publication. See [About and documentation](ABOUT.md#soyli-field-guide-and-faq--2026-09-18).

## Maintaining the guide

- `apps/web/src/lib/creator-commands.ts` owns copyable install/create/remix commands.
  `StarterCommand` is shared by the landing hero, combined creator guide; the
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
  and `.local/walkthrough/`. Local verification did not publish or deploy.

The user subsequently requested deployment. The same onboarding checks passed against
public HTTPS, including no video fetch until Play, captions, seeking through Caddy,
no-JavaScript browsing, copy fallback and closing/focus behavior. All 13 public
app/runtime/installer browser regressions also passed. Live evidence is under
`.local/onboarding-deploy/`; CLI 0.5.0 and its four release archives are unchanged.

## Revision verification — 2026-09-15

The updated service test checks keyboard expansion, no-JavaScript disclosure,
copy without expansion, muted autoplay, pause by collapsing, fresh playback on
reopening, visible steps, desktop/mobile fit, captions and byte-range seeking.
Native distribution tests cover managed legacy-command upgrades, unchanged public
account state, foreign-command preservation, checksum failure, new/remix, frozen
sandbox checks and terminal input. The film is rerendered with `soyli` captions.
Evidence is recorded under `.local/soyli-*.log`, `.local/onboarding/` and
`.local/walkthrough/`. Final pass counts are recorded in A06 after verification.

Final verification: typecheck and production build passed, as did all 185 repository
tests, seven native distribution/terminal/preview tests, the inline walkthrough
service/browser test, and the creation/help/download-link browser test. The native
0.6.0 default boilerplate completed account-free creation, build and browser check
with `/usr/bin:/bin` on PATH and a fresh managed toolchain cache. All four platform
archives are built; native execution was tested on darwin-arm64, not all four OS/CPU
combinations. All five film scenes and desktop/mobile captures were inspected.
No public release or deployment was performed.
