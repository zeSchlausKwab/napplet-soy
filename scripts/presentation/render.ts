import { cp, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { captureGame } from './capture';
import { writeScore } from './sound';

const root = resolve(import.meta.dir, '../..');
const output = join(root, 'output/presentation-proof');
const cache = join(root, '.local/presentation-proof');
const publicDir = join(cache, 'public');
await mkdir(publicDir, { recursive: true });
await mkdir(output, { recursive: true });
const media = join(output, 'media');
if (process.argv.includes('--capture') || !(await Bun.file(join(media, 'portals.mp4')).exists()))
  await captureGame(media);
await cp(media, join(publicDir, 'media'), { recursive: true });
await cp(join(import.meta.dir, 'assets/shared-sky.png'), join(publicDir, 'shared-sky.png'));
await cp(
  join(root, 'apps/web/public/brand/soybert-laptop-aligned.png'),
  join(publicDir, 'soybert.png'),
);
await writeScore(join(publicDir, 'score.wav'));
const serveUrl = await bundle({
  entryPoint: join(import.meta.dir, 'composition.tsx'),
  outDir: join(cache, 'bundle'),
  publicDir,
});
const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE;
const composition = await selectComposition({
  serveUrl,
  id: 'CollaborationProof',
  browserExecutable,
});
const options = { serveUrl, composition, browserExecutable };
const frames = [
  { frame: 137, name: '01-remix' },
  { frame: 239, name: '02-review' },
  { frame: 417, name: '03-together' },
];
for (const { frame, name } of frames) {
  await renderStill({ ...options, frame, output: join(output, `${name}.png`) });
  console.log(`Style frame: ${name}`);
}
// Sample transitions as well as the polished still poses for visual inspection.
for (const frame of [0, 80, 149, 150, 161, 299, 300, 335, 354, 398, 449])
  await renderStill({ ...options, frame, scale: 0.5, output: join(cache, `frame-${frame}.png`) });
if (!process.argv.includes('--stills-only')) {
  let progress = -1;
  await renderMedia({
    ...options,
    outputLocation: join(output, 'collaboration-proof.mp4'),
    codec: 'h264',
    pixelFormat: 'yuv420p',
    crf: 18,
    concurrency: 2,
    onProgress: ({ progress: p }) => {
      const next = Math.floor(p * 10);
      if (next !== progress) {
        console.log(`Render: ${next * 10}%`);
        progress = next;
      }
    },
  });
}
await Bun.write(
  join(output, 'collaboration.en.vtt'),
  `WEBVTT

00:00.000 --> 00:05.000
What if it had portals? Remix the game. Propose a playable improvement with soyLI.

00:05.000 --> 00:10.000
The original creator can play the proposal and compare it with the original.

00:10.000 --> 00:15.000
Accept the reviewed change, then publish. Their idea becomes everyone's game.
`,
);
await Bun.write(
  join(output, 'index.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>napplet.soy · collaboration motion proof</title>
<style>*{box-sizing:border-box}body{margin:0;background:#10211e;color:#f5eedb;font:16px system-ui}main{max-width:1320px;margin:auto;padding:44px 28px}header{display:flex;align-items:baseline;justify-content:space-between;gap:20px}h1{font-size:clamp(26px,4vw,52px);letter-spacing:-2px;margin:10px 0}p{color:#bccab5;line-height:1.6;max-width:780px}a{color:#d1e5a2}video{width:100%;aspect-ratio:16/9;background:#0a1916;border-radius:16px;margin-top:24px;border:1px solid #456151}section{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:36px}figure{margin:0}img{width:100%;border-radius:10px}figcaption{font-size:15px;padding:12px 0;color:#bccab5}summary{cursor:pointer;padding:20px 0;color:#d1e5a2}iframe{width:100%;height:min(740px,85vh);border:1px solid #456151;border-radius:12px}footer{margin-top:40px;font-size:14px;color:#b0c1b1}@media(max-width:700px){section{grid-template-columns:1fr}header{display:block}main{padding:20px 16px}}</style></head><body><main>
<header><h1>Little idea. Shared sky.</h1><span>napplet.soy / motion study 01</span></header>
<p>A 15-second proof of remix → playable proposal → merge → publish. Real local prototype gameplay with illustrated prompts and collaboration. The full launch film comes next.</p>
<video controls playsinline preload="metadata" poster="02-review.png"><source src="collaboration-proof.mp4" type="video/mp4"><track kind="captions" label="English" srclang="en" src="collaboration.en.vtt"></video>
<section>${frames.map(({ name }, i) => `<figure><a href="${name}.png"><img src="${name}.png" alt="${['A player proposes momentum portals', 'The original creator tries a playable proposal', 'The contribution rejoins the original before a new release'][i]}"></a><figcaption>${['01 · A player has an idea', '02 · A proposal you can play', '03 · Bring the improvement back'][i]}</figcaption></figure>`).join('')}</section>
<details><summary>Play the recording prototype</summary><iframe loading="lazy" title="Orbit Run recording prototype" src="media/game.html"></iframe></details>
<footer>Arrow keys / WASD to roll. Local only. Storyboard commands illustrate existing soyLI operations; no proposal, public release, scores or payments were created for this proof. <a href="collaboration-proof.mp4" download>Download video</a></footer>
</main></body></html>`,
);
console.log(`Review: ${join(output, 'index.html')}`);
