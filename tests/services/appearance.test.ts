import { test, expect } from 'bun:test';
import { chromium, expect as ui, type Page } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IndexStore } from '../../packages/backend/src/index-store';
import { publicNapplet } from '../../packages/backend/src/public-model';
import fixtures from '../../packages/backend/data/catalog.json';
import { APPEARANCE_KEY } from '../../packages/runtime/src/appearance';
import { startPreviewServer } from '../../apps/cli/src/preview/server';
import { previewAssets } from '../../apps/cli/src/preview/assets';

const shots = '.local/appearance';
async function assertContrast(page: Page) {
  const ratios = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const luminance = (token: string) => {
      const hex = style
        .getPropertyValue('--' + token)
        .trim()
        .slice(1);
      const rgb = [0, 2, 4]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const pairs = ['background', 'card', 'band'].flatMap((bg) =>
      ['foreground', 'muted-foreground', 'coral', 'gold', 'mint', 'blue', 'lilac'].map((fg) => [
        fg,
        bg,
      ]),
    );
    pairs.push(
      ['primary-foreground', 'primary'],
      ['header-foreground', 'header'],
      ['warning', 'warning-surface'],
      ['destructive', 'error-surface'],
    );
    return pairs.map(([fg, bg]) => {
      const [low, high] = [luminance(fg), luminance(bg)].sort((a, b) => a - b);
      return { pair: `${fg}/${bg}`, ratio: (high + 0.05) / (low + 0.05) };
    });
  });
  for (const { pair, ratio } of ratios) expect(ratio, pair).toBeGreaterThanOrEqual(4.5);
}

const themeButton = (page: Page) => page.getByRole('button', { name: /^Appearance:/ });

