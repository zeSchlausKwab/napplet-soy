import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { splitGrid, alignmentPlan, validateRecipe } from './core.js';

export async function exportAligned(sourcePath: string, recipePath: string, outputPath: string) {
  if (resolve(sourcePath) === resolve(outputPath) || resolve(recipePath) === resolve(outputPath))
    throw new Error('Use a new output path; originals and recipes are preserved.');
  const bytes = await readFile(sourcePath);
  const metadata = await sharp(bytes).metadata();
  const source = {
    name: sourcePath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    width: metadata.width!,
    height: metadata.height!,
  };
  const recipe = validateRecipe(JSON.parse(await readFile(recipePath, 'utf8')), source);
  const frames = splitGrid(source.width, source.height, recipe.grid.columns, recipe.grid.rows);
  const plan = alignmentPlan(frames, recipe.anchors);
  const layers = await Promise.all(
    frames.map(async (f, i) => ({
      input: await sharp(bytes)
        .extract({ left: f.x, top: f.y, width: f.width, height: f.height })
        .png()
        .toBuffer(),
      left: (i % recipe.grid.columns) * plan.width + plan.paddingX + plan.offsets[i].x,
      top: Math.floor(i / recipe.grid.columns) * plan.height + plan.paddingY + plan.offsets[i].y,
    })),
  );
  const output = await sharp({
    create: {
      width: recipe.output.width,
      height: recipe.output.height,
      channels: 4,
      background: '#00000000',
    },
  })
    .composite(layers)
    .png()
    .toBuffer();
  // Exclusive creation also prevents accidental replacement via symlinks.
  await writeFile(outputPath, output, { flag: 'wx' });
  return recipe.output;
}
if (import.meta.main) {
  const [source, recipe, output] = process.argv.slice(2);
  if (!source || !recipe || !output) {
    console.error(
      'Usage: bun scripts/sprite-align/export.ts original.png alignment.json corrected.png',
    );
    process.exit(1);
  }
  try {
    console.log(JSON.stringify(await exportAligned(source, recipe, output), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
