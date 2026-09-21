import { join } from 'node:path';
import { browserCache, browserEngine } from '../../../apps/cli/src/browser';
import { buildSpatial, output } from './build';
import { serveSpatial } from './serve';

await buildSpatial();
const server = serveSpatial(0);
process.env.PLAYWRIGHT_BROWSERS_PATH ??= browserCache();
const { chromium } = await browserEngine();
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const results: Record<string, unknown> = {},
  errors: string[] = [];
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.url.href);
  await page.waitForFunction(() => !!window.spatialProof);
  // Reading arbitrary times must not depend on which frame was rendered first.
  await page.evaluate(() => window.spatialProof.at(321));
  const first = await page.locator('#scene').screenshot();
  await page.evaluate(() => {
    window.spatialProof.at(720);
    window.spatialProof.at(70);
    window.spatialProof.at(321);
  });
  check(
    first.equals(await page.locator('#scene').screenshot()),
    'Seeking changed the same rendered frame',
  );
  results.deterministicFrameSeek = true;
  await page.getByRole('button', { name: 'Watch the story', exact: true }).click();
  await page.waitForFunction(() => window.spatialProof.state().time > 10.9);
  await page.getByRole('button', { name: 'Pause story' }).click();
  check(
    !(await page.evaluate(() => window.spatialProof.state().playing)),
    'Pause did not stop the story',
  );
  results.playPause = true;
  for (const index of [0, 1, 2, 3]) {
    await page.locator(`[data-node="${index}"]`).click();
    check(
      (await page.evaluate(() => window.spatialProof.state())).active === index,
      'Node selection failed',
    );
  }
  await page.locator('[data-node="1"]').click();
  await page.getByRole('button', { name: 'Play this version' }).click();
  const before = await page.evaluate(() => window.spatialProof.state().game!.x);
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('x');
  await page.waitForTimeout(1750);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('x');
  const remix = await page.evaluate(() => window.spatialProof.state().game!);
  check(
    remix.x > before + 60 && remix.shots > 0 && remix.kills > 0,
    'Actual keyboard play did not move/shoot/defeat an enemy',
  );
  results.keyboardPlay = remix;
  await page.keyboard.press('Space');
  await page.waitForTimeout(80);
  check(
    (await page.evaluate(() => window.spatialProof.state().game!.jumps)) > 0,
    'Keyboard jump failed',
  );
  await page.keyboard.press('Escape');
  check(
    !(await page.locator('#game-dialog').evaluate((el: HTMLDialogElement) => el.open)),
    'Escape did not close play mode',
  );
  await page.locator('[data-node="0"]').click();
  await page.getByRole('button', { name: 'Play this version' }).click();
  await page.keyboard.press('x');
  check(
    (await page.evaluate(() => window.spatialProof.state().game!.shots)) === 0,
    'Original version unexpectedly has a shotgun',
  );
  await page.getByRole('button', { name: 'Back to the tree' }).click();
  await page.getByRole('button', { name: 'Explore tree' }).click();
  check(await page.evaluate(() => window.spatialProof.state().overview), 'Tree overview failed');
  const sceneBounds = await page.locator('#scene').boundingBox();
  check(sceneBounds, 'Scene bounds unavailable');
  await page.mouse.click(
    sceneBounds.x + sceneBounds.width * 0.14,
    sceneBounds.y + sceneBounds.height * 0.41,
  );
  const picked = await page.evaluate(() => window.spatialProof.state());
  check(
    picked.active === 0 && !picked.overview,
    'Clicking the original game surface did not select its node',
  );
  results.spatialPicking = true;
  await page.getByRole('button', { name: 'Explore tree' }).click();
  await page.screenshot({ path: join(output, 'interactive-desktop.png') });
  results.nodeControls = true;
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  mobile.on('pageerror', (error) => errors.push(error.message));
  await mobile.goto(server.url.href);
  await mobile.waitForFunction(() => !!window.spatialProof);
  await mobile.locator('[data-node="1"]').tap();
  check(
    !(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth)),
    'Mobile view overflows horizontally',
  );
  await mobile.screenshot({ path: join(output, 'interactive-mobile.png'), fullPage: true });
  await mobile.getByRole('button', { name: 'Play this version' }).tap();
  const right = await mobile.locator('[data-key="right"]').boundingBox();
  check(right, 'Touch button missing');
  const touch = await mobile.context().newCDPSession(mobile);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: right.x + right.width / 2, y: right.y + right.height / 2 }],
  });
  await mobile.waitForTimeout(650);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  check(
    (await mobile.evaluate(() => window.spatialProof.state().game!.x)) > 95,
    'Touch movement failed',
  );
  await mobile.locator('[data-key="shoot"]').tap();
  await mobile.waitForTimeout(80);
  check(
    (await mobile.evaluate(() => window.spatialProof.state().game!.shots)) > 0,
    'Touch shooting failed',
  );
  await mobile.screenshot({ path: join(output, 'interactive-mobile-play.png'), fullPage: true });
  results.touchPlay = true;
  if (await Bun.file(join(output, 'spatial-proof.mp4')).exists()) {
    const movie = await browser.newPage();
    movie.on('pageerror', (error) => errors.push(error.message));
    await movie.goto(`${server.url}spatial-proof.mp4`);
    await movie.locator('video').evaluate(async (video: HTMLVideoElement) => {
      video.muted = true;
      await video.play();
    });
    await movie.waitForFunction(() => document.querySelector('video')!.currentTime > 0.25);
    const metadata = await movie.locator('video').evaluate((video: HTMLVideoElement) => ({
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
      error: video.error?.message,
    }));
    check(
      metadata.width === 1920 &&
        metadata.height === 1080 &&
        Math.abs(metadata.duration - 24) < 0.1 &&
        !metadata.error,
      'Rendered movie did not play at the expected dimensions/duration',
    );
    await movie.locator('video').evaluate(async (video: HTMLVideoElement) => {
      video.pause();
      await new Promise<void>((resolve) => {
        video.addEventListener('seeked', () => resolve(), { once: true });
        video.currentTime = 23.8;
      });
    });
    const range = await movie.request.get(`${server.url}spatial-proof.mp4`, {
      headers: { Range: 'bytes=100-199' },
    });
    check(
      range.status() === 206 && (await range.body()).length === 100,
      'Movie byte ranges failed',
    );
    results.movie = { ...metadata, seekToEnd: true, byteRanges: true };
  }
  results.reducedMotion = 'node navigation changes view immediately';
  results.errors = errors;
  check(!errors.length, errors.join('\n'));
  await Bun.write(join(output, 'interaction-verification.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser?.close();
  server.stop(true);
}
