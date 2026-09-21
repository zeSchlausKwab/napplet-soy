# Spatial collaboration proof

A local interactive Three.js scene and 30-second movie. The branching history is
the space the camera travels through. Each node contains its version of a **2D
pixel platformer**, a developer prompt, and an illustrated soyLI action.

The game stays entirely 2D. Three.js displays its canvas on a surface within each
stage; the stage, connecting paths and camera are 3D.

After the tree overview, the published game lifts off its node and flies toward
the viewer, filling the movie frame by 28.7 seconds. The game keeps running as the
surrounding scene and labels fade. A final **PRESS START** invitation launches the
playable version in the interactive preview. Compact screens contain the complete
16:9 game surface rather than cropping it.

## Run

```sh
bun run presentation:spatial
```

Open the printed loopback address, normally `http://127.0.0.1:4191/`. The page
starts at the tree overview. Choose **Watch the story**, select a version by
clicking its stage or labelled button, scrub the timeline, or **Play this version**.
Stop the local server with Ctrl+C. `PRESENTATION_PORT` overrides its port.

The original game supports arrows/A/D, Space/W/Up to jump, and R to restart. The
remix adds X/J to shoot. Both variants also have on-screen touch controls. Mobile
layouts repeat the focused prompt and command below the scene for readability.
Reduced-motion preferences make manual node navigation immediate; the cinematic
camera journey runs only when explicitly played or scrubbed.

```sh
bun run presentation:spatial:render --stills-only
bun run presentation:spatial:render
bun test scripts/presentation/spatial
bun scripts/presentation/spatial/verify.ts
```

The renderer needs FFmpeg on PATH and the soyLI Chromium browser (`bun run soyli
browser install`). The browser scene requires WebGL 2. These are local authoring
tools; they add no runtime requirement to published napplets or the shell app.

Generated files live in ignored `output/spatial-proof/`: MP4, ten stills, bundled
interactive page, fonts and verification records. Intermediate audio lives under
`.local/spatial-proof/`. The renderer writes explicit frames through the exact
same browser scene used interactively, then encodes H.264/AAC. This proof uses
Three.js directly; there is no additional React Three Fiber, Blender or Remotion
scene adapter. The earlier Remotion proof remains independently reproducible.

## Structure

- `game.ts`: fixed 60 Hz platformer, keyboard/touch input model, collision,
  jumping, projectile/enemy interaction, pixel renderer and replay checkpoints.
  An automatic controller drives the same simulation during the story. Checkpoints
  are cloned, making seeks independent of frame order and caller mutations.
- `story.ts`: node positions, prompts, supported command shapes, completion
  milestones and camera keyframes. Prompts type first, then commands; text keeps
  its final wrapping while it types. Acceptance and publication remain distinct.
- `screens.ts`: separate story actions: the original game, a shotgun flying into
  the unarmed remix, two parent versions converging with a change wipe, and the
  finished game's replay. The merge uses matching world states to make the change
  visible, then holds the locally merged result until publication. Distant nodes
  retain distinct posters for each action, rather than repeating the same game.
- `paths.ts`: straight history lanes and rounded, tangent-continuous Bézier elbows.
- `scene.ts`: floating stages, canvas textures, paths, camera and ray picking.
  Focused games replay while distant stages use stable preview states. Supporting
  stages dim while reading a node. Resources are disposed on final page exit.
- `main.ts` / `index.html`: replay/explore controls and an isolated local play
  dialog. Short jump/shoot inputs are latched until a simulation step so taps
  aren't lost between rendered frames. The story pauses when the tab is hidden.
- `score.ts`: original synthesized music, travel cues and shot effects timed to
  the replay, including the pickup delay. The merge has its own resolution cue
  instead of repeated shooting. No samples or external audio dependencies. The
  [music prompt](MUSIC-PROMPT.md) describes an optional ElevenLabs replacement;
  the rendered proof still uses the original synthesized score.
- `verify.ts`: real-browser checks for deterministic frame seeking, playback,
  version selection, keyboard movement/jump/shoot, touch controls and mobile layout.

## What this proof represents

Soybert's original and shotgun games are real playable local prototypes. The
characters, prompts, terminal summaries and publication history are illustrated;
rendering does not create repositories, proposals, public releases or relay events.
`<link>` is a placeholder. The node labelled accepted is merged locally, and a
separate node illustrates publishing. This is not end-to-end verification of an
actual contribution or a packaged NAP release.

Pixel sprites, scenery, geometry and sound are authored in code. The header uses
the project's existing Soybert mascot. No new generated image assets are required.
All assets are served locally. Nothing is installed on the production site and
the existing onboarding film is unchanged.
