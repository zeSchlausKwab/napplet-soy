# About and resources

Deployed and verified on 2026-09-14 in `20260914192251320-98168`;
see the [release record](DEPLOYMENT.md#onboarding-about-and-key-recovery-release--2026-09-14).
The GitHub repository link was supplied on 2026-09-15 and added locally, pending
deployment; the Gitworkshop repository link is still deferred. `/about` is a TanStack
file route with server-rendered content and
page-specific title, description and Open Graph text. The header question-mark
link remains visible on mobile; the footer also links to About. Both work without
JavaScript. Existing paper/ink colors, typography and shadcn buttons carry through.

The page describes the visitor's play/inspect/remix/publish flow, the CLI and its
creator-maintained boilerplate, configurable publishing destinations, signed Nostr
listings, Blossom assets and Git sources. It distinguishes browser sign-in from
napplet permissions, explains opt-in playback and local moderation scope, and
describes shared scores, CVM matchmaking and NAP-WEBRTC support. Runtime details remain governed by
[compatibility review](NAP-REVIEW.md) and [playback](PUBLIC-RUNTIME.md).

Resource links include Napplet, napplet.run, NAPs, boilerplate, Gitworkshop, Blossom,
Applesauce and ContextVM. Stack links name the software actually used. The NIP-5D
link points at the project's authoritative proposal pin.

## This client's repositories

The default GitHub link is [zeSchlausKwab/napplet-soy](https://github.com/zeSchlausKwab/napplet-soy),
supplied by the user on 2026-09-15. It appears in server-rendered About content without
additional deployment configuration. Operators can override it with `SPACE_SOURCE_GITHUB_URL`;
an explicit empty value hides it. `SPACE_SOURCE_GITWORKSHOP_URL` remains optional until
that repository is provided.

On the VPS, overrides belong in operator-maintained `shared/server.env`; locally use
the server environment. Only validated public HTTPS links cross the server boundary.
Credentials, custom ports, wrong hosts and non-HTTPS schemes are omitted. The GitHub
fallback applies only to an unset value, so invalid overrides never become public links.
Restart the web process after configuration changes.

Verification covers the SSR route and metadata, resource links, unsafe configuration
omission, visible mobile header access and 320/390/1365px layouts without JavaScript.
Desktop/mobile screenshots are kept under `.local/about-identity-check/`.
All fourteen external resource/stack/protocol links returned HTTP 200 on 2026-09-14.

The 2026-09-15 local revision updates the identity explanation to describe remembered
connections and opt-in private-key storage. See [identity](IDENTITY.md#website-sign-in);
this documentation change does not mark the revision deployed.

## soyLI field guide and FAQ — 2026-09-18

The new `/docs` route is the practical soyLI reference, separate from `/create`'s
installation, platform requirements and downloads. The header and footer, creator
guide and About page link to it. It covers the edit/check/checkpoint/publish loop,
identity switching and recovery, listing previews and assets, visible provider
configuration, Git-backed proposals and review, backend setup and troubleshooting.
Commands wrap on narrow screens and have copy buttons with a manual-copy fallback.
Section anchors and all reference text are server rendered. The native FAQ
disclosures work with a keyboard or touch, including without JavaScript.

`/about#faq` distinguishes account-free creation from pseudonymous publication:
every publication has a signing key, and source/Git metadata or provider connection
information can identify a creator. It covers website versus CLI identity selection,
key reuse, backups, system requirements, public history, proposals, custom providers,
readable/player links and the limits of content removal.

Keep user-facing commands consistent with the CLI and the linked feature guides.
The new `account create --new` flag is explicitly marked as source-only until a
packaged release includes it; remove that notice only when the downloadable CLI
supports it. The creator guide now includes a Git checkpoint before publication.
These documentation changes are local, not a deployment or CLI release.

Verification: production build and typecheck pass. An isolated Chromium check
verifies SSR metadata and content, all section anchors, native FAQ keyboard access
without JavaScript, copy success/fallback, internal navigation, hydration without
page errors and 320/390/768/1365px layouts without horizontal overflow. Desktop and
mobile screenshots were visually reviewed; local evidence is under
`.local/soyli-docs-check/` and `.local/soyli-docs-browser.log`.
