# ContextVM and multiplayer

2026-09-12. The service starter and tests below are implemented. Browser NAP-CVM mediation, game simulation, and managed deployment of creator code are subsequent slices.

## Decision: a small default service, an open provider boundary

Space should offer matchmaking and room rendezvous as a convenient default. A napplet may use a creator-operated ContextVM for its game rules, persistent world, scoring, or specialized demo. The shared service should not become an interpreter for arbitrary uploaded game code or an unrestricted shared JSON database.

ContextVM provides MCP over signed/encrypted Nostr events. It does not supply a game engine or a standard matchmaking API. Our tool contract is an application API, versioned independently of ContextVM and NAP-CVM.

| Concern | Owner | First implementation |
| --- | --- | --- |
| Find compatible players | Shared matchmaking ContextVM | Implemented queue join/status/leave |
| Identify a match and its participants | Shared matchmaking ContextVM | Opaque room ID, authenticated transport pubkeys |
| Validate moves, determine winners, prevent invalid state transitions | Game-specific ContextVM | Separate follow-up service |
| Render and collect input | Napplet | Existing sandbox runtime |
| Sign/encrypt calls, select relays, enforce per-napplet provider policy | Host `cvm` capability | Browser bridge still to implement |
| Run creator server code | Creator VPS initially; isolated managed workers later | No uploaded server-code execution |

This supports a quick path: a tiny multiplayer napplet can use the default matchmaker; a more ambitious game can bring a specialized backend. Self-hosting means deploying an ordinary ContextVM server with its own key and relays, not defining a new napplet protocol.

## Existing standards and the pinned integration target

