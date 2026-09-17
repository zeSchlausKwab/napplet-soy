# Shared scores and peer sessions with soyLI

This guide ships in every soyLI project as `docs/napplet-backend.md`.
It describes the Soy v1 service contract and the standard NAP-CVM / NAP-WEBRTC
APIs. The app owns game rules, simulation, synchronization and UI. The host owns
transport keys, Nostr connections, signaling, peer connections and permissions.

The host asks once before connecting to peers and remembers the player's Allow
or Block choice in that browser for the host site. Players can change it in
Network settings (also available in soyLI preview). Dismissing leaves it unset;
blocked requests return an error. Keep a retry path in your connection UI.
Direct connections and TURN fallback are automatic; no TURN controls are needed
inside your napplet. The setting does not grant access to unfamiliar CVM providers.

## Enable a backend

In an existing or new boilerplate:

```sh
soyli skills update
soyli backend init
```

`init` adds `backend` to `napplet.json`, binds your selected creator, and resolves
the site's default public provider. It never uploads a game. If that provider is
offline, local preview still works; run `backend sync` and rebuild when available.
Read the printed provider key and relay destinations. They remain editable:

```json
{
  "backend": {
    "provider": { "pubkey": "<64-character-provider-public-key>", "relays": ["wss://relay.napplet.soy"] },
    "boards": [
      { "board": "highscore-v1", "title": "High scores", "order": "highest", "minimum": 0, "maximum": 1000000 }
    ]
  }
}
```

This is a fragment to merge into the existing file, not a replacement project.
Use `boards: []` for matchmaking without scores. The CLI generates public
`soy-backend.json` with `{version, napplet, provider, boards}`. Import it from your
source (`import backend from '../soy-backend.json'` in `src/main.ts`). Do not
handwrite its naddr, copy a different creator's namespace, or put secrets in it.
Keep it in the source release so other creators can inspect the destinations.

Add `cvm` to the existing Vite plugin's `requires` array, and `webrtc` if peer
connections are essential. Retain other requirements and the upstream build.
Use the injected `window.napplet` APIs through the upstream SDK; never create a
second iframe bridge or an RTCPeerConnection in the sandbox.

```sh
soyli dev          # rebuilds in the shared host, with isolated local backend data
soyli build
soyli check
soyli publish --dry-run
soyli publish      # registers configured boards with creator authorization
```

The default local preview starts the **same CVM implementation** used by the
website, with its own loopback relay and SQLite data in `.napplet-space/backend`.
It maps the configured provider to the local one: preview scores never reach the
public board. Screenshot/record/publish checks create a fresh temporary backend
with the same configured boards, so automated captures do not submit public scores.
No global Bun/Node or separate backend setup is needed. Restart
`dev` after changing board definitions. Changed immutable rules need a new board
ID; ordinary rebuilds preserve scores. Two separate browser profiles/contexts can
join the same dev URL. Duplicated tabs can inherit the same session identity; use
separate contexts for independent players. Remote-device preview/TURN is not
configured by the default loopback preview.

`soyli backend status` probes the selected public provider over encrypted Nostr.
`soyli backend sync` explicitly registers boards ahead of publishing. If it pins
or changes a provider, rebuild afterward. `publish --resume` resumes frozen bytes
and does not change backend configuration. Existing creations need a CLI update,
`skills update`, and a restarted dev server; no re-scaffolding is required.

## Calling the service

The following examples are JavaScript; use the upstream SDK's types in TypeScript.
Obtain the injected namespace after the boilerplate's existing ready handshake.
The published artifact must import the generated context so it knows its own
stable author-qualified naddr. Relay hints are not part of namespace identity.

```js
import { cvm, webrtc } from '@napplet/sdk';
import backend from '../soy-backend.json';

async function call(tool, args = {}) {
  // The preview host maps this public provider to the isolated local service.
  // Before the default provider is available, the configured registry also works.
  const result = backend.provider
    ? await cvm.callTool(backend.provider, tool, args)
    : await cvm.registry.call(
        tool.startsWith('soy_board_') ? 'soy.boards.v1'
          : tool.startsWith('soy_match_') ? 'soy.matchmaking.v1' : 'soy.rooms.v1',
        tool, args);
  if (result.isError) {
    throw new Error(result.content?.filter(x => x.type === 'text').map(x => x.text).join('\n') || 'Backend request failed');
  }
  return result.structuredContent;
}
const { actor } = await call('soy_session');
```

The transport actor is a host-owned key scoped to this browser tab, napplet and
viewer. It is shared by CVM and WebRTC, survives a reload in that tab, and is
separate from a logged-in Nostr profile. Guests work without signing in. Never
use the creator's key for gameplay or interpret an actor as a verified human.
Closing the tab/session can start a new player identity. Clearing storage loses
that guest's personal-best association, while the shared board remains intact.

`cvm.request`, `callTool`, discovery, provider close and the configured registry
are available. `registry.describe(family)` returns tool schemas and per-tool
CEP-15 hashes. Registry families are Soy contracts, not new NAP browser methods.
Another provider needs user permission. No automatic provider failover migrates
state; switching infrastructure is an explicit creator/operator decision.
Payment-required results remain errors; there is no wallet authorization here.
Generic streams, sampling, arbitrary uploaded backend code and server game
simulation are not provided by this service.

## Shared scoreboard

```js
const ref = { napplet: backend.napplet, board: 'highscore-v1' };
await call('soy_board_submit', { ...ref, score: finalScore, name: playerName });
const { rows, own, trust } = await call('soy_board_read', { ...ref, limit: 20 });
// rows: [{ actor, score, name, updated }]; own: row or null
```

