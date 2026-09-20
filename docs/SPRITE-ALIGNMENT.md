# Sprite alignment

The local alignment studio corrects frame-to-frame X/Y drift in generated sprite
sheets. Start it from the repository root:

```sh
bun run mascot:align
```

Open <http://127.0.0.1:4318>. The editor preloads the original Soybert laptop sheet
from `apps/web/public/brand/soybert-laptop.png`. It can also open another local PNG
and split a grid of 1–12 columns and rows. No image is uploaded. The local server
only serves the editor and the bundled original; it has no write endpoints.

## Set the reference points

1. Choose a rigid landmark, such as a corner of the laptop. A moving hand or an
   eye that blinks is unsuitable. Click the same landmark in each frame.
2. Use zoom and arrow keys to adjust the selected point by one source pixel.
   Shift + arrow moves ten pixels. X/Y fields accept exact coordinates.
3. Frame 1 is the destination. Every other frame is translated by
   `frame1.point - frameN.point`. The optional ghost overlays frame 1 at the
   current frame's point for visual comparison.
4. Review the synchronized original and corrected loops. Pause and scrub to
   inspect individual frames. Corrected preview is a draft until all points are
   set; frames with missing points remain unshifted.
5. Export the corrected PNG and save the JSON recipe. Points also autosave in
   browser storage, keyed by the image's SHA-256 and grid; a recipe is the portable
   copy. Import validates that it belongs to the exact original image.

Coordinates are integer, zero-based positions **inside each source frame**.
Frames are read left to right, then top to bottom. Non-divisible sheet dimensions
are partitioned using floored grid boundaries, retaining every source pixel.

## Output and reproduction

The output retains the same grid and frame order. It applies integer translations
with no scaling, interpolation or image generation. Every output cell receives
the same transparent padding on all four sides, large enough to retain the whole
source cell at its corrected offset. Square source cells therefore stay square.
The recipe records source identity, grid, anchors, offsets, cell dimensions and
sheet dimensions. Source files are preserved.

Browser export uses Canvas PNG encoding. For a repeatable build outside the editor:

```sh
bun scripts/sprite-align/export.ts \
  apps/web/public/brand/soybert-laptop.png \
  output/imagegen/mascot-cycles/soybert-laptop.alignment.json \
  output/imagegen/mascot-cycles/soybert-laptop-aligned.png
```

Place the downloaded recipe at the path above first. The exporter checks the
source hash, recomputes offsets from the anchors, and refuses to overwrite an
existing destination or the original. It uses Sharp for PNG output; browser and
CLI encoding may differ even when the visible pixels agree.

## Production handoff

The user's laptop export is installed as
`apps/web/public/brand/soybert-laptop-aligned.png`; its recipe is retained beside it
as `soybert-laptop.alignment.json`. `apps/web/src/soyli.css` references the aligned
sibling across landing, docs and create. The original is retained for future edits.
For subsequent exports, copy the downloaded PNG and recipe into these project
locations after review; a browser download does not update the app automatically.
The existing 3×3 frame order and
`300% 300%` background size remain valid for square cells. Extra padding makes the
visible character slightly smaller at the same CSS size; check its displayed size
and layout when integrating. Rectangular source/output cells require a matching
display aspect ratio.

The editor itself does not change the site's asset, CSS or deployment. Position correction does
not fix frame-to-frame changes in scale, rotation, perspective or illustration.

## Verification

```sh
bun test scripts/sprite-align/alignment.test.ts
bun scripts/sprite-align/browser-check.ts
```

Unit checks cover non-divisible grids, positive and negative shifts, edge retention,
alpha, recipe/source validation and overwrite refusal. The browser check uses a
synthetic landmark with known offsets to verify clicks/zoom/nudges, live previews,
PNG/JSON downloads, matching CLI pixels, draft restoration, recipe rejection and
desktop/mobile fit. It writes inspection screenshots under the ignored
`.local/sprite-alignment-check/` directory. The browser check requires local
Chromium and a loopback listening port.