[NAP-CVM draft PR 31](https://github.com/napplet/naps/pull/31), inspected at [ad68a938](https://github.com/napplet/naps/blob/ad68a938236e9230324e377cd005008a315ff402/naps/NAP-CVM.md), defines the `cvm` domain. Its direct API includes discovery, MCP requests, tool/resource wrappers, close, and server notifications. Its optional registry groups providers behind common tool contracts. The corresponding [napplet web SDK implementation](https://github.com/napplet/web/tree/1df6dc87e5eee7257af41efb6247d47ec019e3d8/packages/nap/src/cvm) is the compatibility target, not a new `space.*` browser global.

Target napplet usage after the bridge is implemented:

```ts
const result = await window.napplet.cvm.callTool(
  { pubkey: providerPubkey, relays: providerRelays },
  'space_match_join',
  { napplet: myNaddr, artifact: myAggregateHash, queue: 'casual', players: 2 },
  { payment: 'deny', timeoutMs: 5000 },
);
```

This example is a target contract. The current player injects an empty `window.napplet` and does not advertise `cvm`. A manifest declaring `requires: cvm` is correctly reported as unsupported until the bridge passes interoperability tests.

The host must bind requests to the actual iframe `Window`, its author-qualified manifest identity, and verified aggregate hash. It owns transport keys, request correlation, deadlines, and policy; iframe-provided `pubkey`/origin strings cannot establish the caller's identity. Responses must be verified against the selected server's key. Each iframe/provider session must be disposed when playback stops or changes. Discovery is not permission to call every provider, and a napplet's `payment: allow` is not user authorization to spend.

Use a scoped transport identity per user/napplet where practical; do not lend a shared operator signing key to every game. The backend authenticates the transport pubkey. An `naddr` argument is a queue namespace, not proof of code provenance, ownership, or a human user. Authentication, cross-device identity linking, and Sybil resistance are distinct follow-up decisions.

## Implemented service contract, v1

The authoritative schemas are in [matchmaking.ts](../packages/multiplayer/src/matchmaking.ts), with MCP registration in [server.ts](../packages/multiplayer/src/server.ts).

| Tool | Input | Behavior |
| --- | --- | --- |
| `space_match_join` | `napplet` naddr, `artifact` aggregate hash, `queue` (default casual), `players` (2–8, default 2) | Idempotently joins a queue; pairs/groups waiting participants in arrival order |
| `space_match_status` | `ticket` UUID | Checks the caller's own ticket and renews a waiting lease |
| `space_match_leave` | `ticket` UUID | Idempotently leaves; closes the match for remaining peers |

Join and status return `{version:1,ticket,state,expiresAt,room,peers}`. `state` is waiting, matched, or closed; `room` is null until matched; `peers` contains the participating transport pubkeys. `expiresAt` is Unix milliseconds. Poll no more than once per two seconds. Waiting leases last 60 seconds; matches expire after ten minutes. A restart loses these ephemeral matches and clients rejoin. There is no durable game state to recover in this starter.

Queue equivalence includes decoded author-qualified napplet address, aggregate hash, queue name, and player count. Relay hints in an naddr do not split a queue. Different releases and remixes do not join accidentally. Each transport actor has one active ticket; leases, a 1,000-ticket cap, and per-key request limits bound service state. Public-key limits are not a complete public-abuse solution.

The room ID is rendezvous data, not an access credential. A game service must authenticate each player itself and validate room membership. Clients cannot write arbitrary room state or submit trusted scores through this service.

## Running the starter

```sh
# Use an operator-selected local relay; no external defaults are silently contacted.
SPACE_CVM_RELAYS=ws://127.0.0.1:7777 bun run cvm
```

The entrypoint uses `@contextvm/sdk` 0.13.16, its Applesauce relay pool, MCP SDK 1.30.0, required encryption, and SDK-injected client pubkeys. It creates a persistent mode-0600 key file at `.local/contextvm/identity` without printing the secret. Override `SPACE_CVM_KEY_PATH` for an existing identity. Public announcements and relay-list publication require `SPACE_CVM_ANNOUNCE=1`.

An actual relay must be supplied; this change does not disguise a test relay as a production service. Tests run the real ContextVM client and server transports against a bounded local NIP-01 fixture, including an attempted `_meta.clientPubkey` impersonation and an encrypted tool round trip.

`infra/cvm.ecosystem.config.cjs` provides the same Bun process under PM2. Set `SPACE_RELEASE_DIR`, `SPACE_CVM_RELAYS`, and a persistent `SPACE_CVM_KEY_PATH` when deploying separately. Keep the key outside release directories. The web deploy script does not yet activate this optional service or install its relay; that orchestration belongs with the operator relay slice. No ContextVM instance has been deployed to public infrastructure.

## Generalization and rollout

1. Complete the host's draft NAP-CVM bridge against the pinned upstream shim, with two browser clients joining through it. Test iframe spoofing, cancellation, provider identity, and cross-napplet isolation before advertising `cvm`.
2. Add one original two-player demo and a small game-specific authoritative service. Make move commands idempotent with command IDs and expected revisions. Snapshot state on reconnect; do not assume notifications provide durable replay or exactly-once delivery.
3. Expose the default matchmaker through `cvm.registry` as a Space-defined family. Use [CEP-15's normalized JSON Schema/JCS hashing](https://docs.contextvm.org/reference/ceps/cep-15/) before treating other providers as equivalent. Our current tools are bespoke MCP tools and do not claim CEP-15 common-schema status yet.
4. Let creators supply another provider pubkey/relay list. Provider choice is separate from schema compatibility. Switching providers must not silently move an active match or its private state.
5. Add `napplet backend init` and a self-hosting deploy template. Consider managed creator backends only after defining quotas, process isolation, secret storage, migrations, and lifecycle ownership. These should be separate services from artifact serving and the public web app.

For turn-based games, MCP requests and recoverable notifications are a reasonable first path. For twitch games, measure end-to-end latency before choosing a transport. Matchmaking can return a negotiated session while high-frequency state uses a separately specified host-mediated channel; do not make every animation frame a signed tool call. This is an architectural recommendation, not a performance claim about ContextVM.

Reference revisions: [ContextVM SDK 13772d3](https://github.com/ContextVM/sdk/tree/13772d398c4089fd8a1e9169dac3868e6d562f2c), [ContextVM docs 198d6b6](https://github.com/ContextVM/contextvm-docs/tree/198d6b6873e7d6a277ce6b86d3fc6b98e8af05f6), and the [ContextVM protocol draft](https://docs.contextvm.org/reference/spec/ctxvm-draft-spec/). These are evolving drafts, so record upgraded pins and conformance results together.
