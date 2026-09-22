# README media

These are repository-local presentation assets. README links work in a checkout
and on GitHub without an expiring attachment service or a website deployment.

| File | Source |
| --- | --- |
| `playground.jpg` | Public napplet.soy homepage, captured signed out on 2026-09-22 at 1440px width. The featured creation is credited in the image. |
| `gallery.jpg` | The same public collection, captured on 2026-09-22. Titles/creator credits remain visible. |
| `soyli-workshop.jpg` | Current local workshop, using a temporary Tiny tennis starter and a screenshot of its actual running canvas. No account or public upload was created. |
| `story-poster.png` | The 24-second tree overview from `output/spatial-proof/05-tree.png`. |
| `napplet-soy-story.mp4` | Compact 720p H.264/AAC export of the rendered 30-second spatial story, with the supplied soundtrack and game effects. |

The existing mascot is referenced directly from
`apps/web/public/brand/soy-mascot.png`; it is not duplicated here.
Public-site screenshots are documentation of the product, not a claim that the
depicted creations were made by the platform. Individual asset licenses/credits
still apply. The film is an illustrated workflow with a playable local game;
its depicted prompts, people and publication history are staged.

## Reproduce the film

From the repository root, with FFmpeg and the soyLI browser available:

```sh
bun run presentation:spatial:render
ffmpeg -i output/spatial-proof/spatial-proof.mp4 \
  -vf scale=1280:-2 -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -movflags +faststart docs/media/napplet-soy-story.mp4
cp output/spatial-proof/05-tree.png docs/media/story-poster.png
```

FFmpeg asks before replacing an existing movie. The full 1080p render and
effects-only variant stay in ignored `output/spatial-proof/`. See the
[scene documentation](../../scripts/presentation/spatial/README.md) for authoring,
audio mixing and interactive verification.

The root README uses a linked poster and explicit MP4 link rather than relying on
a Markdown renderer to retain an HTML video element. Open/download the film if
your renderer doesn't provide an inline player.
