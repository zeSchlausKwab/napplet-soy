// Shared by the browser editor and the reproducible PNG exporter.
export function splitGrid(width, height, columns, rows) {
  if (
    ![width, height, columns, rows].every(Number.isInteger) ||
    width < 1 ||
    height < 1 ||
    columns < 1 ||
    rows < 1 ||
    columns > 12 ||
    rows > 12 ||
    columns > width ||
    rows > height
  )
    throw new Error('Choose a valid grid, with 1–12 columns and rows.');
  return Array.from({ length: columns * rows }, (_, i) => {
    const col = i % columns,
      row = Math.floor(i / columns);
    const x = Math.floor((col * width) / columns),
      y = Math.floor((row * height) / rows);
    return {
      x,
      y,
      width: Math.floor(((col + 1) * width) / columns) - x,
      height: Math.floor(((row + 1) * height) / rows) - y,
    };
  });
}

export function alignmentPlan(frames, anchors, allowPartial = false) {
  if (!frames.length || anchors.length !== frames.length)
    throw new Error('One anchor is required per frame.');
  for (let i = 0; i < frames.length; i++) {
    const p = anchors[i],
      f = frames[i];
    if (p === null && allowPartial) continue;
    if (
      !p ||
      !Number.isInteger(p.x) ||
      !Number.isInteger(p.y) ||
      p.x < 0 ||
      p.y < 0 ||
      p.x >= f.width ||
      p.y >= f.height
    )
      throw new Error(`Set a reference point inside frame ${i + 1}.`);
  }
  const target = anchors[0];
  const offsets = anchors.map((p) =>
    p && target ? { x: target.x - p.x, y: target.y - p.y } : { x: 0, y: 0 },
  );
  // Equal padding keeps square source cells square for the existing CSS player.
  const paddingX = Math.max(...offsets.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]));
  const paddingY = paddingX;
  const width = Math.max(...frames.map((f) => f.width)) + paddingX * 2;
  const height = Math.max(...frames.map((f) => f.height)) + paddingY * 2;
  return {
    width,
    height,
    paddingX,
    paddingY,
    offsets,
    target: target ? { x: target.x + paddingX, y: target.y + paddingY } : null,
  };
}

export function makeRecipe(source, grid, anchors) {
  const frames = splitGrid(source.width, source.height, grid.columns, grid.rows);
  const plan = alignmentPlan(frames, anchors);
  return {
    schema: 'napplet-sprite-alignment/v1',
    source,
    grid,
    anchors,
    output: {
      cellWidth: plan.width,
      cellHeight: plan.height,
      width: plan.width * grid.columns,
      height: plan.height * grid.rows,
      paddingX: plan.paddingX,
      paddingY: plan.paddingY,
      offsets: plan.offsets,
      anchor: plan.target,
      order: 'row-major',
      transform: 'integer-translation',
    },
  };
}

export function validateRecipe(recipe, source) {
  if (
    !recipe ||
    recipe.schema !== 'napplet-sprite-alignment/v1' ||
    !recipe.source ||
    !recipe.grid ||
    !Array.isArray(recipe.anchors)
  )
    throw new Error('This is not a supported alignment recipe.');
  if (
    recipe.source.sha256 !== source.sha256 ||
    recipe.source.width !== source.width ||
    recipe.source.height !== source.height
  )
    throw new Error('This recipe belongs to a different source image. Load the matching original.');
  // Recompute output geometry rather than trusting imported offsets.
  return makeRecipe(source, recipe.grid, recipe.anchors);
}
