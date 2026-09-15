# Napplet playback profile

Implemented 2026-09-12. Open a public card and choose **Play napplet**. Cards distinguish verified, compatible artifacts from missing capabilities and unavailable downloads. Compatibility means this host implements the requested domains; an individual operation can still be refused by policy or fail upstream.

## Standards and integration

Fixtures and relay-imported napplets use the same manifest validator, capability admission, artifact verification, host identity, and resource service. The browser subscription covers named, root, and snapshot kinds without a Space hashtag. Fixture metadata contains no custom snapshot pointer. The creator publisher uses this same admission path; the bundled test key must never be used on public relays.

Storage uses the same author/address/aggregate scope regardless of catalog source. A creator-signed snapshot and current manifest of the same build share that scope; a different app or signer cannot claim it. Existing current public-manifest scopes are preserved. The old fixture-only artifact-hash scope is retired; prototype fixture saves are not migrated.

The browser injects the published **@napplet/shim 0.30.0** prelude, with transitive **@napplet/nap 0.32.0** and **@napplet/core 0.32.0** pinned in the lockfile. These are protocol bindings, not another catalog: discovery remains Applesauce queries against Nostr relays. The shim is loaded with the player route, not by executing an external script inside a napplet.

Space adds the [NAP-SHELL handshake](https://github.com/napplet/naps/blob/master/naps/NAP-SHELL.md), absent from that shim release. `shell.ready` establishes one frame session; `shell.init` replies once; `shell.ready()`, `onReady()`, `supports()` and `services` expose its environment. Unknown message types are silently ignored before quota accounting; recognized operations can still return policy errors. The host verifies `MessageEvent.source` and the opaque origin, and binds identity to the verified manifest before accepting requests. Messages cannot choose a different author, build, account, or storage namespace.

References: [NAP registry and web projection](https://github.com/napplet/naps), [upstream implementation](https://github.com/napplet/web/tree/1df6dc87e5eee7257af41efb6247d47ec019e3d8/packages), and [NIP-5D proposal](https://github.com/nostr-protocol/nips/pull/2303). Several domains remain draft contracts. This is an implemented playback profile, not a claim of complete registry conformance.

## Available operations and policy

| Domain     | Implemented behavior                                                                             | Limits                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell`    | Handshake and synchronous capability discovery                                                   | One session per frame; no named services                                                                                                                            |
| `storage`  | String get/set/remove/keys, shared and instance scopes                                           | Shared data persists in this browser per author/address/build/account; instance data lasts for one play session; 256 keys / approximately 1 Mi characters per scope |
| `identity` | Connected key, user NIP-65 relay preferences, profile, follows, public mute list                      | Guest key is the empty string; extra list projections return explicit errors; no private lists or signer access                                                     |
| `theme`    | Space's current light theme                                                                      | Fixed theme; no user theme settings yet                                                                                                                             |
| `relay`    | Filtered query and live subscribe/close                                                          | Guarded public WSS reads; signatures checked, duplicates removed, filters reapplied; publishing/encryption denied                                                       |
| `outbox`   | Query, getEvent, subscriptions, close, resolveRelays                                             | NIP-65 selection and public relay hints under the shared read policy, fallback when needed, partial results marked; publishing denied                                                     |
| `common`   | Public NIP-19 encoding/decoding and profile/follows reads                                        | Secret identifiers, nrelay encoding, follow/unfollow/react/report writes denied                                                                                     |
| `resource` | HTTPS and hash-verified Blossom bytes, ordered bulk responses, cancellation, scheme discovery    | `data:` handled locally by upstream shim; no htree/nostr resolver; raw SVG/HTML/XML denied                                                                          |
| `link`     | HTTPS links presented in a host-owned confirmation                                               | User clicks to open; no automatic navigation                                                                                                                        |
| `config`   | Static/runtime schemas, validated settings UI, snapshots/subscriptions, focused settings opening | Browser-local values scoped to author/address/build/account; session-only secrets; see [configuration limits](CONFIGURATION.md). Deployed 2026-09-14 |
| `fs`       | Session virtual files: metadata/list/read/write/mkdir/remove/move/watch, save destination picker | 10 MiB aggregate, 256 KiB chunks, 128 entries, 16 watches; device file/directory pickers unsupported                                                                |

`fs.pickSaveFile()` opens a host prompt. After writes complete, files appear below the player with download links. This does not write into the user's filesystem without a download action. Download session files before stopping the player. Virtual paths are restricted to `/files`; they never map to server or device paths.

The 2026-09-15 source update adds `media` for shell-owned MP3/Ogg/WAV audio,
including live streams and play/pause/stop/volume. It is deployed and available in soyLI 0.8.0 and later; see [the complete media contract](MEDIA.md) for policy,
unsupported ownership/source modes, limits and evidence. The runtime profile changes
to `space-playback-2` so the index retries formerly unsupported media creations.

Required unsupported domains still gate launch: for example `inc`, `intent`, `keys`, `upload`, and `cvm`. Composability, napplet signing grants, extended identity lists, filesystem imports, and ContextVM game sessions remain separate additions. Older artifacts that omit required domains may still depend on unavailable APIs.

## Resource and lifecycle boundaries

The iframe remains `sandbox="allow-scripts"`, with no same-origin grant or raw network access. Inline JavaScript and WebAssembly execute within that boundary. Resources are returned as Blobs, not embedded remote URLs. No resource or napplet code executes on the server.

`POST /api/resources` accepts requests from the first-party host, for a known playable manifest from either catalog source. It rejects opaque/cross-origin callers, credentials, non-HTTPS network URLs, alternate ports and redirects. DNS destinations are checked in the actual connection lookup; private/special IPv4/IPv6 destinations are refused. The endpoint forwards no cookies or authorization headers. MIME is classified from bytes. Unknown binary bytes are permitted only for a verified Blossom digest; active document formats are refused even there.

Each resource is capped at 10 MiB. The host queues bursts with four simultaneous fetches, at most 16 outstanding envelopes, 60 resource operations/minute and 128 MiB delivered per play session. The larger session budget accommodates the public packaged-loader fixture's ten assets (78 MiB total). The server separately caps eight concurrent fetches globally and four per manifest, with 20-second overall fetch deadlines. Queued cancellation starts no request. There is no persistent server resource cache; upstream shim cache/Blobs belong to the frame and disappear when it is destroyed.

Relay access is through a frame-owned Applesauce pool. Filters, event counts, request concurrency, relay selection and subscription lifetime are bounded. Live subscriptions close after five minutes or 500 accepted events; the napplet receives a closure notification. Stopping/restarting or navigating away destroys the frame session, closes subscriptions and sockets, aborts resources and pending prompts, and revokes download URLs. Account changes preserve the iframe and its single SHELL handshake: old requests are cancelled, subscriptions close, resources abort, prompts/exports clear, and account-scoped storage/files are replaced before `identity.changed` is sent. Late results are suppressed. Shared saves remain available when returning to the same account; instance storage and virtual files start fresh. Napplets must listen to `identity.onChanged` to refresh their own in-memory account state.

## Immersive links

Implemented, verified and deployed on **2026-09-14** in `20260914171728494-21459`.
Append `/play` to a portable `/n/<naddr>`, pinned `/r/<event-id>` or named
`/@<handle>/<slug>` URL. **Open player** on the detail page opens that presentation;
the corner controls can copy its link. The parent route keeps its canonical detail URL
and server-rendered OG metadata. Cold links use the ordinary bounded discovery
queue. Unsupported capabilities and unavailable or tampered downloads still prevent
execution; optional metadata is not a playback requirement.

The corner-control revision (2026-09-15, locally implemented and verified; not yet deployed)
starts a fresh play link automatically after ordinary artifact verification. The
iframe fills the viewport; only a small bottom-right triangle remains visible at
rest. Hover or keyboard focus reveals the title, a description excerpt of at most
160 characters plus an ellipsis (clamped to two lines), and the existing share,
settings, restart, stop and fullscreen controls. Session-file downloads appear in
that panel as well. Loading errors and required host permission dialogs remain
visible when needed; the corner control stays available during loading/failure.

Clicking the triangle returns to details. On touchscreens, the first tap reveals
the panel and a second tap on the triangle returns to details; touching the napplet
again dismisses the panel. The triangle has a 48px target, other controls at least
44px, and the panel respects safe-area insets and narrow/landscape viewports.
Hidden controls are inert. Escape dismisses an open corner panel before leaving
CSS expansion; settings/save dialogs retain their own keyboard handling.

**Enter browser fullscreen** requests native fullscreen synchronously with that
control's gesture. Automatic playback uses CSS expansion and does not request it.
The same verified, opaque iframe runs beneath the corner panel, configuration
dialog and save/link prompts. Audio still depends on the browser's user-activation
policy and the napplet's own interaction. Fullscreen is
[subject to browser support and transient activation](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen);
rejection keeps the CSS-expanded player usable.

Browser/system fullscreen exit returns to CSS expansion. **Back to details**, the
second exit control, or Escape while host controls have focus returns to the detail
view. A single native-exit Escape cannot also collapse the expanded player. Settings
and save dialogs get their own Escape first; keystrokes inside the opaque iframe
belong to the napplet, so the corner control remains available. Background
branches become inert while expanded; focus and scrolling restore on exit.

Entering from details pushes a history entry; Back/Forward changes only presentation.
The explicit Back to details action replaces the play entry with its detail URL,
including for a fresh external link; it never sends the visitor to an unknown
previous site. Stop ends the session and returns to details (or the gallery card),
where Play can start it again. Gallery expansion has the same two exit layers and returns to its card.

For the same selected release, the parent detail component, iframe and NAP host stay
mounted. Runtime state, instance storage, session files, settings and subscriptions
survive these changes. Relay hints are captured when starting a release, so route
data refreshes do not tear down a live host. A different release, Stop, Restart,
reload, navigation to source or another creation/page still ends that session.
This is not a site-wide background player or an additional protocol identity.

Verification: `bun run typecheck`, `bun run test`, production build, and
`bun test tests/services/immersive.test.ts tests/services/discovery.test.ts
tests/services/source-browser.test.ts`; existing browser runtime regression checks
also cover settings, account changes, exports and sandboxing. Mobile checks use
Chromium touch emulation in portrait/landscape; a real-device Safari/iOS matrix
remains a follow-up.
This checkpoint passed all 181 repository tests, three service/browser integrations
and 12 existing app/runtime browser tests, alongside typecheck and the production build.

The 2026-09-15 corner revision passed typecheck, the production build, all 227
repository tests, the immersive and discovery browser integrations, and all five
runtime browser checks. Coverage includes cold-link autoplay, full-viewport bounds,
hover/keyboard disclosure, touch reveal/dismiss/return, 320px and 390px portrait and
844px landscape layouts, native fullscreen exit, settings and preserved host state.
Desktop and touch screenshots were inspected locally. This revision has not been
deployed; mobile evidence remains Chromium emulation rather than physical iOS.

The gallery and detail-page share icon opens an anchored choice of **Detail link**
and **Player link**. Both work while signed out. Player links append `/play` to the
same address or pinned revision; they do not create another identity. Copy failures
show a selectable URL in the popup. The immersive player retains its own **Copy play
link** control. A fresh link fills the page, but native browser fullscreen still
requires the visitor's Play/fullscreen gesture.

## Verification

Unit/integration coverage also covers unknown-message silence, successful public-key snapshots at quota, verified NIP-65 preferences independent of relay policy, and late-result suppression across account changes. Standalone CLI browser checks cover the same shim/services, local relay reads, resource mediation, save prompts/downloads, account changes, reloads, capability gating and tampered bytes. Unit/integration coverage exercises storage isolation and quotas, virtual file chunking/revisions/traversal/cancellation, resource scheme/IP/MIME checks, request origin binding, queued cancellation, and actual Applesauce WebSocket queries with forged/duplicate/nonmatching events. Browser tests exercise the published shim, handshake, persistent saves, denied publishing, forged host messages, file downloads and player cleanup.

Read-only public smoke checks: Random Sticker displays/changes stickers and exports a WebP; Rubik Cube renders and plays; Packaged Loader Evidence finishes with all ten resources verified; DJ David Clanker renders its decks and fetches library resources; Nostr Pet reaches its public-account view. These are observations, not a guarantee for every listed app or operation. DJ's optional direct MIDI access remains browser-blocked; playback does not support payments or publication.

Earlier interoperability checkpoint: type checking, 48 unit/integration tests, a production build/startup, and four Chromium playback/export checks passed through Caddy/PM2. The 78 MiB packaged-loader check was skipped in this pass; it passed at the previous 43-test/11-browser-check runtime checkpoint. To repeat the public tests (the optional large fixture downloads 78 MiB):

```sh
TEST_ORIGIN=http://localhost:8080 TEST_PUBLICDEV=1 TEST_LARGE_PUBLIC=1 \
  bunx playwright test tests/browser/public.spec.ts tests/browser/runtime.spec.ts
```


## Standalone creator preview

New CLI projects include the same prelude builder, host and resource responder as the website. The browser hash-checks local bytes before injecting `srcdoc`; the opaque iframe has the same CSP and capability set. The host page permits the inline code/WebAssembly required by inherited `srcdoc` policy, while the frame's stricter CSP removes all network access. Save/link confirmations and downloads are host-owned, and browser-extension connection exercises the same identity lifecycle.

`napplet.json` accepts `requires` (mandatory domains), `relays` (fallback read destinations; explicitly configured literal-loopback WS is also permitted in local preview) and `servers` (Blossom hints). Empty arrays support self-contained experiments. The preview server binds loopback, checks Host/Origin, and admits resource requests only for the current compatible local revision. It reuses production origin, URL/IP, MIME, quota and timeout checks. Local source authority and `previewId` do not impersonate a signed publication or creator key. Publishing is available through the separate CLI publish flow. Updating the CLI updates its preview host; older self-contained generated harness copies retain their old bundled runtime.

This conformance checkpoint passed type checking, 62 unit/integration tests, 15 Chromium checks, and a production build/startup. The separate 78 MiB packaged-resource integration test remains opt-in and was not repeated.

## Configuration checkpoint (2026-09-14, source only)

The shared host now provides NAP-CONFIG in both players, with settings inside the
fullscreen wrapper and a static-schema example in new boilerplates. See
[CONFIGURATION.md](CONFIGURATION.md) for semantics and [COMPATIBILITY.md](COMPATIBILITY.md)
for the operation inventory, tested pins and upstream conformance-runner limitations.
A broader release and independent-client acceptance remain separate agenda work.

## Runtime relay routing — soyLI 0.8.2

Discovery/publication relay lists are fallback destinations, not an exclusive runtime
allowlist. Explicit `outbox` relay hints and verified NIP-65 author write relays can
be read through the shared host. Explicit hints take precedence within the eight-relay
fanout cap; NIP-65 discovery uses at most one third of the query deadline (up to two
seconds). Discovery and the final query share the caller's total time budget.

The website and soyLI use the same same-origin `/api/relay-read` service. It admits
a verified playable manifest (or the current compatible local preview revision),
accepts only bounded Nostr filters, and uses Applesauce without AUTH, signing or
publication. Public reads require WSS on port 443, no URL credentials/fragments,
and public IPs checked at DNS resolution. A temporary authenticated loopback CONNECT
tunnel pins the resolved TCP peer while Bun's native WebSocket validates TLS for the
original hostname. This avoids Bun's Node HTTPS-upgrade defect without changing TLS
verification. Each tunnel accepts one destination/connection, disables compression,
caps incoming wire bytes at 8 MiB and is destroyed on cancellation or deadline.

Local preview additionally permits only literal-loopback WS URLs explicitly listed
in the project's `relays`; this exception is never granted by a website manifest.
The platform dev script also sets `SPACE_RUNTIME_LOCAL_RELAYS` to its managed
literal-loopback relay; production leaves this separate operator setting empty.
Discovery data and napplet manifests cannot set it. The iframe retains `connect-src 'none'`. Private/LAN relays, arbitrary HTTP proxying,
redirects to other destinations and publishing remain unavailable.

Reads retain signature/filter verification and deduplication. Invalid explicit
relay URLs produce a policy error; failed or timed-out queries return incomplete
results, with an error when no events arrived. An empty completed read stays distinct
from a failed lookup. Live streams survive EOSE and close with the player/account.
The service allows 64 concurrent relay reads overall, 32 per manifest and 240 starts
per manifest per minute; each stream is bounded to 8 MiB/2,000 messages and five
minutes for live subscriptions. The existing host caps still apply. A quiet live
subscription sends transport heartbeats to avoid idle HTTP timeouts.

Regression coverage includes a hinted station absent from discovery relays through
the real shared HTTP adapter, forged events, NIP-65 routing, blocked URLs/origins,
current-revision admission, live EOSE, cancellation and quota recovery. External
relay availability remains outside the host's control.


### Read deadlines — soyLI 0.8.3

The caller's `timeoutMs` includes discovery, network reads and reply delivery. The
shared web/preview host reserves 20% of that budget for delivery (minimum 25 ms,
maximum 1 second). Discovery uses at most one third of the remaining budget, capped
at 2 seconds. At the read deadline the host cancels outstanding requests and returns
all verified events collected so far with `incomplete: true`; if none arrived, the
result also carries a retryable read error. It does not stop on the first event.
This prevents a stalled fallback from making the SDK discard an already retrieved
station. External relay availability and a suspended browser remain outside this
bounded request guarantee. No upstream bindings or napplet changes are required.

`bun test tests/services/relay-deadline.test.ts` exercises the actual pinned SDK and
shared preview through HTTP: normal reads, stalled fallback/discovery, empty reads
and `getEvent`. The repository suite also checks later-arriving events and cleanup.
