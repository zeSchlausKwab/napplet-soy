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
napplet permissions, explains opt-in playback and local moderation scope, and does
not present ContextVM multiplayer as available. Runtime details remain governed by
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
