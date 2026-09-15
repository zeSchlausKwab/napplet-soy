# Names and community

Local A13/A21 additions (2026-09-15, pending deployment): creator links now open
portable `/p/<npub>` pages with ordinary Nostr metadata, all discovered creations,
and an own-profile editor. `@handle` remains a site alias service. Comments and
saved accounts resolve the shared latest kind-0 cache. See [profiles](PROFILES.md)
and the [signed remix family tree](REMIXING.md#genealogy-on-napplet-pages).

Creators can connect their Nostr browser signer, open their napplet, and use **Named link** to claim `/@handle/slug`. Claims are NIP-98 signed HTTP requests bound to this site's exact URL, method, timestamp and JSON body. The signer must own the napplet's decoded Nostr identity. No private key goes to the website.

One account has one handle. A handle has at most 128 links. A claimed link cannot move to a different creation, including when the same owner asks; additional slugs preserve previous links. Concurrent claims are serialized in SQLite. Replayed authorization events, reserved handles and ownership collisions fail. Relay hints are normalized out of identity comparisons. The registry currently caps at 20,000 links.

Aliases resolve the current indexed manifest at request time, so new releases keep the same friendly URL. `/@handle` lists the creator's claimed links. SSR, canonical URLs and OG metadata work on named routes; portable Nostr and immutable event routes remain available. An alias is a site service, not a new Nostr protocol claim or NIP-05 identity.

The web process requires `SPACE_COMMUNITY_DIR`. `bun run dev` and `bun run dev:prod` set it to `.local/services/community`; restart an existing dev process to pick it up. The VPS script sets it to the persistent `community` directory alongside the relay/index state. Back up this directory with the other service state using SQLite's backup mechanism or with the service stopped. The deployment test process explicitly unsets it so tests cannot alter operator data. No automatic deployment is performed by these changes.

## Social actions

Napplet detail pages and gallery cards share likes/unlikes and zaps. Detail pages also have comments, replies and author deletion; the gallery comment bubble opens and focuses the detail composer. Likes and commenting require sign-in, while viewing counts and anonymous zapping do not. Connect a NIP-07 signer through Applesauce. Its returned signature, author and complete event payload are verified. Signing happens in the trusted website; napplet iframe signing permissions remain unchanged.

**Detail toolbar (deployed 2026-09-14 in `20260914171728494-21459`):** named, portable and
pinned pages also show like/count, share and zap icons beneath the creator name.
One `NappletSocial` owner supplies the toolbar, feedback and discussion, so header
and discussion likes stay synchronized without fetching a second conversation or
maintaining separate pending events. A failed header action shows its retry nearby;
retry sends the same signed event and requires the same account. A successful like
fills the heart without adding a visible message row. Existing discussion controls
remain available below the player.

Like stays disabled until signed in and conversation data is available. Share and
zap remain available to guests; the zap dialog can resolve the known signed manifest
without waiting for discussion data and retains its anonymous QR/wallet flow. Sharing
reuses the gallery control's portable URL, checkmark, manual-copy fallback and focus
restoration. Existing scope/signature/payment rules are unchanged. Verified through
the local community integration (including both like controls and exact-event retry),
gallery/player regressions and desktop/mobile browser checks; no production actions
or payments were sent.

Comments use [NIP-22](https://github.com/nostr-protocol/nips/blob/master/22.md) kind 1111 with address-qualified root and parent tags (including the current event reference when available). Replies retain the root and reference their parent comment. Rooted threads survive title changes, aliases and new versions. A snapshot can join an author's address thread only if its signed parent address has the same author; foreign snapshots keep an event-rooted thread. Text is rendered as text, including HTML-looking strings.

Likes use [NIP-25](https://github.com/nostr-protocol/nips/blob/master/25.md) kind 7, with `e`, `p`, `k` and `a` references. Only known verified target manifests contribute, and one actor counts once per creation. Unlike and comment deletion use kind 5, applied only to matching events from the same author. Deleting an older like cannot delete a later like. Deleted comments retain a placeholder for replies.

The server reads and publishes through Applesauce to configured index/discovery relays. Signed events are retained in a bounded SQLite cache: 2,000 rows per thread and 50,000 overall. Finite relay queries retrieve recent comments, reactions, referenced manifests, profiles and deletion markers. Refreshes share a 30-second cache; the UI refresh button retrieves the current view. This is a recent conversation view, not exhaustive historical pagination or a global count. Operator moderation is rechecked on reads and writes, with request-size, timestamp, per-author and global budgets. Production configuration should use the managed relay first.

Publication needs a positive relay acknowledgement. If an acknowledgement is lost, Retry sends the same signed event ID; it does not sign another comment. Counts change after acknowledgement. Signer cancellation leaves the draft intact. A successful publication is distinct from a later refresh failure. Names and events survive web process restarts when their configured state directory is preserved.

## Zaps

[NIP-57](https://github.com/nostr-protocol/nips/blob/master/57.md) zaps use the author's latest verified kind-0 `lud16` or `lud06` profile. LNURL endpoints and callbacks are fetched through the existing bounded HTTPS downloader with DNS checks at connection time, private-network rejection and no redirects. Profiles and payment endpoint metadata remain separate from aliases.

The creator's Lightning service must advertise `allowsNostr`, a receipt-signing pubkey and valid amount limits. The user chooses sats and signs kind 9734 with their connected account, or with a fresh browser-memory key for an anonymous zap. Anonymous mode is automatic while signed out and optional while signed in; it never invokes the profile signer or persists the temporary key. Only the signed request is sent to the server. This hides the Nostr profile association, not network/payment metadata from the wallet service. That request goes to the LNURL callback, not to a Nostr relay. Before showing the invoice, the server checks its BOLT-11 checksum and signature, exact millisatoshi amount, expiry, and description hash against the serialized signed request sent to the callback. The wallet remains responsible for Lightning feature negotiation, route selection and fees.

The invoice offers a locally generated QR code, `lightning:` wallet link and copy control. QR encoding loads lazily in the browser, without a third-party image endpoint. When WebLN is available, **Pay with browser wallet** explicitly enables the wallet and requests payment; invoice creation never pays automatically. Wallet success is labelled as the wallet's report. The total uses kind-9735 receipts verified against the advertised provider, signed request, recipient, target, invoice amount and description; an optional preimage must match the payment hash. Event IDs and payment hashes are deduplicated. A receipt remains the Lightning provider's assertion. Changing providers may make older receipts unverifiable from the current profile.

Current limits: mainnet amount-bearing BOLT-11 invoices, NIP-07 account signing or ephemeral anonymous signing, recent relay history, and whole-satoshi invoice creation capped at 1,000,000 sats. No wallet custody, NWC pairing, automatic payment or real payment was performed during implementation. Split-recipient `zap` tags are detected and explicitly referred to a split-aware client; this UI does not silently pay the author instead. A missing Lightning profile does not prevent comments, likes, or playback. Local-only development does not create zaps without public WSS relay hints.

Validation: `bun run check`; `bun run build && bun test tests/services/community.test.ts tests/services/remix-cli.test.ts`. The latter uses temporary loopback services, the documented public fixture key, a temporary CLI executable, and a simulated wallet. No public events or Lightning payments are sent by these tests.

## Remixing without an installed CLI

The **Remix this** dialog offers both the existing-CLI command and an install-and-remix command:

```sh
curl -fsSL https://napplet.soy/install.sh | sh -s -- remix 'https://napplet.soy/r/REVISION_ID' my-remix
```

Both select the exact revision and preserve remix attribution. The installer forwards
arguments to the verified native CLI; creators do not need Bun or Node installed.

## Reactions to comments

Each visible NIP-22 comment can receive a NIP-25 like and a NIP-57 zap. Reactions target
the comment's event ID, kind 1111 and author. They do not inherit the napplet address or
its author as payment recipient. Likes count unique authors; creators can undo their
own reactions. Deleted comments have no reaction actions. Comment zap invoices and
receipts use the commenter's verified Lightning profile and the same invoice checks
as napplet zaps. Payment still requires an explicit wallet action.

## Gallery and Featured

The homepage reads the standard relay/index collection and sorts newest first. Bundled
examples are no longer prepended as a special collection. The dev seed process still
publishes them to the local services, where discovery treats them like any other napplet.
Legacy direct example links remain available for compatibility.

**Featured** is an explicit gallery selection managed at `/admin`. It is empty by default,
including for existing policy files. Feature a napplet naddr to follow its releases, or
an event ID to select a revision. These actions require the existing administrator's
signed requests, revision checks and replay protection. Selections are stored alongside
moderation state and audited, never added to the creator's signed manifest. Featuring
content does not unblock it or import content that discovery has not indexed.

The **2026-09-15 local revision** adds an ordered hero rotation beside the landing
headline. Admin up/down controls determine priority. The first twelve available,
unblocked selections appear; addresses resolve current releases, event IDs link
to their exact `/r/<id>` revision. Duplicate revisions are shown once. Missing
selections are skipped without deleting their saved policy, and an empty result
retains the original hero artwork. Gallery filters and pagination do not narrow
the editorial hero. The collection refreshes every thirty seconds in a visible tab
and on focus; blocking remains enforced again when opening/playing content.

A single preview rotates every seven seconds. Hover/focus, manual movement, hidden
tabs, offscreen placement and reduced motion stop automatic rotation. Manual arrows
and pause/resume remain available. No napplet executes until the normal player flow.
The terminal remains first on mobile with Featured below it. These features are
verified locally, pending deployment, and remain separate from paid placement.

## Gallery social discovery

Every normal gallery card shows unique-author likes, visible comments/replies, verified
zap receipt count, and sats received. Unknown/unavailable counts use a dash rather than
zero. The comment bubble is disabled while signed out; signed-in navigation opens the
canonical portable detail route with `#comments` and focuses the composer after data
loads. A direct logged-out hash link focuses the sign-in control, retaining the focus
intent after connecting. Comment likes and replies follow the same sign-in rule.

Gallery and ranking cards also offer an icon-only **Share** control (verified and
deployed on 2026-09-14 in `20260914171728494-21459`). It copies this site's portable
`/n/<naddr>` detail URL, or `/r/<event-id>` for an entry without an address. Sharing
does not require signing in or depend on social counts, and does not navigate or
start playback. Success briefly changes the icon to a checkmark with a screen-reader
announcement. If clipboard access is blocked, a dialog provides a selected, read-only
URL for manual copying; closing it restores focus to the share button. Example cards
use the same control. Local browser checks cover these paths and mobile card/rail fit.

Most liked, Most zapped and Most commented are scroll-snap carousels with manual arrows,
keyboard/touch scrolling and reduced-motion handling. They rank the full matching
indexed collection, independently of the grid's current page, and obey the same
search/tag, availability, Featured and moderation filters. Zero/unknown entries are
excluded; ties use newest manifest then event ID. Most zapped ranks by total millisats,
not number of invoices or receipt events. All card copies coordinate one active player.

`GET /api/gallery-social` serves counts and up to 12 entries per ranking. A single
rotating web-process job refreshes at most 24 threads per 30-second window with at most
three concurrent thread refreshes; requests share the existing social-service cache.
The rotation includes older pages and unavailable entries, keeping future filter
changes covered. Counts accumulate from the persistent bounded history; cold caches
fill progressively during visits. The browser polls one endpoint every 30 seconds
(5 seconds during an active sweep), suspending requests while hidden. An action
acknowledgement refreshes the counts. There is no per-card browser relay subscription
and no relay wait in the page's SSR loader.

These are recent, locally observed counts, not exhaustive global totals or a fixed
calendar-period leaderboard. Zap aggregation reuses the detail receipt validator and
deduplicates payment hashes. LNURL endpoint lookups are only needed when receipts
exist, cached for 60 seconds by verified profile revision, and capped in memory;
failed verification leaves zap totals unknown while likes/comments stay usable.
Moderation is applied again at read time. Anonymous receipts are verified and counted
exactly like named receipts. Neither creating an invoice nor a WebLN success message
increments a total.

Gallery signing verifies the selected identity and payload, keeps a failed signed
like for an exact-event retry, and gates retry on the matching account. Counts and
carousels never sign automatically. Browsers may still inspect existing conversations
through ordinary detail links while signed out.

Verification: `bun test packages/community/src`; `bun run build` followed by
`bun test tests/services/community.test.ts tests/services/gallery-social.test.ts`.
These use temporary databases/local relay events and simulated invoices/wallets;
no production Nostr events or Lightning payments are sent.
