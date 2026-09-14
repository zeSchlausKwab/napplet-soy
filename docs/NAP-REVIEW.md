# NAP concepts and expansion review

Reviewed **2026-09-14** for [agenda A12](../AGENDA.md#a12--upstream-concept-and-interoperability-review-before-wider-launch).
This records an upstream reading and code comparison, not a completed conformance
audit. The [compatibility inventory](COMPATIBILITY.md) now records the configuration
milestone and actual test coverage. The site is already deployed; the remaining acceptance work precedes a wider
launch. The user's decision that the NIP-5D proposal has authority still applies.

## Sources and revision boundaries

| Source inspected                                                                                                   | Revision / role                                                                                    |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| [NAP registry README](https://github.com/napplet/naps/blob/a040914b4bbd3a5cd8a14b0f316a723c968ebfb2/README.md)     | `a040914b4bbd3a5cd8a14b0f316a723c968ebfb2`, master at review                                       |
| [Web projection](https://github.com/napplet/naps/blob/a040914b4bbd3a5cd8a14b0f316a723c968ebfb2/projections/web.md) | Registry mapping to the [living NIP-5D proposal](https://github.com/nostr-protocol/nips/pull/2303) |
| [NAP-CONFIG](https://github.com/napplet/naps/blob/448013e6d8cb8c75dce49576b3e7c0d46d960eac/naps/NAP-CONFIG.md)     | PR 14, open; head `448013e6d8cb8c75dce49576b3e7c0d46d960eac`                                       |
| [NAP-CVM](https://github.com/napplet/naps/blob/ad68a938236e9230324e377cd005008a315ff402/naps/NAP-CVM.md)           | PR 31, open; head `ad68a938236e9230324e377cd005008a315ff402`                                       |
| [Our protocol baseline](PROTOCOL.md#1-compatibility-baseline)                                                      | NIP-5D `24711d9`; existing kinds and immutable identity behavior                                   |
| [Released CLI pins](../apps/cli/distribution/release-0.4.1.json)                                                   | Current boilerplate/skill/runtime release evidence                                                 |

Registry status is not a statement that our runtime implements a capability. Open
proposal status is not itself a reason to reject the user's selected contract.
Recheck and pin the concrete proposal, shim, SDK, starter and conformance suite
together when implementing an affected capability.

## Concepts to preserve

The [registry](https://github.com/napplet/naps/blob/a040914b4bbd3a5cd8a14b0f316a723c968ebfb2/README.md)
separates these concepts:

- A NAP defines a runtime capability contract; a projection supplies its transport.
- Domains identify capabilities. NAP-SHELL supplies the foundational handshake;
  other capabilities are optional, with dependencies and discoverable support.
- Archetypes describe roles; they are distinct from capability APIs and topic tags.
- Conventions describe shared message semantics, separately from archetypes and NAPs.
- Composition belongs to the host. Self-contained creations can remain valid without
  implementing cross-napplet interaction.

The [web projection](https://github.com/napplet/naps/blob/a040914b4bbd3a5cd8a14b0f316a723c968ebfb2/projections/web.md)
uses opaque sandboxed frames, host-bound message sources and `window.napplet` domain
surfaces. Keep signing, payment authority and provider transport in the trusted host.
Future route/flavor/room conventions should preserve stable identities and validated
payloads; URL presentation must not become a second protocol identity.

The overview mentions manifest kind 35128, while our pinned NIP-5D implementation
uses 35129/15129/5129. Record the layer and revision behind each statement; do not
replace deployed identities based on a general overview. The current proposal head
was rechecked and still matches our NIP-5D pin; no kind migration is needed. The
host-owned injection/handshake decision is recorded in the compatibility matrix. This disagreement
was also identified in [earlier research](RESEARCH.md).

## What the current code actually exposes

The [runtime domain registry](../packages/runtime/src/capabilities.ts) advertises
`shell`, `identity`, `storage`, `theme`, `resource`, `relay`, `outbox`, `common`,
`link`, `fs` and, in the new source milestone, `config`. Several write operations are denied by current policy; domain
presence is not permission for every operation. The upstream
[shim integration](../packages/runtime/src/prelude.ts) and
[host dispatcher](../packages/runtime/src/host.ts) are shared by web and CLI previews.

`cvm`, `intent` and `inc` are not advertised. Account sign-in and surrounding
website zaps do not automatically implement napplet identity-changing or payment
capabilities. Inventory all domains, including deployed `common` and `fs`, against
their exact proposal/SDK sources; the README alone is not a complete compatibility
matrix. Keep unsupported required capabilities visible and accurately classified.

## Configuration implications — A11

[NAP-CONFIG](https://github.com/napplet/naps/blob/448013e6d8cb8c75dce49576b3e7c0d46d960eac/naps/NAP-CONFIG.md)
defines schema-based settings with shell-owned writes, defaults, validation, snapshots
and subscriptions. Its supported JSON Schema subset is bounded, not arbitrary schema
execution; it includes registration acknowledgements, errors, secret annotations and
version hints. Prefer declared schemas where possible and retain the registration
escape hatch. The pinned Vite plugin already embeds `config.schema.json` as a
`napplet-config-schema` meta tag in signed HTML; there is no new manifest event tag.

Our design work must distinguish publication config, napplet-declared schema,
user-selected values, and provider/game rules. Specify author/account scoping,
release upgrades, reset and invalid-value handling. Reuse a single validator and
settings adapter in the CLI harness and live shell, with an example and conformance
fixtures. These are now implemented in the [shared configuration host](CONFIGURATION.md),
with fresh scopes per verified build/account and memory-only secrets. A schema
annotation must never grant a napplet access to a creator key. The compatibility
record distinguishes the upstream runner's boot checks from actual config tests.

## ContextVM implications — A14/A15

[NAP-CVM](https://github.com/napplet/naps/blob/ad68a938236e9230324e377cd005008a315ff402/naps/NAP-CVM.md)
defines direct provider discovery/requests, MCP conveniences and a host-curated
registry. Transport, encryption, correlation and provider policy stay host-owned.
Registry candidates require liveness checks, and schema identity matters when
selecting substitutes. The proposal's `value` dependency is optional for payments;
the overview's dependency column is not enough to infer mandatory payment support.

Matchmaking, rooms and presence are our separately versioned application contracts,
not new NAPs merely because they run on ContextVM. Keep the direct provider path
usable, public activity opt-in and private sessions undisclosed. Complete the bridge
and three gameplay topology examples before declaring a generalized API. Existing
[ContextVM documentation](CONTEXTVM.md) remains the starter's implementation record.

## Wider-launch acceptance still to do

1. Complete the existing operation/evidence matrix with each remaining NAP's exact
   specification revision, dependencies and per-operation conformance tests.
2. Retain the reconciled NIP-5D manifest/bootstrap and CONFIG bindings; finish the
   cross-client packaged-resource/source/preview audit across the chosen toolchain.
3. Publish with our CLI, discover and run in an independent client without our API;
   import an independent creation back. Include configurable creations when A11 ships.
4. Exercise optional/unknown requirements and malformed messages. Keep one verified
   admission/player path for every publisher, including fixtures and paid placements.
5. Review the host interfaces used by source, immersive routing, comments, settings,
   CVM sessions and flavors. Keep UI layout, media representation, identity and
   provider choice independently replaceable without an unrestricted generic RPC.

These remain launch acceptance steps. The configuration implementation does not
claim native projection support, full cross-client conformance or a production
multiplayer service.
