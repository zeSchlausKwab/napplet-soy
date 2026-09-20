import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { expect } from 'bun:test';
import { startAlignmentServer } from './serve';
import { exportAligned } from './export';

const directory = resolve('.local/sprite-alignment-check');
await mkdir(directory, { recursive: true });
const server = startAlignmentServer(0);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1080 },
  reducedMotion: 'reduce',
});
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(server.url.toString());
  await page.waitForFunction(
    () => document.querySelector('#source-name')?.textContent === 'soybert-laptop.png',
  );
  expect(await page.locator('.frame-button').count()).toBe(9);
  expect(await page.locator('#export-png').isDisabled()).toBe(true);
  await page.screenshot({ path: resolve(directory, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(directory, 'mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1080 });

  // A known landmark shifts independently in every frame. Export must hold it still.
  const points = Array.from({ length: 9 }, (_, i) => ({
    x: 3 + (i % 3),
    y: 3 + Math.floor(i / 3),
  }));
  const pixels = Buffer.alloc(30 * 30 * 4);
  points.forEach((p, i) => {
    const x = (i % 3) * 10 + p.x,
      y = Math.floor(i / 3) * 10 + p.y;
    pixels.set([255, 0, 0, 255], (y * 30 + x) * 4);
  });
  const sourceBytes = await sharp(pixels, { raw: { width: 30, height: 30, channels: 4 } })
    .png()
    .toBuffer();
  await page
    .locator('#image-file')
    .setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: sourceBytes });
  await page.waitForFunction(
    () => document.querySelector('#source-name')?.textContent === 'fixture.png',
  );
  for (let i = 0; i < 9; i++) {
    await page.locator('.frame-button').nth(i).click();
    await page.locator('#anchor-x').fill(String(points[i].x));
    await page.locator('#anchor-y').fill(String(points[i].y));
    await page.locator('#anchor-y').press('Tab');
  }
  expect(await page.locator('#progress').textContent()).toBe('9 / 9 set');
  expect(await page.locator('#export-png').isEnabled()).toBe(true);
  await page.locator('.frame-button').first().click();
  await page.locator('#zoom').selectOption('4');
  await page.locator('#editor').click({ position: { x: 14, y: 14 } });
  await page.locator('#editor').press('ArrowRight');
  expect(await page.locator('#anchor-x').inputValue()).toBe('4');
  await page.locator('#editor').press('ArrowLeft');
  expect(await page.locator('#anchor-x').inputValue()).toBe('3');
  await page.locator('#onion').check();
  await page.locator('.frame-button').nth(1).click();
  await page.locator('#scrub').fill('4');
  expect(await page.locator('#preview-frame').textContent()).toBe('05 / 09');
  await page.locator('#play').click();
  await page.waitForFunction(
    () => document.querySelector('#preview-frame')?.textContent !== '05 / 09',
  );
  await page.locator('#play').click();

  const jsonDownload = page.waitForEvent('download');
  await page.locator('#export-json').click();
  const jsonPath = resolve(directory, 'fixture.alignment.json');
  await (await jsonDownload).saveAs(jsonPath);
  const recipe = JSON.parse(await readFile(jsonPath, 'utf8'));
  expect(recipe.anchors).toEqual(points);
  const pngDownload = page.waitForEvent('download');
  await page.locator('#export-png').click();
  const pngPath = resolve(directory, 'fixture-aligned.png');
  await (await pngDownload).saveAs(pngPath);
  const output = await sharp(pngPath).raw().toBuffer({ resolveWithObject: true });
  expect(output.info.width).toBe(42);
  expect(output.info.height).toBe(42);
  for (let i = 0; i < 9; i++) {
    const x = (i % 3) * 14 + 5,
      y = Math.floor(i / 3) * 14 + 5,
      start = (y * 42 + x) * 4;
    expect([...output.data.subarray(start, start + 4)]).toEqual([255, 0, 0, 255]);
  }
  const sourcePath = resolve(directory, 'fixture.png');
  await writeFile(sourcePath, sourceBytes);
  const cliPath = resolve(directory, `fixture-cli-${Date.now()}.png`);
  await exportAligned(sourcePath, jsonPath, cliPath);
  expect(await sharp(cliPath).raw().toBuffer()).toEqual(output.data);
  await page.locator('#clear-point').click();
  expect(await page.locator('#export-png').isDisabled()).toBe(true);
  await page.locator('#recipe-file').setInputFiles(jsonPath);
  await page.waitForFunction(() =>
    document.querySelector('#notice')?.textContent?.includes('Recipe restored'),
  );
  expect(await page.locator('#export-png').isEnabled()).toBe(true);
  await page
    .locator('#recipe-file')
    .setInputFiles({
      name: 'wrong.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({ ...recipe, source: { ...recipe.source, sha256: 'wrong' } }),
      ),
    });
  await page.waitForFunction(() =>
    document.querySelector('#notice')?.textContent?.includes('different source'),
  );
  expect(await page.locator('#export-png').isEnabled()).toBe(true);
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('#source-name')?.textContent === 'soybert-laptop.png',
  );
  await page
    .locator('#image-file')
    .setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: sourceBytes });
  await page.waitForFunction(
    () => document.querySelector('#progress')?.textContent === '9 / 9 set',
  );
  expect(await page.locator('#anchor-x').inputValue()).toBe('3');
  expect(errors).toEqual([]);
  console.log(
    'Browser verification passed: landmarks, click/zoom/nudge, synchronized preview, PNG + JSON, CLI parity, restore, mismatch rejection, desktop/mobile, no page errors.',
  );
} finally {
  await browser.close();
  server.stop(true);
}
