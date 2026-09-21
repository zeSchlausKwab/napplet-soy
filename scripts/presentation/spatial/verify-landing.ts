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
      reducedMotion: 'no-preference',
    });
    page.on('pageerror', (error) => errors.push(error.message));
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto(`${server.url}landing.html`);
    await page.evaluate(() => document.fonts.ready);
    check(!requests.some((url) => url.endsWith('spatial.js')), 'WebGL loaded before interaction');
    check(await page.locator('#story-film').isVisible(), 'Story is collapsed on arrival');
    check(await page.locator('.hero-copy').isVisible(), 'Original hero was hidden');
    check(await page.locator('.featured').isVisible(), 'Featured placement left the hero');
    check(
      await page.getByText('Made by people with an idea and an afternoon.').isVisible(),
      'Original copy is missing',
    );
    check(
      await page.evaluate(() => {
        const hero = document.querySelector('.hero')!.getBoundingClientRect();
        const story = document.querySelector('#story')!.getBoundingClientRect();
        const browse = document.querySelector('#playground')!.getBoundingClientRect();
        return hero.bottom <= story.top && story.bottom <= browse.top;
      }),
      'Story is not between the original hero and playground',
    );
    check(
      !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)),
      'Landing layout overflowed',
    );
    // Scrolling is not a user activation: muted playback must work without a click.
    await page.locator('#cinema').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0.15);
    const metadata = await page.locator('video').evaluate((video: HTMLVideoElement) => ({
      duration: video.duration,
      muted: video.muted,
      defaultMuted: video.defaultMuted,
      paused: video.paused,
    }));
    check(
      metadata.duration === 30 && metadata.muted && metadata.defaultMuted && !metadata.paused,
      'Story did not autoplay muted',
    );
    check(
      !requests.some((url) => url.endsWith('spatial.js')),
      'Watching the film unnecessarily loaded WebGL',
    );
    await page.getByRole('button', { name: 'Sound off', exact: true }).click();
    check(
      await page.locator('video').evaluate((video: HTMLVideoElement) => !video.muted),
      'Explicit sound toggle failed',
    );
    await page.getByRole('button', { name: 'Sound on', exact: true }).click();
    await page.getByRole('button', { name: 'Pause story', exact: true }).click();
    await page.locator('video').evaluate((video: HTMLVideoElement) => {
      video.currentTime = 4.7;
    });
    await page.waitForFunction(() => !document.querySelector('video')?.seeking);
    await page.screenshot({
      path: join(output, `landing-${mobile ? 'mobile' : 'desktop'}.png`),
      fullPage: true,
    });
    // A manually paused story stays paused after scrolling away and back.
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator('#cinema').scrollIntoViewIfNeeded();
    check(
      await page.locator('video').evaluate((video: HTMLVideoElement) => video.paused),
      'Visibility overrode a manual pause',
    );
    await page.getByRole('button', { name: 'Play story', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video')?.paused === false);
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForFunction(() => document.querySelector('video')?.paused === true);
    await page.locator('#cinema').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('video')?.paused === false);
    if (!mobile) await page.screenshot({ path: join(output, 'landing-film.png') });
    await page.getByRole('button', { name: 'Explore the tree' }).click();
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
    await page.getByRole('button', { name: 'Back to the story' }).click();
    check(
      (await page.locator('iframe').count()) === 0,
      'Returning to the film left the renderer mounted',
    );
    check(await page.locator('.hero-copy').isVisible(), 'Exploring removed the original hero');
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
      openStory: true,
      autoplayMuted: true,
      soundOptIn: true,
      visibilityPause: true,
      manualPauseRespected: true,
      lazyWebGL: true,
      rendererCleanup: true,
      filmToPlayableGame: true,
      ...metadata,
    };
    await page.close();
  }
  const reduced = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  await reduced.goto(`${server.url}landing.html`);
  await reduced.locator('#cinema').scrollIntoViewIfNeeded();
  await reduced.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
  check(
    await reduced
      .locator('video')
      .evaluate(
        (video: HTMLVideoElement) => video.paused && video.currentTime === 0 && video.muted,
      ),
    'Reduced motion automatically played',
  );
  await reduced.getByRole('button', { name: 'Play story', exact: true }).click();
  await reduced.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0.15);
  await reduced.close();
  evidence.reducedMotion = { manualPlayback: true };
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
