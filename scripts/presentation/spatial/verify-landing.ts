import { join } from 'node:path';
import { browserCache, browserEngine } from '../../../apps/cli/src/browser';
import { buildSpatial, output } from './build';
import { serveSpatial } from './serve';

await buildSpatial();
const server = serveSpatial(0);
process.env.PLAYWRIGHT_BROWSERS_PATH ??= browserCache();
const { chromium } = await browserEngine();
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
});
const errors: string[] = [];
const evidence: Record<string, unknown> = {};
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
try {
  for (const mobile of [false, true]) {
    console.log(`Checking ${mobile ? 'mobile' : 'desktop'} composition`);
    const page = await browser.newPage({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      isMobile: mobile,
      hasTouch: mobile,
      reducedMotion: 'reduce',
    });
    page.on('pageerror', (error) => errors.push(error.message));
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto(`${server.url}landing.html`);
    await page.evaluate(() => document.fonts.ready);
    check(
      !requests.some((url) => /spatial\.js|\.mp4/.test(url)),
      'Film or WebGL loaded before interaction',
    );
    check(
      !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)),
      'Landing layout overflowed',
    );
    await page.screenshot({
      path: join(output, `landing-${mobile ? 'mobile' : 'desktop'}.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Watch the story' }).click();
    await page.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0.15);
    const metadata = await page.locator('video').evaluate((video: HTMLVideoElement) => {
      video.pause();
      return { duration: video.duration, muted: video.muted };
    });
    check(metadata.duration === 30 && !metadata.muted, 'New 30-second music mix did not play');
    check(
      !requests.some((url) => url.endsWith('spatial.js')),
      'Watching the film unnecessarily loaded WebGL',
    );
    if (!mobile) await page.screenshot({ path: join(output, 'landing-film.png') });
    await page.getByRole('button', { name: 'Back to the page' }).click();
    check((await page.locator('video').count()) === 0, 'Collapsing left the film playing');
    await page.getByRole('button', { name: 'Explore the tree', exact: true }).click();
    const iframe = await page.locator('iframe').elementHandle();
    const frame = await iframe!.contentFrame();
    check(frame, 'Interactive tree did not load');
    await frame.waitForFunction(() => !!window.spatialProof);
    check(
      requests.some((url) => url.endsWith('spatial.js')),
      'Interactive renderer did not lazy-load',
    );
    check(
      !(await frame.evaluate(() => document.documentElement.scrollWidth > innerWidth)),
      'Embedded tree overflows',
    );
    check(
      !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)),
      'Expanded tree overflows the landing page',
    );
    await frame.locator('[data-node="1"]').click();
    await frame.getByRole('button', { name: 'Play this version' }).click();
    check(
      await frame.locator('#game-dialog').evaluate((dialog: HTMLDialogElement) => dialog.open),
      'Embedded version is not playable',
    );
    if (!mobile) await page.screenshot({ path: join(output, 'landing-interactive.png') });
    await page.getByRole('button', { name: 'Back to the page' }).click();
    check((await page.locator('iframe').count()) === 0, 'Collapsing left the renderer mounted');
    await page.getByRole('button', { name: 'Watch the story' }).click();
    await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
    await page.locator('video').evaluate(async (video: HTMLVideoElement) => {
      video.currentTime = 29.85;
      await video.play();
    });
    await page.getByRole('button', { name: 'Play Soybert' }).click();
    const final = await (await page.locator('iframe').elementHandle())!.contentFrame();
    await final!.waitForFunction(() => window.spatialProof?.state().game?.variant === 'shotgun');
    check(
      !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)),
      'Playable game overflows the landing page',
    );
    check(
      !(await final!.evaluate(() => document.documentElement.scrollWidth > innerWidth)),
      'Playable game overflows the embedded scene',
    );
    if (mobile)
      await page.screenshot({ path: join(output, 'landing-mobile-play.png'), fullPage: true });
    evidence[mobile ? 'mobile' : 'desktop'] = {
      lazyFilm: true,
      lazyWebGL: true,
      collapseCleanup: true,
      filmToPlayableGame: true,
      ...metadata,
    };
    await page.close();
  }
  check(!errors.length, errors.join('\n'));
  await Bun.write(
    join(output, 'landing-verification.json'),
    JSON.stringify({ ...evidence, errors }, null, 2),
  );
  console.log(JSON.stringify({ ...evidence, errors }, null, 2));
} finally {
  await browser.close();
  server.stop(true);
}
