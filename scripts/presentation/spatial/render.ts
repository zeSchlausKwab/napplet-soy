import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { browserCache, browserEngine } from '../../../apps/cli/src/browser';
import { DiagnosticError } from '../../../packages/diagnostics/src';
import { buildSpatial, output, root } from './build';
import { serveSpatial } from './serve';
import { spatialScore } from './score';
import { DURATION, FPS } from './story';

const frameCount = DURATION * FPS;

await buildSpatial();
const cache = join(root, '.local/spatial-proof');
await mkdir(cache, { recursive: true });
const server = serveSpatial(0);
process.env.PLAYWRIGHT_BROWSERS_PATH ??= browserCache();
const { chromium } = await browserEngine();
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`${server.url}?capture`);
  await page.waitForFunction(() => !!window.spatialProof, undefined, { timeout: 30_000 });
  for (const [seconds, name] of [
    [4.7, '01-original'],
    [9.12, '02-remix'],
    [10.95, '02b-remix-play'],
    [15.9, '03-merge-parents'],
    [16.6, '03b-merging'],
    [17.7, '03-accepted'],
    [21.9, '04-release'],
    [24, '05-tree'],
    [26.7, '06-fly-to-player'],
    [29.8, '07-press-start'],
  ] as const) {
    const state = await page.evaluate((f) => window.spatialProof.at(f), seconds * FPS);
    await page.screenshot({ path: join(output, `${name}.png`) });
    console.log(`Frame ${name}: ${JSON.stringify(state)}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  if (!process.argv.includes('--stills-only')) {
    const soundtrack = join(cache, 'score.wav');
    await spatialScore(soundtrack);
    const encoder = Bun.spawn(
      [
        'ffmpeg',
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'image2pipe',
        '-vcodec',
        'png',
        '-framerate',
        String(FPS),
        '-i',
        'pipe:0',
        '-i',
        soundtrack,
        '-c:a',
        'aac',
        '-b:a',
        '160k',
        '-shortest',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        join(output, 'spatial-proof.mp4'),
      ],
      { stdin: 'pipe', stdout: 'ignore', stderr: 'pipe' },
    );
    const stderr = new Response(encoder.stderr).text();
    try {
      for (let frame = 0; frame < frameCount; frame++) {
        await page.evaluate((f) => window.spatialProof.at(f), frame);
        encoder.stdin.write(await page.screenshot({ type: 'png' }));
        await encoder.stdin.flush();
        if (frame % 60 === 0) console.log(`Render ${Math.round((frame / frameCount) * 100)}%`);
      }
      encoder.stdin.end();
      const exitCode = await encoder.exited;
      if (exitCode !== 0)
        throw new DiagnosticError('SPATIAL_RENDER', 'Spatial film encoding failed.', {
          tool: 'ffmpeg',
          exitCode,
          detail: await stderr,
          target: join(output, 'spatial-proof.mp4'),
        });
    } finally {
      if (encoder.exitCode === null) {
        encoder.kill();
        await encoder.exited;
      }
    }
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`Film: ${join(output, 'spatial-proof.mp4')}`);
  }
  await Bun.write(
    join(output, 'render-verification.json'),
    JSON.stringify(
      {
        frames: frameCount,
        fps: FPS,
        stillsOnly: process.argv.includes('--stills-only'),
        errors,
        renderer: 'Three.js; shared with interactive browser scene',
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  server.stop(true);
}
