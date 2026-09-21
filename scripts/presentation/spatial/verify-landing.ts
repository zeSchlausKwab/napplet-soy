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
    console.log(`Checking ${mobile ? 'mobile' : 'desktop'} live composition`);
    const page = await browser.newPage({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      isMobile: mobile,
      hasTouch: mobile,
      reducedMotion: 'no-preference',
    });
    page.on('pageerror', (error) => errors.push(error.message));
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto(`${server.url}landing.html`);
    await page.evaluate(() => document.fonts.ready);
    const frame = await (await page.locator('#story-scene').elementHandle())!.contentFrame();
    check(frame, 'Live scene did not load');
    await frame.waitForFunction(() => !!window.spatialProof);
    check(
      (await page.locator('video').count()) === 0 && (await frame.locator('video').count()) === 0,
      'Scene is still a video',
    );
    check(!requests.some((url) => /\.mp4|\.m4a/.test(url)), 'Media downloaded before sound opt-in');
    check(await page.locator('.hero-copy').isVisible(), 'Original hero was hidden');
    check(
      await page.getByText('Made by people with an idea and an afternoon.').isVisible(),
      'Original copy is missing',
    );
    check(
      await page.evaluate(() => {
        const hero = document.querySelector('.hero')!.getBoundingClientRect();
        const story = document.querySelector('#story')!.getBoundingClientRect();
        const browse = document.querySelector('#playground')!.getBoundingClientRect();
        const canvas = document.querySelector('#cinema')!.getBoundingClientRect();
        return (
          hero.bottom <= story.top &&
          story.bottom <= browse.top &&
          canvas.left === 0 &&
          Math.abs(canvas.width - innerWidth) < 1
        );
      }),
      'Scene is not edge-to-edge between the original hero and playground',
    );
    const cinemaHeight = await page.locator('#cinema').evaluate((element) => {
      const previousHeight = Math.max(352, Math.min(innerWidth * 0.5625 + 32, innerHeight * 0.92));
      const height = element.getBoundingClientRect().height;
      return { height, expected: previousHeight * 0.8 };
    });
    check(
      Math.abs(cinemaHeight.height - cinemaHeight.expected) < 1,
      'Story container is not 20% shorter',
    );
    await page.locator('#cinema').scrollIntoViewIfNeeded();
    await frame.waitForFunction(() => window.spatialProof.state().time > 0.15);
    const initial = await frame.evaluate(() => window.spatialProof.state());
    check(
      initial.playing && initial.muted && !initial.audioPlaying,
      'Scene did not start silently',
    );
    check(
      initial.width === (mobile ? 390 : 1440) && initial.triangles > 100,
      'Live WebGL renderer has wrong dimensions',
    );
    await frame.getByRole('button', { name: 'Pause story' }).click();
    const slider = frame.getByRole('slider', { name: 'Story position' });
    await slider.focus();
    await slider.press('Home');
    check(
      (await frame.evaluate(() => window.spatialProof.state())).time === 0,
      'Timeline Home failed',
    );
    await slider.press('ArrowRight');
    check(
      Math.abs((await frame.evaluate(() => window.spatialProof.state())).time - 0.01) < 0.001,
      'Timeline keyboard increment failed',
    );
    await slider.press('End');
    check(
      (await frame.evaluate(() => window.spatialProof.state())).time === 30,
      'Timeline End failed',
    );
    await slider.scrollIntoViewIfNeeded();
    const bounds = await slider.boundingBox();
    check(bounds, 'Progress slider has no bounds');
    const y = bounds.y + bounds.height / 2;
    if (mobile) {
      const touch = await page.context().newCDPSession(page);
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: bounds.x + bounds.width * 0.2, y }],
      });
      for (const fraction of [0.3, 0.4, 0.5, 0.6])
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: bounds.x + bounds.width * fraction, y }],
        });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(bounds.x + bounds.width * 0.2, y);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width * 0.6, y, { steps: 8 });
      await page.mouse.up();
    }
    const dragged = await frame.evaluate(() => window.spatialProof.state());
    check(
      dragged.time > 17 && dragged.time < 19 && !dragged.playing,
      'Dragging did not scrub and hold the live scene',
    );
    const pixels = await frame.locator('#scene').screenshot();
    await slider.press('Home');
    check(
      !pixels.equals(await frame.locator('#scene').screenshot()),
      'Scrubbing did not change the rendered canvas',
    );
    await frame.evaluate(() => window.spatialProof.at(321));
    const centered = await frame.locator('#scene').screenshot();
    const sceneBounds = await frame.locator('#scene').boundingBox();
    check(sceneBounds, 'Scene has no bounds');
    await page.mouse.move(
      sceneBounds.x + sceneBounds.width * 0.9,
      sceneBounds.y + sceneBounds.height * 0.2,
    );
    await page.waitForTimeout(1600);
    const shifted = await frame.locator('#scene').screenshot();
    check(
      centered.equals(shifted) === mobile,
      mobile ? 'Touch layout acquired mouse parallax' : 'Mouse movement did not move the 3D camera',
    );
    check(
      (await frame.evaluate(() => window.spatialProof.state())).time === 10.7,
      'Pointer movement advanced the paused story',
    );
    if (!mobile)
      await frame.locator('#scene').screenshot({ path: join(output, 'landing-parallax.png') });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(1600);
    check(
      centered.equals(await frame.locator('#scene').screenshot()),
      'Camera did not return to the exact authored pose after pointer exit',
    );
    await page.screenshot({
      path: join(output, `landing-${mobile ? 'mobile' : 'desktop'}.png`),
      fullPage: true,
    });
    await frame.getByRole('button', { name: 'Sound off', exact: true }).click();
    await frame.getByRole('button', { name: 'Watch the story', exact: true }).click();
    await frame.waitForFunction(
      () =>
        window.spatialProof.state().audioPlaying && window.spatialProof.state().audioTime > 10.9,
    );
    const audible = await frame.evaluate(() => window.spatialProof.state());
    check(
      !audible.muted && Math.abs(audible.time - audible.audioTime) < 0.15 && !audible.audioError,
      'Audio and live scene are not synchronized',
    );
    await slider.focus();
    await slider.press('Home');
    const scrubbedAudio = await frame.evaluate(() => window.spatialProof.state());
    check(
      !scrubbedAudio.audioPlaying && scrubbedAudio.audioTime < 0.1,
      'Scrubbing left audio playing at the wrong time',
    );
    await frame.getByRole('button', { name: 'Sound on', exact: true }).click();
    await frame.getByRole('button', { name: 'Watch the story', exact: true }).click();
    await frame.waitForFunction(() => window.spatialProof.state().time > 0.3);
    await page.evaluate(() => scrollTo(0, 0));
    await frame.waitForFunction(() => window.spatialProof.state().suspended);
    const offscreen = await frame.evaluate(() => window.spatialProof.state().time);
    await page.waitForTimeout(200);
    check(
      (await frame.evaluate(() => window.spatialProof.state())).time === offscreen,
      'Off-screen scene kept animating',
    );
    await page.locator('#cinema').scrollIntoViewIfNeeded();
    await frame.waitForFunction((at) => window.spatialProof.state().time > at + 0.1, offscreen);
    await frame.getByRole('button', { name: 'Pause story' }).click();
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator('#cinema').scrollIntoViewIfNeeded();
    check(
      !(await frame.evaluate(() => window.spatialProof.state())).playing,
      'Visibility overrode manual pause',
    );
    await frame.evaluate(() => window.spatialProof.at(900));
    await frame.getByRole('button', { name: 'PRESS START', exact: true }).click();
    check(
      (await frame.evaluate(() => window.spatialProof.state())).game?.variant === 'shotgun',
      'Live ending did not launch the actual game',
    );
    if (mobile) await frame.getByRole('button', { name: 'Shoot', exact: true }).tap();
    else await frame.locator('#play-canvas').press('x');
    await frame.waitForFunction(() => (window.spatialProof.state().game?.shots ?? 0) > 0);
    await page.screenshot({
      path: join(output, `landing-${mobile ? 'mobile' : 'desktop'}-play.png`),
      fullPage: true,
    });
    check(
      !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)),
      'Landing layout overflowed',
    );
    check(
      !(await frame.evaluate(() => document.documentElement.scrollWidth > innerWidth)),
      'Embedded scene overflowed',
    );
    evidence[mobile ? 'mobile' : 'desktop'] = {
      liveWebGL: true,
      edgeToEdge: true,
      cinemaHeight: cinemaHeight.height,
      pointerParallax: mobile ? 'disabled for touch' : 'moves and recenters without advancing time',
      mutedAutoplay: true,
      dragSeek: dragged.time,
      keyboardSeek: true,
      synchronizedAudio: true,
      offscreenPause: true,
      manualPause: true,
      playableEnding: true,
    };
    await page.close();
  }
  const reduced = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  await reduced.goto(`${server.url}landing.html`);
  const frame = await (await reduced.locator('#story-scene').elementHandle())!.contentFrame();
  await frame!.waitForFunction(() => !!window.spatialProof);
  await reduced.locator('#cinema').scrollIntoViewIfNeeded();
  check(
    (await frame!.evaluate(() => window.spatialProof.state())).time === 0 &&
      !(await frame!.evaluate(() => window.spatialProof.state())).playing,
    'Reduced motion automatically played',
  );
  await frame!.evaluate(() => window.spatialProof.at(321));
  const still = await frame!.locator('#scene').screenshot();
  await frame!.locator('#scene').hover({ position: { x: 30, y: 40 } });
  await reduced.waitForTimeout(300);
  check(
    still.equals(await frame!.locator('#scene').screenshot()),
    'Reduced motion camera followed the mouse',
  );
  await frame!.getByRole('button', { name: 'Watch the story', exact: true }).click();
  await frame!.waitForFunction(() => window.spatialProof.state().time > 0.15);
  await reduced.close();
  evidence.reducedMotion = { manualPlayback: true, noPointerParallax: true };
  const capture = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await capture.goto(`${server.url}?capture`);
  await capture.waitForFunction(() => !!window.spatialProof);
  await capture.evaluate(() => window.spatialProof.at(321));
  const captured = await capture.locator('#scene').screenshot();
  await capture.locator('#scene').hover({ position: { x: 40, y: 40 } });
  await capture.waitForTimeout(300);
  check(
    captured.equals(await capture.locator('#scene').screenshot()),
    'Mouse altered export capture',
  );
  await capture.close();
  evidence.capture = { noPointerParallax: true };
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
