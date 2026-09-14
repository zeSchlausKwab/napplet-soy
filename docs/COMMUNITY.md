# Names and community

Creators can connect their Nostr browser signer, open their napplet, and use **Named link** to claim `/@handle/slug`. Claims are NIP-98 signed HTTP requests bound to this site's exact URL, method, timestamp and JSON body. The signer must own the napplet's decoded Nostr identity. No private key goes to the website.

One account has one handle. A handle has at most 128 links. A claimed link cannot move to a different creation, including when the same owner asks; additional slugs preserve previous links. Concurrent claims are serialized in SQLite. Replayed authorization events, reserved handles and ownership collisions fail. Relay hints are normalized out of identity comparisons. The registry currently caps at 20,000 links.

Aliases resolve the current indexed manifest at request time, so new releases keep the same friendly URL. `/@handle` lists the creator's claimed links. SSR, canonical URLs and OG metadata work on named routes; portable Nostr and immutable event routes remain available. An alias is a site service, not a new Nostr protocol claim or NIP-05 identity.

The web process requires `SPACE_COMMUNITY_DIR`. `bun run dev` and `bun run dev:prod` set it to `.local/services/community`; restart an existing dev process to pick it up. The VPS script sets it to the persistent `community` directory alongside the relay/index state. Back up this directory with the other service state using SQLite's backup mechanism or with the service stopped. The deployment test process explicitly unsets it so tests cannot alter operator data. No automatic deployment is performed by these changes.
