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
Mouse movement gently shifts the camera around its current focus, revealing the
depth between stages. It eases back to centre on pointer exit and works while
paused. Touch, reduced-motion preferences and exported frame captures keep the
authored camera steady; the effect fades out during the final fly-in.

```sh
bun run presentation:spatial:render --stills-only
bun run presentation:spatial:render
bun run presentation:spatial:render --audio-only
bun test scripts/presentation/spatial
bun scripts/presentation/spatial/verify.ts
bun scripts/presentation/spatial/verify-landing.ts
```

The renderer needs FFmpeg on PATH and the soyLI Chromium browser (`bun run soyli
browser install`). The browser scene requires WebGL 2. These are local authoring
tools; they add no runtime requirement to published napplets or the shell app.

Generated files live in ignored `output/spatial-proof/`: mixed and effects-only
MP4s, ten stills, a clean tree poster, bundled interactive pages, fonts and
verification records. Intermediate audio lives under
`.local/spatial-proof/`. The renderer writes explicit frames through the exact
same browser scene used interactively, then encodes H.264/AAC. This proof uses
Three.js directly; there is no additional React Three Fiber, Blender or Remotion
scene adapter. The earlier Remotion proof remains independently reproducible.

## Audio

`assets/soundtrack.mp3` is the user-supplied 30-second music bed. The previous
synthesized music has been removed. Jump, coin, enemy-hit and shotgun effects
follow the deterministic game replay; pickup, travel and merge cues remain.
The music is lowered and briefly ducked under effects, with a final peak limiter.

`--audio-only` replaces the film's audio without re-encoding its picture. It exports
`spatial-proof.mp4` (music plus effects), `spatial-effects.mp4` (effects only) and
`story-audio.m4a` (the same mix for the live scene). The landing scene loads audio
only after **Sound off** is toggled on. Audible playback uses the audio clock so
dropped rendering frames do not desynchronize the game effects. Seeking pauses
and moves both timelines. The manually playable game itself remains silent.

## Landing-page composition study

Open `http://127.0.0.1:4191/landing.html` after rendering the stills and movie. This
is a local layout study, not a change to the production homepage. It preserves
the original hero's copy, installer, animated mascot, benefits and featured area.
The live Three.js story runs **edge to edge across the browser width**, below the
hero and above the playground. It is open by default, animates silently when in
view, pauses rendering/game simulation/audio off-screen or in a hidden tab, and
resumes unless the viewer paused it. Reduced-motion preferences require explicit
play. Sound is opt-in through the visible toggle.
The story container is 20% shorter than the original full-width composition,
including its minimum and viewport-height cap, leaving more room for content below.

The simple progress slider controls the actual camera, prompts, branches and game
states; mouse/touch dragging pauses at the chosen moment. Arrow keys, Home and End
also seek, and the play icon resumes from that position. The landing control strip
uses a 2-pixel track, small play/pause and sound icons on the left, and larger
invisible touch targets. **Explore tree**, below the scene,
shows the same scene's complete tree; nodes can be selected and played. The ending
retains **PRESS START** for the finished game. The sample featured and gallery
cards are illustrative and do not query live listings.

The scene is loaded immediately in a same-origin `?landing` iframe with compact
controls. It does not download the movie or audio on arrival. The outer page
reports visibility to suspend the scene, and a WebGL startup failure links to the
rendered film. This iframe is a prototype integration boundary, not a new napplet
host or protocol requirement.

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
- `score.ts`: code-authored effects timed to the replay, including the pickup
  delay. `audio.ts` mixes the supplied music, ducks it under game sounds and exports
  the mixed/effects-only films and live-scene audio. The [music prompt](MUSIC-PROMPT.md) preserves
  the music direction used when requesting the replacement track.
- `landing.html`: landing composition with the open live scene below the original
  hero. `verify-landing.ts` checks edge-to-edge placement, silent autoplay,
  mouse/touch/keyboard scrubbing, audio synchronization, visibility/manual pauses,
  camera parallax/recentering, the shorter container, reduced motion, stable export
  captures and playable ending on desktop and mobile.
- `verify.ts`: real-browser checks for deterministic frame seeking, playback,
  version selection, keyboard movement/jump/shoot, touch controls and mobile layout.

## What this proof represents

Soybert's original and shotgun games are real playable local prototypes. The
characters, prompts, terminal summaries and publication history are illustrated;
rendering does not create repositories, proposals, public releases or relay events.
`<link>` is a placeholder. The node labelled accepted is merged locally, and a
separate node illustrates publishing. This is not end-to-end verification of an
actual contribution or a packaged NAP release.

Pixel sprites, scenery, geometry and effects are authored in code; the music is
supplied separately. The header uses the project's existing Soybert mascot.
No new generated image assets are required.
All assets are served locally. Nothing is installed on the production site and
the existing onboarding film is unchanged.
