import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import sharp from 'sharp';
import { walkthrough } from '../apps/web/src/lib/creator-walkthrough';

const root = resolve(import.meta.dir, '..');
const output = join(root, 'apps/web/public/walkthrough');
await mkdir(output, { recursive: true });
await mkdir(join(root, '.local/walkthrough'), { recursive: true });
// Offline authoring only: this bundle is never imported by the website or CLI.
const serveUrl = await bundle({
  entryPoint: join(root, 'scripts/walkthrough/composition.tsx'),
  outDir: join(root, '.local/walkthrough/bundle'),
  publicDir: null,
});
const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE;
const composition = await selectComposition({ serveUrl, id: 'CreatorJourney', browserExecutable });
const options = { serveUrl, composition, browserExecutable };
await renderStill({ ...options, frame: 110, output: join(root, '.local/walkthrough/poster.png') });
await sharp(join(root, '.local/walkthrough/poster.png'))
  .resize(960)
  .webp({ quality: 80 })
  .toFile(join(output, 'creator.webp'));
// Sample every scene for a visual review before encoding the complete film.
for (let scene = 0; scene < walkthrough.scenes.length; scene++) {
  await renderStill({
    ...options,
    frame: scene * 144 + 110,
    output: join(root, `.local/walkthrough/scene-${scene + 1}.png`),
  });
}
let lastProgress = -1;
await renderMedia({
  ...options,
  outputLocation: join(output, 'creator.mp4'),
  codec: 'h264',
  pixelFormat: 'yuv420p',
  crf: 25,
  muted: true,
  concurrency: 2,
  onProgress: ({ progress }) => {
    const step = Math.floor(progress * 10);
    if (step !== lastProgress) console.log(`Walkthrough render: ${step * 10}%`);
    lastProgress = step;
  },
});
const timestamp = (seconds: number) => `00:00:${String(seconds).padStart(2, '0')}.000`;
await Bun.write(
  join(output, 'creator.en.vtt'),
  'WEBVTT\n\n' +
    walkthrough.scenes
      .map(
        (scene, index) =>
          `${index + 1}\n${timestamp(index * 6)} --> ${timestamp((index + 1) * 6)}\n${scene.caption}\n`,
      )
      .join('\n'),
);
console.log(
  `Rendered ${walkthrough.seconds}s video (${(Bun.file(join(output, 'creator.mp4')).size / 1024 / 1024).toFixed(2)} MiB), poster and captions in ${output}`,
);
