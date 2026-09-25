import { test, expect } from 'bun:test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareMinicraft, startMinicraft } from '../../scripts/minicraft';
import { browserEngine } from '../../apps/cli/src/browser';
import { Database } from 'bun:sqlite';
import {
  chunkKey,
  offsetFor,
  positionFor,
  type Cell,
} from '../../packages/dynamic-backends/demo/world-client';

test('MiniCraft: two real hosted players edit, private worlds reject visitors, and data survives restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'minicraft-browser-'));
  const prepared = await prepareMinicraft(directory);
  let demo = await startMinicraft(prepared, 0);
  const browser = await (await browserEngine()).chromium.launch({ headless: true });
  const owner = await browser.newContext(),
    guest = await browser.newContext();
  const a = await owner.newPage(),
    b = await guest.newPage();
  const pageErrors: string[] = [];
  for (const page of [a, b]) page.on('pageerror', (error) => pageErrors.push(error.message));
  const iframe = (page: typeof a) => page.frameLocator('iframe');
  const storedBlock = (world: string, cell: Cell) => {
    const db = new Database(
      join(directory, '.napplet-space/backend/boards.sqlite.dynamic.sqlite'),
      { readonly: true },
    );
    try {
      const record = db
        .query<{ value: string }, [string, string]>(
          "SELECT value FROM records WHERE instance=? AND collection='chunks' AND key=?",
        )
        .get(world, chunkKey(positionFor(cell)));
      return record ? JSON.parse(record.value).blocks[offsetFor(cell)] : 0;
    } finally {
      db.close();
    }
  };
  const errors = () =>
    Promise.all(
      [a, b].map(async (p) => ({
        host: await p
          .evaluate(() => document.querySelector('#host-error')?.textContent)
          .catch(() => ''),
        frame: await p
          .frames()
          .find((f) => f.parentFrame())
          ?.evaluate(() => ({
            status: document.querySelector('#status')?.textContent,
            notice: document.querySelector('#notification')?.textContent,
          }))
          .catch(() => null),
        pageErrors,
      })),
    );
  try {
    await a.goto(demo.server.url.href);
    await iframe(a).locator('#create:enabled').waitFor({ timeout: 30000 });
    await iframe(a).locator('#name').fill('Shared island');
    await iframe(a).locator('#create').click();
    await a.locator('#allow').click({ timeout: 15000 });
    await iframe(a).locator('#invite').waitFor({ state: 'visible', timeout: 30000 });
    const code = await iframe(a).locator('#invite').inputValue();
    expect(code).toMatch(/^[a-f0-9]{32}\.[a-f0-9]{64}$/);
    await b.goto(demo.server.url.href);
    await iframe(b).locator('#join:enabled').waitFor({ timeout: 30000 });
    await iframe(b).locator('#join-code').fill(code);
    await iframe(b).locator('#join').click();
    await b.locator('#allow').click({ timeout: 15000 });
    await iframe(b)
      .getByRole('heading', { name: 'Shared island', exact: true })
      .waitFor({ timeout: 30000 });
    const before = Number(await iframe(a).locator('#revision').getAttribute('data-revision'));
    const bounds = (await iframe(a).locator('canvas').boundingBox())!;
    await iframe(a).getByRole('button', { name: 'Wood', exact: true }).click();
    await a.mouse.move(bounds.x + bounds.width * 0.42, bounds.y + bounds.height * 0.51);
    const selection = await iframe(a).locator('#selection').textContent();
    expect(selection).toMatch(/^\d+ · \d+ · \d+$/);
    const [x, y, z] = selection!.split(' · ').map(Number);
    const placed = { x, y, z };
    expect(storedBlock(code.split('.')[0], placed)).toBe(0);
    await a.mouse.click(bounds.x + bounds.width * 0.42, bounds.y + bounds.height * 0.51);
    await iframe(a)
      .locator('#revision[data-revision="' + (before + 1) + '"]')
      .waitFor({ timeout: 20000 });
    await iframe(b)
      .locator('#revision[data-revision="' + (before + 1) + '"]')
      .waitFor({ timeout: 15000 });
    expect(storedBlock(code.split('.')[0], placed)).toBe(4);
    // The second player can remove that same authoritative block through the UI.
    const boundsB = (await iframe(b).locator('canvas').boundingBox())!;
    await iframe(b).getByRole('button', { name: '− Remove', exact: true }).click();
    await b.mouse.move(boundsB.x + boundsB.width * 0.42, boundsB.y + boundsB.height * 0.51);
    expect(await iframe(b).locator('#selection').textContent()).toBe(selection);
    await b.mouse.click(boundsB.x + boundsB.width * 0.42, boundsB.y + boundsB.height * 0.51);
    await iframe(b)
      .locator('#revision[data-revision="' + (before + 2) + '"]')
      .waitFor({ timeout: 20000 });
    await iframe(a)
      .locator('#revision[data-revision="' + (before + 2) + '"]')
      .waitFor({ timeout: 15000 });
    expect(storedBlock(code.split('.')[0], placed)).toBe(0);
    await mkdir('.local/minicraft-evidence', { recursive: true });
    await a.screenshot({ path: '.local/minicraft-evidence/desktop.png' });

    await iframe(a).locator('#access').selectOption('members');
    await iframe(a).locator('#name').fill('Private island');
    await iframe(a).locator('#create').click();
    await iframe(a)
      .getByRole('heading', { name: 'Private island', exact: true })
      .waitFor({ timeout: 30000 });
    const privateCode = await iframe(a).locator('#invite').inputValue();
    await iframe(b).locator('#join-code').fill(privateCode);
    await iframe(b).locator('#join').click();
    await iframe(b)
      .locator('#notification')
      .filter({ hasText: 'does not grant' })
      .waitFor({ timeout: 20000 });
    expect(await iframe(b).locator('#world-name h1').textContent()).toBe('Shared island');

    const port = demo.server.port!;
    await demo.close();
    demo = await startMinicraft(prepared, port);
    await a.reload();
    await iframe(a).locator('#join:enabled').waitFor({ timeout: 30000 });
    await iframe(a).locator('#join-code').fill(code);
    await iframe(a).locator('#join').click();
    await a.locator('#allow').click({ timeout: 15000 });
    await iframe(a)
      .locator('#revision[data-revision="' + (before + 2) + '"]')
      .waitFor({ timeout: 30000 });
    expect(storedBlock(code.split('.')[0], placed)).toBe(0);

    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const phone = await mobile.newPage();
    phone.on('pageerror', (error) => pageErrors.push(error.message));
    await phone.goto(demo.server.url.href);
    await iframe(phone).locator('#join:enabled').waitFor({ state: 'attached', timeout: 30000 });
    await iframe(phone).locator('summary').click();
    await iframe(phone).locator('#join-code').fill(code);
    await iframe(phone).locator('#join').click();
    await phone.locator('#allow').click({ timeout: 15000 });
    await iframe(phone)
      .getByRole('heading', { name: 'Shared island', exact: true })
      .waitFor({ timeout: 30000 });
    expect(await iframe(phone).locator('#world-panel').getAttribute('open')).toBeNull();
    const phoneFrame = phone.frames().find((f) => f.parentFrame())!;
    expect(
      await phoneFrame.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    const phoneBounds = (await iframe(phone).locator('canvas').boundingBox())!;
    await phone.touchscreen.tap(
      phoneBounds.x + phoneBounds.width * 0.5,
      phoneBounds.y + phoneBounds.height * 0.49,
    );
    await iframe(phone).locator('#apply:enabled').waitFor();
    await iframe(phone).locator('#apply').tap();
    await iframe(phone)
      .locator('#revision[data-revision="' + (before + 3) + '"]')
      .waitFor({ timeout: 20000 });
    await phone.screenshot({ path: '.local/minicraft-evidence/mobile.png' });
    await phone.setViewportSize({ width: 844, height: 390 });
    const tools = await iframe(phone).locator('#toolbar').boundingBox();
    expect(tools!.y + tools!.height).toBeLessThanOrEqual(390);
    await mobile.close();
    expect(pageErrors).toEqual([]);
  } catch (error) {
    console.error(JSON.stringify(await errors()));
    await a.screenshot({ path: '/tmp/minicraft-failure.png' }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    await demo.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 150000);