test('shell appearance persists, follows the system, synchronizes tabs and themes portals before hydration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soy-appearance-'));
  const index = new IndexStore(join(directory, 'index'), true);
  for (const fixture of fixtures.slice(0, 3)) {
    index.admit(fixture.current);
    const entry = await publicNapplet(fixture.current, []);
    index.project(
      fixture.current.id,
      { ...entry, availability: 'ready' },
      Date.now() + 60000,
      Date.now() + 60000,
    );
  }
  index.close();
  await Bun.write(
    join(directory, 'policy.json'),
    JSON.stringify({
      version: 1,
      revision: 0,
      rules: [],
      admins: [],
      audit: [],
      used: [],
      featured: fixtures.slice(0, 3).map((f) => ({
        type: 'event',
        target: f.current.id,
        actor: f.current.pubkey,
        reason: 'Local fixture',
        at: 0,
      })),
    }),
  );
  const server = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: '0',
      SPACE_PUBLICDEV: '0',
      SPACE_INDEX_DIR: join(directory, 'index'),
      SPACE_MODERATION_FILE: join(directory, 'policy.json'),
      SPACE_COMMUNITY_DIR: join(directory, 'community'),
    },
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const timer = setTimeout(() => server.kill(), 90000);
  const browser = await chromium.launch();
  try {
    await mkdir(shots, { recursive: true });
    let output = '',
      origin = '';
    for await (const chunk of server.stdout) {
      output += new TextDecoder().decode(chunk);
      origin = /listening on (http:\/\/[^\s]+)/.exec(output)?.[1] ?? '';
      if (origin) break;
    }
    expect(origin).not.toBe('');
    origin = new URL(origin).origin;
    const context = await browser.newContext({
      colorScheme: 'dark',
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    });
    await context.routeWebSocket(/wss?:\/\//, (route) => route.close());
    await context.route(`**/${fixtures[0].artifactHash}*`, async (route) =>
      route.fulfill({
        body: Buffer.from(
          await Bun.file(
            `packages/backend/data/artifacts/${fixtures[0].artifactHash}.html`,
          ).bytes(),
        ),
        headers: { 'content-type': 'text/html', 'access-control-allow-origin': '*' },
      }),
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (message) => {
      if (/hydration|hydrated|did not match/i.test(message.text())) errors.push(message.text());
    });
    await page.goto(origin);
    await ui(themeButton(page)).toHaveAccessibleName('Appearance: Auto. Switch to Light.');
    await ui(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await ui(page.locator('body')).toHaveCSS('background-color', 'rgb(23, 30, 26)');
    await assertContrast(page);
    await page.screenshot({ path: `${shots}/home-dark.png` });
    await themeButton(page).click();
    await ui(themeButton(page)).toHaveAccessibleName('Appearance: Light. Switch to Dark.');
    await ui(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 241, 228)');
    await assertContrast(page);
    await page.screenshot({ path: `${shots}/home-light.png` });
    await page.reload();
    await ui(themeButton(page)).toHaveAccessibleName('Appearance: Light. Switch to Dark.');
    const second = await context.newPage();
    await second.goto(origin + '/docs');
    await ui(second.locator('html')).toHaveAttribute('data-theme', 'light');
    await themeButton(page).click();
    await ui(second.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await ui(page.locator('html')).toHaveAttribute('data-theme', 'dark'); // Explicit preference wins.
    await themeButton(page).click();
    await ui(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await ui(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.bringToFront();
    await page.locator('#identity-button').click();
    const menu = page.locator('[data-slot="popover-content"]');
    await ui(menu).toBeVisible();
    await ui(menu).toHaveCSS('background-color', 'rgb(34, 45, 38)');
    await page.screenshot({ path: `${shots}/identity-dark.png` });
    await page.keyboard.press('Escape');
    await ui(menu).toHaveCount(0);
    await ui(page.locator('#identity-button')).toBeFocused();
    // Keyboard focus gets the same colored feedback as pointer hover.
    await themeButton(page).focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await ui(themeButton(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await ui(themeButton(page)).toHaveCSS('background-color', 'rgb(240, 207, 112)');
    await ui(themeButton(page)).toHaveCSS('transform', 'none');
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await ui(themeButton(page)).toBeVisible();
      const target = (await themeButton(page).boundingBox())!;
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
      await ui.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const identity = (await page.locator('#identity-button').boundingBox())!;
      expect(identity.x + identity.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `${shots}/home-light-${width}.png` });
    }
    await themeButton(page).click();
    await page.screenshot({ path: `${shots}/home-dark-320.png` });
    await second.screenshot({ path: `${shots}/docs-dark.png` });
    for (const route of ['/about', '/create', '/network', '/admin']) {
      await second.goto(origin + route);
      await ui(second.locator('body')).toHaveCSS('background-color', 'rgb(23, 30, 26)');
      await second.screenshot({ path: `${shots}/${route.slice(1)}-dark.png` });
    }
    await second.goto(origin + '/n/' + fixtures[0].naddr);
    await ui(second.locator('.detail-heading h1')).toContainText(fixtures[0].title);
    await second.screenshot({ path: `${shots}/detail-dark.png` });
    await second.getByRole('button', { name: `Zap ${fixtures[0].title}`, exact: true }).click();
    await ui(second.locator('[data-slot="dialog-content"]')).toHaveCSS(
      'background-color',
      'rgb(34, 45, 38)',
    );
    await second.screenshot({ path: `${shots}/zap-dark.png` });
    await second.keyboard.press('Escape');
    await second.getByRole('button', { name: `Start ${fixtures[0].title}`, exact: true }).click();
    await ui(second.locator('.player-stage iframe')).toBeVisible();
    const game = (await (await second
      .locator('.player-stage iframe')
      .elementHandle())!.contentFrame())!;
    await game.waitForFunction(() => !!(window as any).napplet?.theme);
    await game.evaluate(() => {
      (window as any).appearanceWitness = { score: 42, changes: 0 };
      (window as any).napplet.theme.onChanged(() => {
        (window as any).appearanceWitness.changes++;
      });
    });
    await themeButton(second).click(); // Dark -> Auto, dark OS: unchanged.
    await themeButton(second).click(); // Auto -> Light
    await ui
      .poll(() => game.evaluate(() => (window as any).appearanceWitness))
      .toEqual({ score: 42, changes: 1 });
    expect(
      await game.evaluate(async () => await (window as any).napplet.theme.get()),
    ).toMatchObject({ colors: { background: '#f5f1e4' } });
    // A saved dark palette must work even while all hydration scripts are blocked.
    const prepaint = await browser.newContext({ colorScheme: 'light' });
    await prepaint.addInitScript(({ key }) => localStorage.setItem(key, 'dark'), {
      key: APPEARANCE_KEY,
    });
    await prepaint.route('**/assets/*.js', (route) => route.abort());
    const firstPaint = await prepaint.newPage();
    await firstPaint.goto(origin);
    await ui(firstPaint.locator('html')).toHaveAttribute('data-theme', 'dark');
    await ui(firstPaint.locator('body')).toHaveCSS('background-color', 'rgb(23, 30, 26)');
    await prepaint.close();
    // Denied storage still allows an in-memory selection, starting at OS appearance.
    const blocked = await browser.newContext({ colorScheme: 'dark' });
    await blocked.routeWebSocket(/wss?:\/\//, (route) => route.close());
    await blocked.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('Blocked', 'SecurityError');
        },
      });
    });
    const privatePage = await blocked.newPage();
    await privatePage.goto(origin);
    await ui(privatePage.locator('html')).toHaveAttribute('data-theme', 'dark');
    await themeButton(privatePage).click();
    await ui(privatePage.locator('html')).toHaveAttribute('data-theme', 'light');
    await blocked.close();

    // Decorative motion must never change the command or block copying/expansion.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(origin);
    const terminal = page.locator('.hero .terminal-box');
    const command = await terminal.locator('code').innerText();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy starter command' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
    await ui
      .poll(() =>
        terminal.evaluate(
          (el) =>
            el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length,
        ),
      )
      .toBe(0);
    await page.locator('.make-link').hover();
    await ui(page.locator('.make-link')).toHaveCSS('background-color', 'rgb(175, 217, 183)');
    await ui(page.locator('.make-link')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, -2)');
    await page.screenshot({ path: `${shots}/create-hover.png` });
    await terminal.locator('.terminal-hint').click();
    await ui(terminal.locator('details')).toHaveAttribute('open', '');
    await ui(terminal.locator('video')).toBeVisible();
    await terminal.locator('.terminal-hint').click();
    await ui(terminal.locator('details')).not.toHaveAttribute('open', '');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.make-link').hover();
    await ui(page.locator('.make-link')).toHaveCSS('transform', 'none');
    expect(await terminal.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
    await second.goto(origin + '/n/' + fixtures[0].naddr);
    const remix = second.getByRole('button', { name: 'Remix this', exact: true });
    await remix.click();
    await ui(
      second.getByRole('heading', { name: `Make ${fixtures[0].title} your own` }),
    ).toBeVisible();
    await second.keyboard.press('Escape');
    await ui(second.getByRole('link', { name: 'Browse source', exact: true })).toHaveAttribute(
      'href',
      `/r/${fixtures[0].snapshot.id}/source`,
    );
    await second.emulateMedia({ reducedMotion: 'no-preference' });
    for (const effect of ['remix', 'source', 'zap']) {
      const button = second.locator(`[data-effect="${effect}"]`).first();
      await button.hover();
      await ui(button).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, -2)');
      await button.screenshot({ path: `${shots}/${effect}-hover.png` });
    }
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    clearTimeout(timer);
    server.kill();
    await server.exited;
    await rm(directory, { recursive: true, force: true });
  }
}, 90000);

