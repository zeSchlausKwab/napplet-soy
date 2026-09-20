import { test, expect } from 'bun:test';
import sharp from 'sharp';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { splitGrid, alignmentPlan, makeRecipe, validateRecipe } from './core.js';
import { exportAligned } from './export';

test('partition includes every pixel in sheets not divisible by the grid', () => {
  const frames = splitGrid(11, 7, 3, 2);
  expect(frames.map((f) => [f.width, f.height])).toEqual([
    [3, 3],
    [4, 3],
    [4, 3],
    [3, 4],
    [4, 4],
    [4, 4],
  ]);
  expect(frames.reduce((sum, f) => sum + f.width * f.height, 0)).toBe(77);
  expect(() => splitGrid(11, 7, 0, 2)).toThrow();
});

test('positive and negative shifts align landmarks and retain complete source cells', () => {
  const frames = splitGrid(18, 6, 3, 1),
    anchors = [
      { x: 2, y: 2 },
      { x: 4, y: 0 },
      { x: 0, y: 5 },
    ];
  const plan = alignmentPlan(frames, anchors);
  expect(plan.offsets).toEqual([
    { x: 0, y: 0 },
    { x: -2, y: 2 },
    { x: 2, y: -3 },
  ]);
  expect([plan.width, plan.height]).toEqual([12, 12]);
  frames.forEach((f, i) => {
    const x = plan.paddingX + plan.offsets[i].x,
      y = plan.paddingY + plan.offsets[i].y;
    expect({ x: x + anchors[i].x, y: y + anchors[i].y }).toEqual(plan.target!);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + f.width).toBeLessThanOrEqual(plan.width);
    expect(y + f.height).toBeLessThanOrEqual(plan.height);
  });
});

test('incomplete, fractional, out-of-bounds and mismatched recipes cannot export', () => {
  const source = { name: 'test.png', width: 6, height: 3, sha256: 'fixture' },
    grid = { columns: 2, rows: 1 };
  const frames = splitGrid(6, 3, 2, 1);
  expect(() => alignmentPlan(frames, [{ x: 1, y: 1 }, null])).toThrow('frame 2');
  expect(() =>
    alignmentPlan(frames, [
      { x: 1.5, y: 1 },
      { x: 1, y: 1 },
    ]),
  ).toThrow('frame 1');
  expect(() =>
    alignmentPlan(frames, [
      { x: 3, y: 1 },
      { x: 1, y: 1 },
    ]),
  ).toThrow('frame 1');
  const recipe = makeRecipe(source, grid, [
    { x: 1, y: 1 },
    { x: 1, y: 1 },
  ]);
  expect(() => validateRecipe(recipe, { ...source, sha256: 'different' })).toThrow(
    'different source',
  );
  recipe.output.width = 999;
  expect(validateRecipe(recipe, source).output.width).toBe(6);
});

test('PNG export preserves landmarks, edge pixels and alpha; refuses overwrite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'soy-align-'));
  try {
    const data = Buffer.alloc(8 * 4 * 4);
    const pixel = (x: number, y: number, color: number[]) => data.set(color, (y * 8 + x) * 4);
    pixel(1, 1, [255, 0, 0, 255]);
    pixel(6, 2, [255, 0, 0, 255]);
    pixel(0, 0, [0, 255, 0, 255]);
    pixel(7, 3, [0, 0, 255, 255]);
    pixel(3, 0, [255, 255, 255, 128]);
    const sourceBytes = await sharp(data, { raw: { width: 8, height: 4, channels: 4 } })
      .png()
      .toBuffer();
    const source = {
      name: 'original.png',
      width: 8,
      height: 4,
      sha256: createHash('sha256').update(sourceBytes).digest('hex'),
    };
    const recipe = makeRecipe(source, { columns: 2, rows: 1 }, [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
    const original = join(dir, 'original.png'),
      json = join(dir, 'recipe.json'),
      target = join(dir, 'aligned.png');
    await writeFile(original, sourceBytes);
    await writeFile(json, JSON.stringify(recipe));
    await exportAligned(original, json, target);
    const result = await sharp(await readFile(target))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sample = (x: number, y: number) => [
      ...result.data.subarray((y * result.info.width + x) * 4, (y * result.info.width + x) * 4 + 4),
    ];
    expect(sample(2, 2)).toEqual([255, 0, 0, 255]);
    expect(sample(8, 2)).toEqual([255, 0, 0, 255]);
    expect(sample(1, 1)).toEqual([0, 255, 0, 255]);
    expect(sample(9, 3)).toEqual([0, 0, 255, 255]);
    expect(sample(4, 1)[3]).toBe(128);
    expect(sample(0, 0)[3]).toBe(0);
    expect(await readFile(original)).toEqual(sourceBytes);
    await expect(exportAligned(original, json, original)).rejects.toThrow('new output path');
    await expect(exportAligned(original, json, target)).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
