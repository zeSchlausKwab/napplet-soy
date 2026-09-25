# MiniCraft: a little world, together

A small playable voxel-building demo of creator-defined, persistent CVM rules.
The frontend uses ordinary NAP-CVM calls through the shared napplet host. The
provider compiles and runs the adjacent MiniCraft backend fixture; the frontend
cannot directly change its database.

## Run it

From the napplet-space repository, after installing its dependencies:

```sh
bun run demo:minicraft
```

Open <http://127.0.0.1:4180>. The main site's `bun dev` can keep running separately;
this command does not require its services. If port 4180 is occupied, use
`MINICRAFT_PORT=4181 bun run demo:minicraft` or port `0` for an available port.
Stop the demo with Ctrl-C when finished.

1. Choose a name and click **Create island**. Allow the host to connect the
   temporary demo player when prompted.
2. Pick a material, then click a block face to place a block. Choose **Remove**
   to remove one. Drag to orbit; scroll or pinch to zoom.
3. On a phone-sized screen, tap a block to aim, then press **Place block** or
   **Remove block**. Open **Worlds** to create, join or copy a code.
4. Copy the world code from the Worlds panel (scroll within the panel if needed).
   Open another tab or browser on this computer, paste it into **Join a world**,
   then click **Join island**. Changes arrive through conservative revision polling,
   usually within a few seconds. This is collaborative building, not real-time
   player movement or a complete Minecraft game.

**Only me** creates a private world; sharing its code does not grant access.
The UI does not yet manage individual members. **Anyone with the world code**
creates a public creative world with guest building enabled. The code identifies
a world and its pinned release; it is not a password or permission token.

## Identity and persistence

The demo host creates a throwaway Nostr identity in each browser tab's session
storage. It survives refresh and server restart, but closing the tab can discard
ownership of private worlds. This is explicitly a local demo identity, never your
soyLI creator account or a keychain key. A fresh tab/browser gets a different
identity; duplicating a tab may copy its session storage.

Worlds persist in `.local/minicraft/.napplet-space/backend/boards.sqlite.dynamic.sqlite`.
Keep a world code to reopen it. Recent-world bookmarks use the host's normal
NAP storage. Code/schema changes create a new release; existing worlds retain
their original rules. Deleting browser state does not delete backend worlds.

This service binds to loopback. It does not publish a napplet, contact public
relays or expose a world to another device on your LAN. The phone layout can be
tested with browser device emulation. Public multi-device deployment remains
gated by the dynamic backend rollout work in [DYNAMIC-BACKENDS.md](../../../docs/DYNAMIC-BACKENDS.md).

## Source and verification

- `main.ts` and `world-client.ts`: discovery, world codes, saved state and exact
  retries of uncertain writes. Failed writes do not optimistically change blocks.
- `scene.ts`: Three.js rendering, orbit controls and pointer/touch selection.
- `host.ts`: temporary player setup around the normal shared host and its
  account consent/proof exchange. Keys never enter the napplet iframe.
- `../fixtures/minicraft/`: the creator's schemas and self-contained handler.
  Terrain generation is optional and committed with world creation. The demo
  exposes creative building in a bounded 16×16×16 region; the fixture also has
  survival inventory and membership operations.
- `scripts/minicraft.ts` at repository root: isolated preview, local CVM and
  persistent data. The generated project is under `.local/minicraft`.

```sh
bun run test:minicraft
```

Requires the soyLI Playwright browser (`bun run soyli browser install`). The
browser integration test creates two independent players, edits shared blocks,
checks a private-world denial, restarts the service and exercises touch controls.
It uses a disposable data directory, separate from your demo worlds.