Render names as plain text. Submit at the end of a run; poll at most every two
seconds while visible. A repeat or worse score cannot inflate the best result.
Use `lowest` for race times. Scores are finite numbers within the registered range.
`trust` is `client-reported`: this is a casual board, not anti-cheat or suitable
for prizes. Creator authorization protects the board's rules, not score truth.

Board registration is signed by the naddr's author, bound to the provider and
requesting transport actor. soyLI handles this with the selected local or NIP-46
creator. Rules persist across releases; an incompatible change uses a new ID
(e.g. `highscore-v2`). Remixing creates a new naddr and must register separate
boards. Public provider data is not copied into a remix or local preview.

## Matchmaking to WebRTC

Choose an application protocol label that describes compatible game messages.
The same naddr, protocol, queue and requested player count match together. Bump
the protocol when messages/rules become incompatible; no self-referential build
hash is required. Player count is an application choice within provider limits.

```js
const protocol = 'my-game-v1';
let ticket = await call('soy_match_join', {
  napplet: backend.napplet, protocol, queue: 'casual', players: desiredPlayers
});
while (ticket.state === 'waiting') {
  await new Promise(resolve => setTimeout(resolve, 2000));
  ticket = await call('soy_match_status', { ticket: ticket.ticket });
}
if (ticket.state !== 'matched') throw new Error('Match closed; join again');

let sessionId;
const stopEvents = webrtc.onEvent(event => {
  if (event.sessionId !== sessionId) return;
  if (event.type === 'peer') updatePeer(event.pubkey, event.state);
  if (event.type === 'message') validateAndApply(event.from, event.payload);
  if (event.type === 'closed') showReconnect(event.reason);
});
const { session } = await webrtc.open({
  scope: { type: 'room', room: ticket.room, peers: ticket.peers },
  channel: 'game', protocol
});
sessionId = session.id;
// Wait for a peer "joined" event before sending; open() only starts negotiation.
await webrtc.send(sessionId, { type: 'input', sequence, buttons });
// Later, on exit (also stop timers/listeners):
await webrtc.close(sessionId, 'Leaving game');
stopEvents.close();
await call('soy_match_leave', { ticket: ticket.ticket });
```

Use the functions above as lifecycle examples; supply your UI, cancellation and
message validation. Queue join is idempotent for one actor and matching options.
Waiting tickets expire after 60 seconds without status calls. Matched tickets
last ten minutes; they are rendezvous records, not the lifetime of gameplay.
Leaving a fixed match marks its remaining tickets closed. Game authority, host
selection, migration and game-over decisions belong in the game protocol.

Gameplay travels on WebRTC data channels, directly when ICE succeeds or through
TURN when needed. CVM is not a per-frame game server. The current channel profile
is reliable/ordered JSON broadcast to connected peers, up to 16 KiB per message.
Use one host relay pattern or mesh as your application needs, but `send` broadcasts:
put an intended recipient in the validated app message if needed. There is no
NAP selector for unordered delivery in the pinned proposal. Coalesce obsolete
updates on backpressure; do not send assets or a complete world every frame.

## Named rooms and changing membership

Instead of fixed-match tickets, use:

- `soy_room_create({napplet, protocol, name, capacity, listed})` → room snapshot.
- `soy_room_list({napplet, protocol})` → `{rooms}` (listed rooms only).
- `soy_room_join({room})` / `soy_room_status({room})` → snapshot with peer keys.
- `soy_room_leave({room})` → `{left:true}`.

Poll status every 2–20 seconds while active to renew your 60-second membership.
Others may remain after you leave; an empty/expired room disappears. Create is
not retry-idempotent: retain its returned ID; after an ambiguous failure, list
before creating again. An unlisted room ID is not a password. No durable world
state is stored here. With no explicit WebRTC `peers` allowlist, peers on the same
room/channel/protocol discover each other. That is an open rendezvous, not proof
of CVM membership. For restricted peer sets, pass the returned keys and explicitly
close/reopen the transport when that set changes; the pinned API has no update-set
operation. Validate every message and implement app-level authorization as needed.

## Limits, diagnostics and release checks

Default service limits: 8 total room/match players, 1,000 rooms/tickets, four room
memberships per actor, 1,000 boards, 1,000 players per board, 100 read rows and 120
tool calls per actor per minute. The host allows four CVM providers, four WebRTC
sessions, eight remote peers per session, 120 sends/second and 512 KiB/second.
Transport limits are deployment policy, not a promise that every game scales to
these maxima. Keep simulation topology and bandwidth choices explicit.

Handle capability denial, provider errors, `connecting`, `peer:left`, `closed`,
timeouts and backpressure visibly. A browser reload/sign-in change disposes the
old transport; rejoin explicitly. No automatic state replay or migration occurs.
TURN credentials are host-only and short-lived (ten minutes); reopening obtains
fresh credentials. Long-running relay sessions/credential renewal are not yet
qualified. Some restrictive networks still cannot connect; the managed service
has no TURN-over-TLS 443 fallback. Browser ICE can reveal network addresses after
the player's peer-connection consent.

Test with independent browser contexts. Test forced TURN and clients on separate
networks before claiming public connectivity; two tabs are insufficient evidence.
Test guest use, reconnect/leave, malformed peer messages, offline provider,
republishing without score reset, and remix isolation. Run both the upstream
conformance suite and `soyli check`; capability presence alone does not prove an
entire game works. The local upstream reference shell may expose a different
capability profile; the soyLI preview is the target host.
