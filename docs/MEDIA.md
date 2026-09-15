# Audio in the shared host

Implemented in source on **2026-09-15**, prepared for **soyLI 0.8.0** and a matching
web deployment. The operator's 0.8.0 installer/checksums and website release
`20260915113546965-84858` were observed publicly on 2026-09-15; production playback
acceptance is separate from the local evidence below. The 0.7.0 distribution
does not expose `media`; upgrading the website does not upgrade installed CLIs.

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
`source.url` must be public HTTPS. MP3, WAV and Ogg are identified from stream bytes.
Actual codec support is determined by the browser. Subscribe to state and capability
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
requests and proxy tickets. Existing web visibility/offscreen rules still stop the
player; this is not a background radio service. Viewport expansion preserves the
same iframe and audio session. A release/profile change causes discovery to retry
previously unsupported media creations (`space-playback-2`).

## Streaming boundary

`POST /api/media` accepts only the first-party host, checks the current playable
manifest (or current local preview revision), validates the source and issues an
opaque, two-hour ticket. The host audio element reads `GET /api/media?token=…`;
browser-controlled same-origin fetch metadata is required. `DELETE` cancels streams
and releases the ticket. The opaque frame receives neither a ticket nor source bytes.
Admission/moderation is checked again when a stream starts.

On the website, audio creation/deletion and resource requests compare the browser's
Origin with the configured `SPACE_SITE_ORIGIN`. Caddy terminates HTTPS before its
internal HTTP connection to Bun; that internal URL must not define the public
origin. Client-supplied forwarded headers do not grant access. Local soyLI preview
continues to use its own loopback origin. This correction was found during the
0.8.1 deployment verification; the CLI's local behavior and distribution are unchanged.

The proxy validates public DNS addresses and pins the actual HTTPS connection,
including each of at most three redirects. It rejects private/special IPs, HTTP, credentials,
nonstandard ports and encoded responses; no cookies/authorization headers are
forwarded. The byte prefix is sniffed before delivery, rejecting HTML and playlists.
The rest is streamed with backpressure; live streams need not finish downloading.
Audio is neither executed nor fully buffered/cached on the server.

Limits: 128 MiB or two hours per connection, 15-second connection and 30-second idle
timeouts; 16 active upstream streams globally, four per manifest, 24 ticket creations
and 24 stream starts per minute per manifest, eight retained tickets per manifest,
256 globally. Tickets are removed on host cleanup or expiration. Stream GETs do not
support ranges. Stop/retry starts a fresh stream; expiry/limits can require a new
media session. The resource-bytes API retains its existing smaller limits.

The compiled CLI uses Bun's native fetch against a validated IP, preserving the
original Host header, TLS server name and explicit certificate hostname verification.
This avoids a sustained-stream stall observed in Bun's Node-compatible HTTPS adapter.
See [Bun's TLS request options](https://bun.com/reference/globals/BunFetchRequestInitTLS).
The VPS's Bun 1.3.8 TLS/DNS defect is handled with a streamed real Node worker using
the same policy, bounds and cancellation. The standalone CLI needs no separate Node
installation for audio. Web and preview server idle timeouts are 60 seconds, above
the transport's connection and idle deadlines.

## Verification

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
