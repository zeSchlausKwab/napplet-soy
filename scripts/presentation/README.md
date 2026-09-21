# Collaboration motion proof

A 15-second, 1920 × 1080 Remotion study and three matching style frames. It shows
a player remixing a marble game, the author trying the playable proposal, and the
change merging before the next release is published.

This is a local authoring tool. It does not replace the website's onboarding video.

The newer [spatial study](spatial/README.md) makes the branching history a
navigable Three.js scene, with a 2D Soybert platformer inside each node.

## Render and view

From the repository root, with dependencies installed:

```sh
bun run presentation:render
bun run presentation:preview
```

Open the loopback URL printed by the preview server (port 4190 by default). Stop
it with Ctrl+C; set `PRESENTATION_PORT` to use another port. The review page includes
the video, downloadable full-size style frames, captions and the playable recording
prototype. Output is written to the Git-ignored `output/presentation-proof/`;
intermediate bundles and transition frames are in `.local/presentation-proof/`.

The first render records the two game variants and caches them. After changing the
game, use `bun run presentation:render --capture`. For layout work, use
`bun run presentation:render --stills-only`.

Authoring needs FFmpeg on PATH, the soyLI capture browser (`bun run soyli browser
install`), and Remotion's compatible Chromium (downloaded on first render).
`REMOTION_BROWSER_EXECUTABLE` can select a compatible existing browser for
Remotion. These are repository authoring dependencies, not new prerequisites for
napplet users.

## Assets and behavior

- `game.ts` / `game.html`: a playable Canvas prototype. Arrow keys or WASD move
  the marble; R restarts. Original and portal variants share the same course. A
  portal moves the marble while preserving its velocity. The demo controller uses
  the same simulation with fixed steps for reproducible recording.
- `capture.ts`: records both versions at 30 fps, checks keyboard movement, course
  completion and portal transfers, and reports browser/encoder failures.
- `composition.tsx`: exact prompt/command text, animated tree, game windows,
  existing Soybert sprite and camera movement. The code keeps merge and publish
  as separate steps. The prompt card represents a request to the creator's AI
  tool; soyLI provides tools and context rather than its own AI model.
- `sound.ts`: original synthesized ambient bed and transition cues; no samples.
- `assets/shared-sky.png`: background illustration made with the built-in
  imagegen tool. The exact generation prompt is in `assets/shared-sky.prompt.txt`.
- `render.ts`: movie, frame, caption and review-page export. All output is local.

The game footage is real browser gameplay. Prompt cards, terminal summaries,
characters and collaboration tree are an illustrated sequence, not a recording of
an actual published collaboration. `<napplet-link>` is a placeholder for a real
release link. No proposals, releases, scores, payments or public activity are
created by rendering. The game is a recording prototype, not a packaged NAP
release. This proof does not claim end-to-end publication verification.

The three landscape stills come from deliberately chosen poses in the same
composition. Additional aspect ratios and a complete launch film are separate
production work.
