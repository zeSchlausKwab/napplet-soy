# Compatibility evidence and remaining audit

Updated **2026-09-14**, agenda A12. This records the current implementation and
evidence, not a declaration that every NAP is fully implemented. Configuration is
verified in source/local production builds and public browser checks. CLI 0.5.0
and website release `20260914142718446-76864` include the configuration host.

## Authority and pins

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
Only CONFIG's full proposal was reconciled in this milestone; mapping the remaining
domains to individual NAP revisions/dependencies is still open before wider launch.

| Domain | Supported surface / explicit policy | Implementation and evidence |
| --- | --- | --- |
| `shell` | ready/init once, supports, ready callback, services; empty named-service list | `runtime/prelude.ts`, `host.ts`; runtime browser handshake and unknown-message tests |
| `identity` | getPublicKey, getRelays (NIP-65), getProfile, getFollows, getMutes, changed push; getList/getZaps/getBlocked/getBadges return unsupported-policy errors | `nostr/playback.ts`, host account scopes; playback unit tests and account-switch browser test |
| `storage` | get/set/remove/keys; shared and instance SDK scopes; bounded strings/keys; no device/cloud sync | `runtime/storage.ts` and tests; runtime browser persistence/isolation |
| `theme` | get fixed Space theme; installed onChanged hook has no changing theme to announce yet | `runtime/host.ts`; shim/theme browser checks; dynamic theme acceptance remains open |
| `resource` | info, bytes, bytesMany, cancel; shim data URL/object URL helpers; HTTPS/Blossom mediation; unsupported schemes and unsafe destinations/formats rejected | `runtime/host.ts`, backend resource responder; resource tests, queued cancellation, public packaged-loader historical check |
| `relay` | query/subscribe/close on allowed relays; publish/publishEncrypted denied | `nostr/playback.ts`; actual WebSocket fixtures, signature/filter/dedup tests; denied publish browser test |
| `outbox` | getEvent/query/subscribe/close/resolveRelays; bounded NIP-65 planning, incomplete results; publish denied | Same Applesauce implementation; playback tests. No signer is installed in the iframe |
| `common` | public encodeNip19/decodeNip19, getProfile, follows; follow/unfollow/react/report denied; secret identifiers and nrelay encoding denied | `nostr/playback.ts` and tests; complete per-operation upstream acceptance still open |
| `link` | open an HTTPS link through a host-owned user choice; other schemes/credentials denied | `runtime/host.ts`; CLI browser prompt policy checks |
| `fs` | info, stat/list/read/write/mkdir/remove/move/watch/unwatch, pickSaveFile; pickFile/pickFiles/pickDirectory explicitly unsupported; paths confined to session /files | `runtime/filesystem.ts` and tests; browser user choice/download/cleanup; no native filesystem grant |
| `config` | registerSchema/get/subscribe/unsubscribe/openSettings; schema snapshot and schemaError notifications; validated host-owned edits | `runtime/config-*`, shared settings panel; configuration unit/service/browser tests; [precise limits](CONFIGURATION.md) |

No `cvm`, `inc`, `intent`, `keys`, `media`, `notify`, `upload`, payment, raw-device
or unrestricted signing capability is advertised. Required unavailable domains
gate playback uniformly for every publisher. Website social signing is separate
from a napplet's grants. The ContextVM process does not imply a browser CVM bridge.

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
2. Use an independent client to discover and run an actual CLI publication using
   only its standard relay/Blossom bindings, then import an independent publication
   back. Include a configurable artifact. Local reference boot is not this test.
3. Reconcile CONFIG's required-but-unset snapshot wording, depth interpretation and
   object-enum edge cases with other implementations; see CONFIGURATION.md.
4. Verify the new configuration behavior on the deployed website and packaged CLI
   after an explicitly requested release. Keep the current release pins truthful.
5. Retain the A15/A16 boundaries for alternate CVM providers, multiplayer contracts
   and shell flavors. Neither composition nor Space metadata becomes mandatory.
