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

The existing queue uses `{napplet, artifact, queue, players}`; equivalence includes
the decoded author-qualified napplet identity, exact aggregate hash, queue and
requested count. Its default two-player request and maximum eight are explicit
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
