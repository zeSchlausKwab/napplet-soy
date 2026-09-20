# Compatibility evidence and remaining audit

Updated **2026-09-20**. This records the current implementation and
evidence, not a declaration that every NAP is fully implemented. Configuration is
verified in source/local production builds and public browser checks. CLI 0.5.0
and website release `20260914142718446-76864` include the configuration host.
The 0.14.1 starter interoperability fix was published on 2026-09-20;
[independent-client acceptance](INTEROPERABILITY.md) records its narrower coverage.

## Authority and pins

Controller tooling in **0.16.0 source** uses native browser Gamepad input; it is
not an advertised NAP domain and changes no pins or iframe grants. Seven helper
tests cover edges, dead zones, mapping, multiple slots and lifecycle/error states.
Two Chromium browser tests cover the actual preview sandbox, the workshop tester,
focus changes, synthetic inputs, mobile width, explicit mapping and real
Permissions-Policy denial. These do not certify physical controllers or other
browsers/operating systems. The final ARM64 executable passed its preview/capture
smoke test and includes the guide/helper; other platform archives are build-only.
See [controller behavior and remaining checks](CONTROLLERS.md). Not deployed.

A13/A21 local update (2026-09-15): profile metadata and ancestry were checked against
NIP-01, NIP-24 and NIP-5A at
[`a2494f4f81d46684e5814a9bf35e2b1df978f955`](https://github.com/nostr-protocol/nips/tree/a2494f4f81d46684e5814a9bf35e2b1df978f955).
The NIP-5D, runtime and creator pins below are unchanged. Host kind-0 edits and
genealogy add no required manifest metadata, guest signing permissions or new NAPs.
See [profiles](PROFILES.md) and [ancestry semantics](REMIXING.md#genealogy-on-napplet-pages).

| Contract/tool | Selected baseline |
| --- | --- |
| NIP-5D | [PR 2303, 24711d9c47bbdd07908bf1d52bf677d9cbc530f0](https://github.com/dskvr/nips/blob/24711d9c47bbdd07908bf1d52bf677d9cbc530f0/5D.md); rechecked current proposal head on 2026-09-14 |
| Registry concepts | [naps a040914b4bbd3a5cd8a14b0f316a723c968ebfb2](https://github.com/napplet/naps/tree/a040914b4bbd3a5cd8a14b0f316a723c968ebfb2); overview does not override NIP-5D |
| NAP-CONFIG | [PR 14, 448013e6d8cb8c75dce49576b3e7c0d46d960eac](https://github.com/napplet/naps/blob/448013e6d8cb8c75dce49576b3e7c0d46d960eac/naps/NAP-CONFIG.md) |
| NAP-MEDIA | [PR 10, 2b2d29e90c30b994bf5035a65b57e5fe7f08a9a2](https://github.com/napplet/naps/blob/2b2d29e90c30b994bf5035a65b57e5fe7f08a9a2/naps/NAP-MEDIA.md); shared audio subset, source verified 2026-09-15, not yet deployed |
| Host bindings | `@napplet/shim` 0.30.0, `@napplet/nap` and `@napplet/core` 0.32.0; root bun.lock |
| Maintained starter | [boilerplate cbbebe9bd56271277b054535c0a8d720a588f61d](https://github.com/napplet/boilerplate/tree/cbbebe9bd56271277b054535c0a8d720a588f61d) |
| Creator tooling | Starter pnpm-lock: SDK 0.24.4 / nap+core 0.28.0, Vite plugin 0.11.2, conformance CLI 0.2.15 / engine 0.13.0, Vite 6.4.3, TypeScript 5.9.3 |
| Creator instructions | [napplet 976ad0549c38f93d4ed418d3ea59a615a7e5fd7f](https://github.com/napplet/napplet/tree/976ad0549c38f93d4ed418d3ea59a615a7e5fd7f); bundled skill bodies unchanged |

NIP-5D remains authoritative by user decision, including while its PR is open.
Its named/root/snapshot kinds remain **35129/15129/5129**. The registry overview's
35128 describes a different baseline; changing kind based on that overview would
break deployed identities. No kind migration is needed for this update.

The browser host injects `window.napplet` before creator scripts. Application code
uses the SDK and optional-domain checks; it does not install a shim or initiate
a bootstrap. Our injected prelude also performs the NAP-SHELL handshake for the
host's source-bound dispatcher and supports older callers. This is a host adapter,
not a requirement imposed on a standard published artifact.

Single-file HTML and packaged resource manifests retain the NIP-5A path/aggregate
hash bindings selected by NIP-5D. Verification precedes CSP/shim injection. Space
preview descriptors, source archive/commit hints and aliases are optional; their
absence cannot block another publisher's otherwise compatible artifact.

## Operation inventory

Public namespaces below are installed by the pinned shim. Request names come from
`packages/runtime/src/capabilities.ts`; shim-only helpers wrap these operations.
Evidence names are repository tests, not a substitute for an exact-proposal audit.
CONFIG plus the FS/UPLOAD/COMMON/LISTS contracts were reconciled against selected
proposal revisions; mapping the remaining domains to individual NAP revisions/dependencies is still open before wider launch.

| Domain | Supported surface / explicit policy | Implementation and evidence |
| --- | --- | --- |
| `shell` | ready/init once, supports, ready callback, services; empty named-service list | `runtime/prelude.ts`, `host.ts`; runtime browser handshake and unknown-message tests |
| `identity` | getPublicKey, getRelays (NIP-65), getProfile, getFollows, getMutes, changed push; getList/getZaps/getBlocked/getBadges return unsupported-policy errors | `nostr/playback.ts`, host account scopes; playback unit tests and account-switch browser test |
| `storage` | get/set/remove/keys; shared and instance SDK scopes; bounded strings/keys; no device/cloud sync | `runtime/storage.ts` and tests; runtime browser persistence/isolation |
| `theme` | get fixed Space theme; installed onChanged hook has no changing theme to announce yet | `runtime/host.ts`; shim/theme browser checks; dynamic theme acceptance remains open |
| `resource` | info, bytes, bytesMany, cancel; shim data URL/object URL helpers; HTTPS/Blossom mediation; unsupported schemes and unsafe destinations/formats rejected | `runtime/host.ts`, backend resource responder; resource tests, queued cancellation, public packaged-loader historical check |
| `relay` | query/subscribe/close on allowed relays; publish/publishEncrypted denied | `nostr/playback.ts`; actual WebSocket fixtures, signature/filter/dedup tests; denied publish browser test |
| `outbox` | getEvent/query/subscribe/close/resolveRelays; bounded NIP-65 planning, incomplete results; publish denied | Same Applesauce implementation; playback tests. No signer is installed in the iframe |
| `common` | Public NIP-19 helpers including nrelay, profile/follows and approved follow/unfollow/react/report | Shared action session; signed event targets; action/unit and real-shim browser tests |
| `link` | open an HTTPS link through a host-owned user choice; other schemes/credentials denied | `runtime/host.ts`; CLI browser prompt policy checks |
| `fs` | Session operations plus file/multiple-file/directory import copies and export picker | Atomic virtual copies only; filesystem/unit and real-shim browser tests |
| `upload` | info/upload/status, Blossom rail, asynchronous verified URLs and status changes | Connected viewer, approved destination, bounded bytes; no NIP-96/transforms |
| `lists` | supported/add/remove; public items on 13 advertised list kinds | Opaque encrypted content preserved; no private mutation; strict relay read and conflict checks |
| `config` | registerSchema/get/subscribe/unsubscribe/openSettings; schema snapshot and schemaError notifications; validated host-owned edits | `runtime/config-*`, shared settings panel; configuration unit/service/browser tests; [precise limits](CONFIGURATION.md) |

MEDIA update, 2026-09-15: the shared source host advertises `media`, using the pinned
proposal's Wire Protocol spellings (matching shim 0.30.0). Shell-owned HTTPS audio
supports create/update/destroy, play/pause/stop/volume and state/capabilities/controls.
Napplet-owned sessions, video, playlists, seeking and non-URL source resolution are
explicitly unsupported. Artwork/context do not cause fetching. Session/transport
unit tests, the real-shim CLI browser test, the Drone Zone live stream and the VPS
Node fallback were exercised. See [MEDIA.md](MEDIA.md) for limits and release status.

No `inc`, `intent`, `keys`, `notify`, payment, raw-device
or unrestricted signing capability is advertised. Required unavailable domains
gate playback uniformly for every publisher. Website social signing is separate
from a napplet's grants.

The 2026-09-17 source implements the shared NAP-CVM and NAP-WEBRTC browser/CLI
bridge. [ContextVM](CONTEXTVM.md) records the exact surface, application contracts,
signaling profile and remaining connectivity acceptance. The actual-shim test
exercises encrypted scores, matchmaking and forced TURN payloads in two browser
contexts. This is local evidence, not a public-network or deployment claim.

## Configuration findings in the upstream toolchain

The Vite plugin uses `config.schema.json` and embeds `napplet-config-schema` in
the artifact. NIP-5D does not define an additional configuration-schema event tag.
We use the plugin's existing artifact path and revalidate it in the host/publisher.

The pinned plugin permits local `$ref` values; the selected NAP-CONFIG proposal
forbids every reference. Our validator rejects them. Server-side attribute decoding
uses [entities](https://github.com/fb55/entities) because Bun's HTMLRewriter returns
raw attribute entities while browser DOM attributes are already decoded.

The shim tracks runtime schema registration, but not the static build declaration.
The prelude supplies the validated static snapshot and a copying getter without
adding wire messages. It also supports `close()` on the error subscription while
preserving the shim's function-based unsubscribe behavior. The SDK remains unchanged.

The starter's guidance test originally asserts that no schema file exists. Its
adapter now checks the static example is an object; the remaining guidance checks,
package versions, Vite configuration, lockfile and upstream skills stay intact.

The unmodified conformance 0.13.0 reference harness creates empty domain objects
except for resource helpers. Thus `config` exists but has no subscribe method.
The optional starter example retains its CSS defaults if subscription setup fails.
The reference runner then reports **5 passed / 0 failed / 5 skipped**. This proves
boot and absence handling only: no manifest was resolved, no configuration wire
traffic was exercised and lifecycle was not measured. Our real-shim tests separately
exercise registration, schemas, snapshots, form edits, reset/cancel, fullscreen,
persistence, secrets, account changes and rebuilds.

## Wider-launch work still open

1. Pin and audit every remaining NAP's exact proposal/dependency/operation contract.
   Installed SDK methods and a green boot test alone do not prove conformance.
2. Expand the independent-client acceptance beyond the verified Paja 0.16.4 path:
   Soy publications resolve and run through its standard relay/Blossom bindings;
   independent fixture bytes in upstream-built root/named/snapshot manifests load
   back into Soy. Configuration defaults and a Blossom image are covered. Full
   upstream interactive publishing, more domains/clients and public-network behavior
   remain outside this test; see [exact evidence](INTEROPERABILITY.md).
3. Reconcile CONFIG's required-but-unset snapshot wording, depth interpretation and
   object-enum edge cases with other implementations; see CONFIGURATION.md.
4. Verify the new configuration behavior on the deployed website and packaged CLI
   after an explicitly requested release. Keep the current release pins truthful.
5. Retain the A15/A16 boundaries for alternate CVM providers, multiplayer contracts
   and shell flavors. Neither composition nor Space metadata becomes mandatory.

The 0.15.0 source profile is `space-playback-4`; FS #88, UPLOAD #33, COMMON #67
and LISTS #68 are pinned in [NAP-REVIEW](NAP-REVIEW.md). [Runtime actions](RUNTIME-ACTIONS.md)
records the supported subset and verification; full NAP conformance is not claimed.
