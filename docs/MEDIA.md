# Audio in the shared host

Implemented and deployed on **2026-09-15**, available in **soyLI 0.8.0 and later**.
Website release `20260915143300255-41346` includes the production HTTPS-origin
correction and passed real audio playback, fullscreen controls, pause and teardown
checks. The public installer now selects 0.8.1. Upgrading the website does not
upgrade installed CLIs; the 0.7.0 distribution does not expose `media`.

## Contract and supported subset

Authority: [NAP-MEDIA PR 10, revision 2b2d29e90c30b994bf5035a65b57e5fe7f08a9a2](https://github.com/napplet/naps/blob/2b2d29e90c30b994bf5035a65b57e5fe7f08a9a2/naps/NAP-MEDIA.md).
Bindings remain `@napplet/shim` 0.30.0; the maintained starter SDK is 0.24.4. We use
the proposal's **Wire Protocol** table, which agrees with that shim:
`media.session.create`, `.update`, `.destroy`, `media.command`, `.state`,
`.capabilities` and `.controls`. The proposal's introductory API table uses different
spellings; no second invented wire alias is exposed. No NIP-5D kind, manifest identity,
iframe sandbox or creator SDK change is needed.

The host advertises `media` and accepts **shell-owned audio** sessions. Use
`media.createSession({ owner: 'shell', source: { url }, metadata, live, autoplay })`;
`source.url` must be public HTTPS. The native audio element loads that original
URL directly; actual MIME/codec support is determined by the browser. Subscribe to state and capability
updates using the returned canonical session ID, then send play/pause/stop/volume
commands. IDs are isolated to the originating iframe/account, and client-suggested
IDs are replaced. Unknown sessions and unsupported commands are ignored.

Metadata title changes update the host control label. Artwork and related context
are not fetched/rendered. Source Nostr hints/context do not grant relay or network
authority. Hash-only/Nostr-only source resolution, napplet-owned sessions, video,
HLS/DASH/playlist resolution, seeking, next/previous, OS media keys and persistent
background playback are **not implemented**. Unsupported owner/source modes return
a correlated creation error. The standard permits hosts to support a subset.

## Playback and lifecycle

Web and CLI use the same session manager and controls. Four sessions are allowed
per iframe, with one active audio output across host sessions in the page. Playing
another pauses the previous one. Pause retains the browser buffer; stop releases
the source connection and replay starts from the beginning/current live stream.
No seeking is advertised. Embedded sounds/Web Audio remain distinct browser features.

The native audio element lives in the trusted host, never in the napplet. Requests
that the browser refuses for lack of user activation offer a host **Play audio**
button; its click starts playback synchronously. Cancellation leaves the session
paused, with a retry control. Connection/codec failures appear beside that session
and emit the standard stopped state. The protocol has no asynchronous error field,
so diagnostic text stays in host UI rather than adding a private wire event.

Controls show below/alongside the normal player controls and inside the immersive
corner disclosure; the resting immersive view still shows only its triangle.
Controls have touch-sized targets and wrap on narrow screens. Mobile verification
uses Chromium touch emulation; physical iOS/Safari acceptance remains outstanding.
Device/browser audio policies can still limit volume or playback.

Destroy, iframe teardown, identity change and preview reload release audio, pending
requests and native media sources. Existing web visibility/offscreen rules still stop the
player; this is not a background radio service. Viewport expansion preserves the
same iframe and audio session. A release/profile change causes discovery to retry
previously unsupported media creations (`space-playback-2`).

## Direct streaming boundary

The current source uses the original HTTPS URL in a host-owned audio element.
The media ticket API and server audio proxy are removed. There are no application
server stream quotas, byte sniffing workers or ticket expirations on this path.
Browser media loading handles buffering, codecs, redirects and connection lifetime.
URLs reject credentials and obvious private-network addresses. Controls, user
activation, session limits and account teardown remain in the shared host.

This transport migration is implemented locally on 2026-09-15 and awaits deployment
and a new soyLI binary release. The older release evidence below describes the
previous transport. Installed 0.8.3 binaries keep that bundled implementation until
upgraded; see [direct protocol access](PROTOCOL-ACCESS.md).

## Station lookup correction — soyLI 0.8.2

Drone Zone exposed a shell routing defect before audio session creation: the website
used discovery relays as an exclusive runtime allowlist and discarded its explicit
Wavefunc hint. The same project worked locally because its preview configuration
included that relay. The media transport itself could already play the stream.

The shared runtime now honors public relay hints and NIP-65 plans through a bounded,
guarded read service. Website and CLI use identical routing and transport policy;
see [runtime relay reads](PUBLIC-RUNTIME.md#runtime-relay-routing--soyli-082).
A failed empty lookup reports an error and incomplete results, rather than appearing
as confirmed absence. The Drone Zone build needs no code change or republication.

The unchanged published /play route passed station lookup, decoded MP3 and its own
play/pause controls after deployment in desktop and touch/mobile Chromium, without
query overrides. No napplet edit or republication was needed.

An unchanged temporary copy of the build, with only our relay configured as the
fallback, resolved the real station via its explicit hint and played/paused the
256 kbps MP3 through its own controls. This verifies station lookup and media
playback together; the earlier controlled media-only tests did not.

## Earlier release verification

Unit tests cover URL/byte policy, admission, quotas, streaming before EOF, cancellation,
session ownership/IDs, commands, gesture retries, cross-session focus and teardown.
The actual upstream shim is exercised in the CLI browser test, including decoded WAV
playback, gesture retry, mobile layout and account cleanup. The unchanged Drone Zone
project was also run against its real relay/MP3 stream: the browser reached playing,
advanced time and paused. Bun native fetch and Node fallback transports both delivered
successive MP3 chunks without waiting for EOF and cancelled successfully. The built
website also streamed the real MP3 through its media route, retained controls in
fullscreen, paused and released the session on player teardown.
The final compiled soyLI 0.8.0 played an unchanged copy of the Drone Zone build beyond
five seconds and paused with Bun/Node absent from PATH; the original project was untouched.

See `packages/runtime/src/media.test.ts`, `packages/backend/src/audio.test.ts` and
`tests/services/media.test.ts`. Existing runtime browser tests continue to cover
sandboxing, file prompts, configuration and account transitions.
