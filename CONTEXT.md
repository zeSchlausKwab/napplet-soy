# Napplet discovery

A shared vocabulary for browsing and creating small, self-contained creations.

## Language

**Napplet**:
A self-contained creation with a Nostr identity, such as a game, visual experiment, toy, or meme. Its publisher or discovery source does not define its type.
_Avoid_: Public napplet as a separate class of creation

**Topic tag**:
An optional creator-provided subject label. A napplet may have several topic tags or none; topics describe content rather than where it was published.
_Avoid_: Exclusive category, source category

**Provenance**:
The origin of an indexed record, such as relay discovery or a bundled development fixture. Provenance is distinct from the napplet's topics and playback requirements.

**Development fixture**:
A bundled example used to exercise creation and playback locally. A signed fixture is not a public publication until its manifest and artifacts have been published.
_Avoid_: Private napplet

**Flavor**:
A selectable, remixable interface for browsing and interacting with napplets. A flavor changes the experience without changing the identity of the creations it presents.
_Avoid_: Theme when the layout and behavior also change

**Theme**:
A set of appearance choices, such as colors and fonts, that a flavor or napplet may adopt.

**Host**:
The trusted environment that loads napplets and mediates their granted capabilities. The host retains authority when the user selects another flavor.

## Direct protocol access — source update, 2026-09-15

The interactive client resolves Nostr data directly through Applesauce and loads
original media/Blossom URLs. Network settings persist browser-owned relay and
fallback storage choices. Server APIs remain only for site policy/admin, readable
name claims, health, generated OG and optional publication-index confirmation.
SSR loaders keep server implementations; browser navigation/refresh uses direct
protocol implementations. Shared soyLI preview/remix source follows the same model.
See docs/PROTOCOL-ACCESS.md for the inventory and bounds. This update is deployed in website release
`20260915191931258-56634` (source `9e17ae3`), with soyLI 0.9.0.
Existing local CLI installations need the installer rerun to receive the update.
