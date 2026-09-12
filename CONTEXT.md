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
