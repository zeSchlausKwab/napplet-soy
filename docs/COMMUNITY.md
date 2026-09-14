# Names and community

Creators can connect their Nostr browser signer, open their napplet, and use **Named link** to claim `/@handle/slug`. Claims are NIP-98 signed HTTP requests bound to this site's exact URL, method, timestamp and JSON body. The signer must own the napplet's decoded Nostr identity. No private key goes to the website.

One account has one handle. A handle has at most 128 links. A claimed link cannot move to a different creation, including when the same owner asks; additional slugs preserve previous links. Concurrent claims are serialized in SQLite. Replayed authorization events, reserved handles and ownership collisions fail. Relay hints are normalized out of identity comparisons. The registry currently caps at 20,000 links.

Aliases resolve the current indexed manifest at request time, so new releases keep the same friendly URL. `/@handle` lists the creator's claimed links. SSR, canonical URLs and OG metadata work on named routes; portable Nostr and immutable event routes remain available. An alias is a site service, not a new Nostr protocol claim or NIP-05 identity.

The web process requires `SPACE_COMMUNITY_DIR`. `bun run dev` and `bun run dev:prod` set it to `.local/services/community`; restart an existing dev process to pick it up. The VPS script sets it to the persistent `community` directory alongside the relay/index state. Back up this directory with the other service state using SQLite's backup mechanism or with the service stopped. The deployment test process explicitly unsets it so tests cannot alter operator data. No automatic deployment is performed by these changes.

## Social actions

A napplet detail page has comments, replies, likes/unlikes, author deletion and zaps. Connect a NIP-07 signer through Applesauce. Its returned signature, author and complete event payload are verified. Signing happens in the trusted website; napplet iframe signing permissions remain unchanged.

Comments use [NIP-22](https://github.com/nostr-protocol/nips/blob/master/22.md) kind 1111 with address-qualified root and parent tags (including the current event reference when available). Replies retain the root and reference their parent comment. Rooted threads survive title changes, aliases and new versions. A snapshot can join an author's address thread only if its signed parent address has the same author; foreign snapshots keep an event-rooted thread. Text is rendered as text, including HTML-looking strings.

Likes use [NIP-25](https://github.com/nostr-protocol/nips/blob/master/25.md) kind 7, with `e`, `p`, `k` and `a` references. Only known verified target manifests contribute, and one actor counts once per creation. Unlike and comment deletion use kind 5, applied only to matching events from the same author. Deleting an older like cannot delete a later like. Deleted comments retain a placeholder for replies.

The server reads and publishes through Applesauce to configured index/discovery relays. Signed events are retained in a bounded SQLite cache: 2,000 rows per thread and 50,000 overall. Finite relay queries retrieve recent comments, reactions, referenced manifests, profiles and deletion markers. Refreshes share a 30-second cache; the UI refresh button retrieves the current view. This is a recent conversation view, not exhaustive historical pagination or a global count. Operator moderation is rechecked on reads and writes, with request-size, timestamp, per-author and global budgets. Production configuration should use the managed relay first.

Publication needs a positive relay acknowledgement. If an acknowledgement is lost, Retry sends the same signed event ID; it does not sign another comment. Counts change after acknowledgement. Signer cancellation leaves the draft intact. A successful publication is distinct from a later refresh failure. Names and events survive web process restarts when their configured state directory is preserved.

## Zaps

[NIP-57](https://github.com/nostr-protocol/nips/blob/master/57.md) zaps use the author's latest verified kind-0 `lud16` or `lud06` profile. LNURL endpoints and callbacks are fetched through the existing bounded HTTPS downloader with DNS checks at connection time, private-network rejection and no redirects. Profiles and payment endpoint metadata remain separate from aliases.

The creator's Lightning service must advertise `allowsNostr`, a receipt-signing pubkey and valid amount limits. The user chooses sats and signs kind 9734. That request goes to the LNURL callback, not to a Nostr relay. Before showing the invoice, the server checks its BOLT-11 checksum and signature, exact millisatoshi amount, expiry, and description hash against the serialized signed request sent to the callback. The wallet remains responsible for Lightning feature negotiation, route selection and fees.

The invoice offers a `lightning:` wallet link and copy control. When WebLN is available, **Pay with browser wallet** explicitly enables the wallet and requests payment; invoice creation never pays automatically. Wallet success is labelled as the wallet's report. The total uses kind-9735 receipts verified against the advertised provider, signed request, recipient, target, invoice amount and description; an optional preimage must match the payment hash. Event IDs and payment hashes are deduplicated. A receipt remains the Lightning provider's assertion. Changing providers may make older receipts unverifiable from the current profile.

Current limits: mainnet amount-bearing BOLT-11 invoices, NIP-07 signing, recent relay history, and whole-satoshi invoice creation capped at 1,000,000 sats. No wallet custody, NWC pairing, automatic payment or real payment was performed during implementation. Split-recipient `zap` tags are detected and explicitly referred to a split-aware client; this UI does not silently pay the author instead. A missing Lightning profile does not prevent comments, likes, or playback. Local-only development does not create zaps without public WSS relay hints.

Validation: `bun run check`; `bun run build && bun test tests/services/community.test.ts tests/services/remix-cli.test.ts`. The latter uses temporary loopback services, the documented public fixture key, a temporary CLI executable, and a simulated wallet. No public events or Lightning payments are sent by these tests.
