# Napplet playback profile

Implemented 2026-09-12. Open a public card and choose **Play napplet**. Cards distinguish verified, compatible artifacts from missing capabilities and unavailable downloads. Compatibility means this host implements the requested domains; an individual operation can still be refused by policy or fail upstream.

## Standards and integration

Fixtures and relay-imported napplets use the same manifest validator, capability admission, artifact verification, host identity, and resource service. The browser subscription covers named, root, and snapshot kinds without a Space hashtag. Fixture metadata contains no custom snapshot pointer. Public publishing remains a separate unfinished feature; the bundled test key must never be used on public relays.

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
| `relay`    | Filtered query and live subscribe/close                                                          | Host relay allowlist; signatures checked, duplicates removed, filters reapplied; publishing/encryption denied                                                       |
| `outbox`   | Query, getEvent, subscriptions, close, resolveRelays                                             | NIP-65 selection within the operator allowlist, fallback when needed, partial results marked; publishing denied                                                     |
| `common`   | Public NIP-19 encoding/decoding and profile/follows reads                                        | Secret identifiers, nrelay encoding, follow/unfollow/react/report writes denied                                                                                     |
| `resource` | HTTPS and hash-verified Blossom bytes, ordered bulk responses, cancellation, scheme discovery    | `data:` handled locally by upstream shim; no htree/nostr resolver; raw SVG/HTML/XML denied                                                                          |
| `link`     | HTTPS links presented in a host-owned confirmation                                               | User clicks to open; no automatic navigation                                                                                                                        |
| `fs`       | Session virtual files: metadata/list/read/write/mkdir/remove/move/watch, save destination picker | 10 MiB aggregate, 256 KiB chunks, 128 entries, 16 watches; device file/directory pickers unsupported                                                                |

`fs.pickSaveFile()` opens a host prompt. After writes complete, files appear below the player with download links. This does not write into the user's filesystem without a download action. Download session files before stopping the player. Virtual paths are restricted to `/files`; they never map to server or device paths.

Required unsupported domains still gate launch: for example `inc`, `intent`, `config`, `keys`, `media`, `upload`, and `cvm`. Composability, accounts that publish, extended identity lists, arbitrary custom relay connections, filesystem imports, and ContextVM game sessions remain separate additions. Older artifacts that omit required domains may still depend on unavailable APIs.

## Resource and lifecycle boundaries

The iframe remains `sandbox="allow-scripts"`, with no same-origin grant or raw network access. Inline JavaScript and WebAssembly execute within that boundary. Resources are returned as Blobs, not embedded remote URLs. No resource or napplet code executes on the server.

`POST /api/resources` accepts requests from the first-party host, for a known playable manifest from either catalog source. It rejects opaque/cross-origin callers, credentials, non-HTTPS network URLs, alternate ports and redirects. DNS destinations are checked in the actual connection lookup; private/special IPv4/IPv6 destinations are refused. The endpoint forwards no cookies or authorization headers. MIME is classified from bytes. Unknown binary bytes are permitted only for a verified Blossom digest; active document formats are refused even there.

Each resource is capped at 10 MiB. The host queues bursts with four simultaneous fetches, at most 16 outstanding envelopes, 60 resource operations/minute and 128 MiB delivered per play session. The larger session budget accommodates the public packaged-loader fixture's ten assets (78 MiB total). The server separately caps eight concurrent fetches globally and four per manifest, with 20-second overall fetch deadlines. Queued cancellation starts no request. There is no persistent server resource cache; upstream shim cache/Blobs belong to the frame and disappear when it is destroyed.

Relay access is through a frame-owned Applesauce pool. Filters, event counts, request concurrency, relay selection and subscription lifetime are bounded. Live subscriptions close after five minutes or 500 accepted events; the napplet receives a closure notification. Stopping/restarting or navigating away destroys the frame session, closes subscriptions and sockets, aborts resources and pending prompts, and revokes download URLs. Account changes preserve the iframe and its single SHELL handshake: old requests are cancelled, subscriptions close, resources abort, prompts/exports clear, and account-scoped storage/files are replaced before `identity.changed` is sent. Late results are suppressed. Shared saves remain available when returning to the same account; instance storage and virtual files start fresh. Napplets must listen to `identity.onChanged` to refresh their own in-memory account state.

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

`napplet.json` accepts `requires` (mandatory domains), `relays` (explicit host allowlist) and `servers` (Blossom hints). Empty arrays support self-contained experiments. The preview server binds loopback, checks Host/Origin, and admits resource requests only for the current compatible local revision. It reuses production origin, URL/IP, MIME, quota and timeout checks. Local source authority and `previewId` do not impersonate a signed publication or creator key. Publishing is still a separate milestone. Existing generated projects retain their bundled runtime; this change applies to newly scaffolded projects.

This conformance checkpoint passed type checking, 62 unit/integration tests, 15 Chromium checks, and a production build/startup. The separate 78 MiB packaged-resource integration test remains opt-in and was not repeated.