test('local workshop sends live NAP-THEME through the pinned shim without resetting gameplay or settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soy-theme-preview-'));
  let server: ReturnType<typeof startPreviewServer> | undefined;
  const browser = await chromium.launch();
  try {
    await Bun.write(
      join(directory, 'napplet.json'),
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Theme specimen',
        entry: 'index.html',
        previewId: crypto.randomUUID(),
        license: 'MIT',
        relays: [],
      }),
    );
    await Bun.write(
      join(directory, 'index.html'),
      `<!doctype html>
      <meta name="napplet-config-schema" content='{"type":"object","properties":{"speed":{"type":"number","title":"Speed","default":1}}}'>
      <style>body{background:#5a295f;color:white}</style><button id="score">Score: 0</button><pre id="theme"></pre><output id="changes">0</output>
      <script>
      let score = 0, changes = 0;
      document.querySelector('#score').onclick = () => document.querySelector('#score').textContent = 'Score: ' + (++score);
      const show = theme => document.querySelector('#theme').textContent = JSON.stringify(theme);
      napplet.theme.get().then(show);
      window.sub = napplet.theme.onChanged(theme => { show(theme); document.querySelector('#changes').textContent = ++changes; });
      </script>`,
    );
    server = startPreviewServer(pathToFileURL(directory + '/'), 0, false, await previewAssets());
    const page = await browser.newPage({
      colorScheme: 'light',
      viewport: { width: 1100, height: 850 },
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(server.url.href);
    const frame = page.frameLocator('#stage iframe');
    await ui(frame.locator('#theme')).toContainText('#f5f1e4');
    await frame.getByRole('button', { name: 'Score: 0' }).click();
    await themeButton(page).click(); // Auto -> Light, same palette: no notification.
    await ui(frame.locator('#changes')).toHaveText('0');
    await themeButton(page).click();
    await ui(frame.locator('#theme')).toContainText('#171e1a');
    await ui(frame.locator('#changes')).toHaveText('1');
    await ui(frame.locator('#score')).toHaveText('Score: 1');
    await ui(frame.locator('body')).toHaveCSS('background-color', 'rgb(90, 41, 95)');
    await page.getByRole('button', { name: 'Napplet settings', exact: true }).click();
    await ui(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(23, 30, 26)');
    await ui(page.getByLabel('Speed', { exact: true })).toHaveCSS(
      'background-color',
      'rgb(34, 45, 38)',
    );
    await mkdir(shots, { recursive: true });
    await page.screenshot({ path: `${shots}/preview-settings-dark.png` });
    await page.getByLabel('Speed', { exact: true }).fill('2');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await themeButton(page).click(); // Auto / light OS
    await ui(frame.locator('#changes')).toHaveText('2');
    await ui(frame.locator('#score')).toHaveText('Score: 1');
    const child = page.frames().find((f) => f.parentFrame())!;
    expect(await child.evaluate(async () => await (window as any).napplet.config.get())).toEqual({
      speed: 2,
    });
    await child.evaluate(() => (window as any).sub.close());
    await page.emulateMedia({ colorScheme: 'dark' });
    await ui(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await ui(frame.locator('#changes')).toHaveText('2');
    expect(
      await child.evaluate(async () => await (window as any).napplet.theme.get()),
    ).toMatchObject({ colors: { background: '#171e1a' } });
    await page.getByRole('button', { name: 'Listing', exact: true }).click();
    await ui(page.locator('.listing-card')).toBeVisible();
    await page.screenshot({ path: `${shots}/preview-listing-dark.png` });
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server?.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
