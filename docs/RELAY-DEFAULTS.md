# Public relay defaults

Released in soyLI **0.17.0** and deployed on the website on **2026-09-21**.
Reviewed on **2026-09-20** using [nostr.watch](https://nostr.watch/), relay NIP-11
documents, and direct anonymous WebSocket reads of napplet kinds 15129, 35129 and
5129 with the website's Origin header. No test events were published.

| Relay | Default role |
| --- | --- |
| `wss://relay.napplet.soy` | Primary publication and discovery |
| `wss://nos.lol` | Discovery and optional publication copy |
| `wss://relay.primal.net` | Discovery and optional publication copy |
| `wss://nostr.mom` | Discovery and optional publication copy |
| `wss://relay.pocketstr.com` | Discovery and optional publication copy |

The previous six-relay set returned a napplet event and completed EOSE in that check, in roughly
0.14–0.79 seconds from the development machine. This is a dated availability
sample, not a guaranteed latency, retention period or future write acceptance.
The relay documents did not advertise required payment or authentication for
these reads. Relays may still moderate or reject publications; nostr.mom explicitly
describes stricter spam/content filtering.

[Damus](https://nostr.watch/relays/wss/relay.damus.io) and
[nostr.mom](https://nostr.watch/relays/wss/nostr.mom) showed recent successful monitor
checks; [Pocketstr](https://nostr.watch/relays/wss/relay.pocketstr.com) was also in the
recently seen monitor table supplied during selection. Low RTT alone is insufficient:
the similarly listed Pocketnostr endpoint opened a socket but did not finish the
napplet read within 12 seconds. It was not selected. Nostr.watch is a review source,
not a new runtime dependency or authority over napplet content.

## Configuration and scope

On **2026-09-21**, Damus was removed from the shared defaults following the reported
outage and failed publication mirror. The current set has Soy plus four external
relays; the earlier successful probe is historical evidence, not current availability.

The four external relays live in
[`packages/nostr/discovery-relays.json`](../packages/nostr/discovery-relays.json).
The public website, production index, publicdev discovery and CLI remix lookup
consume that list. Production reads its managed relay internally and advertises
its public address in links and browser settings. Publicdev uses the external list;
ordinary local development remains isolated.

New public creator projects keep Soy as primary and copy the external list into
their editable `publish.networks.public.mirrors` defaults. Publishing still requires
primary acknowledgement before best-effort mirrors. A mirror failure is recorded
and retryable without changing the signed release. Config accepts up to seven
mirrors plus one primary, matching the eight-relay discovery bound.

Explicit operator, browser and project settings remain authoritative. Existing
projects with saved mirror lists keep those lists; use **Manage project → Where it goes.**
in `soyli dev` to edit Extra relay copies, or edit the effective configuration shown
by `soyli config`. `mirrors: []` still disables extra copies. Saved publication jobs
retain their original destinations. Browser users can reset Network settings to
discard a saved custom list and use the operator's defaults.

Signer/NIP-46 and ContextVM transport relay settings are separate and unchanged.
The selected NIP-5D/NAP pins, event validation, deadline bounds and publisher-neutral
admission are unchanged.
