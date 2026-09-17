# ContextVM backend services

The Soy backend is an MCP server reached directly over signed, NIP-44-encrypted
Nostr transport. It provides persistent casual scoreboards, leased named rooms,
and matchmaking. It does not execute uploaded game code or run a game simulation.
No HTTP endpoint proxies these calls.

The service uses `@contextvm/sdk` 0.13.16 and MCP SDK 1.30.0. Browser mediation targets
[NAP-CVM PR 31, ad68a938](https://github.com/napplet/naps/blob/ad68a938236e9230324e377cd005008a315ff402/naps/NAP-CVM.md).
Peer transport targets [NAP-WEBRTC PR 59, 5fae95dd](https://github.com/napplet/naps/blob/5fae95dd2c8e59bd06c654e0845656add077dcda/naps/NAP-WEBRTC.md).
The installed upstream shim is 0.30.0. These are evolving proposal contracts;
NIP-5D remains authoritative for napplet publication and host messages.

## Service contract v1

Input schemas are in `packages/multiplayer/src/contracts.ts`, `rooms.ts` and
`matchmaking.ts`. All tools return ordinary MCP content plus `structuredContent`;
errors use `isError`. The transport supplies the authenticated client key.
Caller-supplied `_meta.clientPubkey` cannot impersonate another player.

| Tool                 | Behavior                                                               |
| -------------------- | ---------------------------------------------------------------------- |
| `soy_session`        | Current transport actor, contract version, families and polling policy |
| `soy_board_register` | Creator-authorized registration of immutable board rules               |
| `soy_board_submit`   | Update the caller's personal best; retries do not add scores           |
| `soy_board_read`     | Current ordered scores plus the caller's personal best                 |
| `soy_room_create`    | Create a named, optionally listed room with a chosen capacity          |
| `soy_room_list`      | List rooms in an author-qualified napplet/protocol namespace           |
| `soy_room_join`      | Join within provider capacity and return current peer keys             |
| `soy_room_status`    | Renew membership and return current peers                              |
| `soy_room_leave`     | Leave without closing the room for other members                       |
| `space_match_join`   | Join an exact-release queue; repeated joins reuse the ticket           |
| `space_match_status` | Read own ticket and renew a waiting lease                              |
| `space_match_leave`  | Leave the fixed match; this older queue contract closes it for peers   |
| `soy_ice`            | Temporary authenticated TURN credentials for the host                  |

Room membership lasts 60 seconds without renewal. Poll status every 2–20 seconds.
Rooms disappear when their last lease expires. Provider defaults are 1,000 rooms,
eight peers per room, and four room memberships per actor. Capacity is provider
policy, not a game rule; `SPACE_CVM_MAX_PEERS` can set a limit up to the contract's
64-peer ceiling. The current browser mesh separately admits eight remote peers.
Listed rooms are public rendezvous. An unlisted room ID is not an authorization
credential, and a peer key is not proof of a human, profile, or honest game client.

The creator queue (`soy_match_join/status/leave`) uses `{napplet, protocol, queue,
players}`; equivalence includes the decoded author-qualified napplet identity,
application protocol version, queue and requested count. No self-referential
build hash is required. Legacy `space_match_*` tools retain exact-artifact matching. Its default two-player request and maximum eight are explicit
service limits. Waiting tickets expire after 60 seconds and fixed matches after
ten minutes. Named rooms cover variable membership without that fixed-match
lifecycle. Neither mechanism chooses simulation topology or game rules.

## Durable scores and creator authority

Boards use `{napplet, board}` as their namespace. The napplet is a standard naddr;
relay hints do not change identity. Definitions include title, `highest` or
`lowest` ordering, and finite minimum/maximum bounds. Rules are immutable: choose
a new board ID for new rules or a new season. Scores survive service restarts in
SQLite/WAL. Republishing does not reset them. Remixes get a different napplet
address and must register their own boards.

Registration carries an unpublished signed application proof from the naddr's
author. `boardAuthorization()` specifies its exact kind-1 template: a
`soy-board-registration-v1` tag, provider `p` tag, and JSON content binding the
transport caller and full definition. Its timestamp must be within five minutes.
This is an application authorization format, not a new NIP or a public social
post. The key never reaches the backend. Replaying a proof for another provider,
caller, author or definition fails; retrying the same registration is harmless.

Scores are **client-reported**, keyed to authenticated transport identities.
They are suitable for casual boards, not prizes or claims of cheat resistance.
Names are untrusted display strings. The defaults allow 1,000 boards and 1,000
players per board, return at most 100 rows, and limit each actor to 120 tool calls
per minute. Per-key limits are not Sybil protection. Exhausted resources fail
explicitly; they do not silently evict scores or create paid usage.

## Provider selection and schema identity

The host's curated families are `soy.matchmaking.v1`, `soy.rooms.v1` and
`soy.boards.v1`. These are Soy service contracts exposed through the standard
NAP-CVM registry, not additions to the NAP browser namespace. Direct `callTool`
works with other CVM providers. Selecting another provider does not migrate scores,
rooms or active sessions. There is no automatic stateful-provider fallback.

The service attaches per-tool CEP-15 hashes using the installed SDK's normalized
schema/JCS implementation under `_meta["io.contextvm/common-schema"]`. A structural
hash does not prove a provider implements the advertised semantics. No aggregate
family hash or interchangeable-provider claim is made.

## Operator service

```
SPACE_CVM_RELAYS=ws://127.0.0.1:19347/relay bun run cvm
```

Set `SPACE_CVM_KEY_PATH` and `SPACE_CVM_DATA_PATH` to persistent paths outside
releases. Identity files are mode 0600. `--identity` on the service entrypoint
prints only its public key. Public announcements are opt-in with
`SPACE_CVM_ANNOUNCE=1`; `SPACE_CVM_PUBLIC_RELAYS` controls advertised relays while
`SPACE_CVM_RELAYS` controls actual server connections. The deployment uses the
local relay connection and advertises the public WSS address.

`soyli dev` uses the same service implementation with a bounded loopback preview
relay and per-project data in `.napplet-space/backend`. Full-stack development
and production use Khatru. The small preview relay is not a production relay.
Local board provisioning trusts the developer's configuration file and is never
exposed as an unauthenticated public tool.

Service tests exercise encrypted transport, caller binding, registration
ownership, personal-best idempotence, persistence, capacity and lease expiry.
Production rollout and independently created games require separate verification.

## Browser and creator integration (soyLI 0.10.0)

The shared host advertises NAP-CVM and NAP-WEBRTC. Both the shell and compiled
soyLI use the same bridge. See the self-contained [creator guide](BACKEND-CREATOR.md)
for setup, scores, matching, rooms, lifecycle examples and the complete limits.
That guide is bundled into new projects and `soyli skills update`.

`/.well-known/napplet.json` is site-owned public provider configuration. It contains
only the public key and relays, is unavailable when no provider is configured,
and does not proxy gameplay or CVM calls. Creator configuration pins it into
`napplet.json`; generated public `soy-backend.json` carries the stable naddr and
provider into the artifact. Publishing authorizes board registration directly over
CVM. Dev mode redirects that provider to an isolated instance of the same service.

The host owns a per-tab, napplet- and viewer-scoped transport signer in
sessionStorage, shared by CVM and WebRTC. It survives same-tab reloads and build
updates, but is not a durable profile identity. Duplicated tabs may inherit it;
use independent browser contexts for distinct guest players. Provider sessions
are capped at four, requests time out in at most 25 seconds after initialization,
and replies are capped at 256 KB. Payment-required results remain errors.

Registry discovery checks live tool schemas and any advertised CEP-15 hash.
It never equates semantics based only on tool names. Per-tool hashes are exposed;
aggregate family-hash matching is not implemented. General MCP notifications
are forwarded, but CEP-41 streams, payments and large-response transports are
disabled. Curated families do not imply support for arbitrary backend code.

## WebRTC signaling profile `soy-rtc/1`

NAP-WEBRTC defines the app API and leaves signaling to the host. Soy implements
its own published profile; this is not a claim of NIP-100 conformance or automatic
interoperability with every other shell's signaling.

- Events are signed Nostr kind 25050, with `d` = namespace digest and an expiration
  60 seconds after creation. Targeted messages also carry the recipient `p` tag.
- The namespace is SHA-256 of UTF-8 JSON `["soy-rtc/1", identity, scope, channel,
  protocol-or-empty-string]`. Production identity is the verified author's
  `pubkey:kind:identifier`, without an appended build hash. A snapshot whose
  address names a different signer uses `snapshotSigner:5129:address` instead. The preview uses its local preview identity. Scope is `["room", roomId]`
  or `["direct", ...lexicographicallySortedTransportPubkeys]`.
- A signed plaintext hello body is `{v:"soy-rtc/1",wire,nonce,type:"hello"}`.
  `nonce` is a fresh UUID per session. Offers/answers are NIP-44 encrypted to the
  peer and contain `{v,wire,nonce,type,to,sdp}`; `to` binds the recipient's nonce.
  The lexicographically lower key offers. Non-trickle SDP includes gathered ICE
  candidates. Hello/offer retransmission runs every two seconds; stalled peers
  close the session after 45 seconds. Reopening obtains fresh nonces/credentials.
- The host verifies signatures, namespace, freshness, peer allowlists and nonces,
  bounds message rates and queued work, and never exposes SDP or TURN secrets to
  the iframe. Public hellos disclose participation in the opaque rendezvous.
- Native reliable/ordered data channels carry JSON. Broadcast messages are at most
  16 KiB, with 256 KiB channel backpressure. Host sends have a separate realtime
  budget of 120/second and 512 KiB/second. Game traffic does not go through Nostr.

The host is limited to four WebRTC sessions and eight remote peers each. These
are capacity policies, not game rules. Apps select topology and authority. No
host migration, authoritative physics, durable world, anti-cheat or simulation
service is implied. A CVM room alone does not prove WebRTC membership; use explicit
peer allowlists where needed. The pinned API has no dynamic allowlist update.

The operator's `soy_ice` issues ten-minute HMAC TURN credentials to the verified
transport caller. Only the host sees them. Browser ICE selects direct traffic
when possible and TURN otherwise. Reopening requests fresh credentials; long
sessions and credential renewal still require qualification. No TLS/443 fallback
is bundled because that port belongs to the shared HTTPS proxy. See
[deployment configuration](DEPLOYMENT.md#cvm-and-turn-deployment).

Engineering verification: separate Chromium contexts using the actual injected
shim exercised encrypted CVM score submission/read, protocol matchmaking, forced
coturn relay selection, peer payloads, 650 gameplay updates, over-limit rejection
and departure. Service tests cover durable scores/ownership, room leases/capacity,
and the CLI's signed provisioning/remix isolation. Direct ICE on the development
machine's VPN interface did not connect. Separate-network direct and TURN tests,
long-session recovery, deployment and independent creator acceptance remain
unverified; the fixtures are not claims of those results.

Reproduce service/relay checks with `bun run test:backend`. For the browser fixture,
run `SPACE_TEST_TURN_BINARY=/path/to/turnserver bun run test:backend:browser`;
it starts and stops an isolated loopback coturn instance with relay-only ICE and
asserts the selected candidate is a relay. Without that variable the fixture
uses direct ICE, which requires locally reachable browser candidates. The service
tests do not require coturn. No test contacts the production provider.
