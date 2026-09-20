import { splitGrid, alignmentPlan, makeRecipe, validateRecipe } from './core.js';

const $ = (selector) => document.querySelector(selector);
const editor = $('#editor'),
  ctx = editor.getContext('2d');
let source,
  bitmap,
  frames = [],
  anchors = [],
  columns = 3,
  rows = 3,
  selected = 0;
let plan,
  clips = [],
  currentFrame = 0,
  lastTick = 0,
  loadGeneration = 0;
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
let library = [],
  activeSheet = null;
const cacheKey = () => `soybert-align/v1/${source.sha256}/${columns}x${rows}`;
const say = (text, error = false) => {
  $('#notice').textContent = text;
  $('#notice').classList.toggle('error', error);
};
const canvas = (width, height) =>
  Object.assign(document.createElement('canvas'), { width, height });
const ready = () => anchors.length > 0 && anchors.every(Boolean);

function persist() {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify(anchors));
    $('#save-state').textContent =
      'Points saved in this browser. Save a recipe for a portable backup.';
  } catch {
    $('#save-state').textContent = 'Browser storage is unavailable. Save a recipe before closing.';
  }
}

async function loadImage(blob, name, sheet = null, generation = ++loadGeneration) {
  let next;
  try {
    if (generation !== loadGeneration) return;
    if (blob.size > 24 * 1024 * 1024) throw new Error('Choose a PNG smaller than 24 MB.');
    const bytes = await blob.arrayBuffer();
    const signature = [...new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8))].join(',');
    if (signature !== '137,80,78,71,13,10,26,10') throw new Error('Choose a PNG sprite sheet.');
    next = await createImageBitmap(blob);
    if (next.width * next.height > 16_777_216 || next.width < 3 || next.height < 3)
      throw new Error('Choose a sheet between 3×3 pixels and 16 megapixels.');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    if (generation !== loadGeneration) {
      next.close();
      return;
    }
    const grid = sheet ?? { columns: 3, rows: 3 };
    splitGrid(next.width, next.height, grid.columns, grid.rows);
    bitmap?.close();
    bitmap = next;
    source = { name, width: next.width, height: next.height, sha256: hash };
    $('#source-name').textContent = name;
    setupGrid(grid.columns, grid.rows);
    activeSheet = sheet?.id ?? null;
    $('#landmark-hint').textContent =
      sheet?.hint ?? 'Choose a stable body or object landmark. Avoid anything intended to move.';
    syncLibrary();
    say('Choose a stable landmark in frame 1, then mark that same landmark in every frame.');
  } catch (error) {
    if (next !== bitmap) next?.close();
    if (generation === loadGeneration) say(error.message, true);
  }
}

function syncLibrary() {
  document
    .querySelectorAll('.sheet-button')
    .forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.sheet === activeSheet)),
    );
  const url = new URL(location.href);
  if (activeSheet) url.searchParams.set('sprite', activeSheet);
  else url.searchParams.delete('sprite');
  history.replaceState(null, '', url);
  try {
    if (activeSheet) localStorage.setItem('soybert-align/last-sheet', activeSheet);
    else localStorage.removeItem('soybert-align/last-sheet');
  } catch {
    /* Point saving reports storage limitations separately. */
  }
}

async function pickSheet(sheet) {
  // Reserve the generation before fetching, so a slow previous request cannot win.
  const generation = ++loadGeneration;
  say(`Loading ${sheet.label}…`);
  try {
    const response = await fetch(sheet.url);
    if (!response.ok) throw new Error('This sheet is unavailable. Choose another or open a PNG.');
    await loadImage(await response.blob(), sheet.name, sheet, generation);
  } catch (error) {
    if (generation === loadGeneration) say(error.message, true);
  }
}

function buildLibrary() {
  $('#sprite-library').replaceChildren();
  for (const sheet of library) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sheet-button';
    button.dataset.sheet = sheet.id;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute(
      'aria-label',
      `${sheet.label}, ${sheet.columns} by ${sheet.rows} sprite sheet`,
    );
    const thumb = document.createElement('span');
    thumb.className = 'library-thumb checker';
    thumb.setAttribute('aria-hidden', 'true');
    const art = document.createElement('span');
    art.style.backgroundImage = `url("${sheet.url}")`;
    art.style.backgroundSize = `${sheet.columns * 100}% ${sheet.rows * 100}%`;
    thumb.append(art);
    const caption = document.createElement('span');
    caption.className = 'sheet-caption';
    const title = document.createElement('strong');
    title.textContent = sheet.label;
    const grid = document.createElement('span');
    grid.textContent = `${sheet.columns} × ${sheet.rows} · ${sheet.detail}`;
    caption.append(title, grid);
    button.append(thumb, caption);
    button.onclick = () => pickSheet(sheet);
    $('#sprite-library').append(button);
  }
}

function setupGrid(c, r, restored) {
  const nextFrames = splitGrid(source.width, source.height, c, r);
  let nextAnchors = restored ?? Array(nextFrames.length).fill(null);
  if (!restored) {
    try {
      const saved = JSON.parse(localStorage.getItem(`soybert-align/v1/${source.sha256}/${c}x${r}`));
      if (saved) {
        alignmentPlan(nextFrames, saved, true);
        nextAnchors = saved;
      }
    } catch {
      /* Ignore invalid drafts. */
    }
  }
  columns = c;
  rows = r;
  frames = nextFrames;
  anchors = nextAnchors;
  selected = 0;
  currentFrame = 0;
  $('#columns').value = c;
  $('#rows').value = r;
  $('#source-info').textContent =
    `${source.width} × ${source.height} px / ${frames.length} frames / original preserved`;
  $('#scrub').max = frames.length - 1;
  clips = frames.map((f) => {
    const tile = canvas(f.width, f.height);
    tile.getContext('2d').drawImage(bitmap, f.x, f.y, f.width, f.height, 0, 0, f.width, f.height);
    return tile;
  });
  buildStrip();
  update();
  $('#viewport').scrollTo(0, 0);
}

function buildStrip() {
  $('#filmstrip').replaceChildren();
  frames.forEach((f, i) => {
    const button = document.createElement('button');
    button.className = 'frame-button';
    button.type = 'button';
    button.setAttribute('aria-label', `Frame ${i + 1}`);
    const thumb = canvas(100, Math.round((100 * f.height) / f.width));
    thumb.getContext('2d').drawImage(clips[i], 0, 0, thumb.width, thumb.height);
    const number = document.createElement('span');
    number.textContent = String(i + 1).padStart(2, '0');
    const mark = document.createElement('b');
    mark.className = 'marked';
    mark.setAttribute('aria-hidden', 'true');
    button.append(thumb, number, mark);
    button.onclick = () => selectFrame(i);
    $('#filmstrip').append(button);
  });
}

function selectFrame(i) {
  selected = i;
  update();
}
function drawEditor() {
  const f = frames[selected],
    zoom = Number($('#zoom').value),
    p = anchors[selected];
  editor.width = f.width * zoom;
  editor.height = f.height * zoom;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(clips[selected], 0, 0, editor.width, editor.height);
  if ($('#onion').checked && selected !== 0) {
    ctx.save();
    ctx.globalAlpha = 0.3;
    const dx = p && anchors[0] ? p.x - anchors[0].x : 0;
    const dy = p && anchors[0] ? p.y - anchors[0].y : 0;
    ctx.drawImage(clips[0], dx * zoom, dy * zoom, frames[0].width * zoom, frames[0].height * zoom);
    ctx.restore();
  }
  if (p) {
    const x = (p.x + 0.5) * zoom,
      y = (p.y + 0.5) * zoom;
    for (const [color, width] of [
      ['white', 4],
      ['#b84931', 2],
    ]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x - 14, y);
      ctx.lineTo(x + 14, y);
      ctx.moveTo(x, y - 14);
      ctx.lineTo(x, y + 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function update() {
  plan = alignmentPlan(frames, anchors, true);
  const count = anchors.filter(Boolean).length,
    complete = ready();
  $('#progress').textContent = `${count} / ${frames.length} set`;
  $('#frame-title').textContent =
    `Frame ${String(selected + 1).padStart(2, '0')}${selected === 0 ? ' · destination' : ''}`;
  const p = anchors[selected],
    f = frames[selected];
  $('#anchor-x').value = p?.x ?? '';
  $('#anchor-y').value = p?.y ?? '';
  $('#anchor-x').max = f.width - 1;
  $('#anchor-y').max = f.height - 1;
  $('#clear-point').disabled = !p;
  $('#offset').textContent =
    p && anchors[0]
      ? `Shift ${plan.offsets[selected].x >= 0 ? '+' : ''}${plan.offsets[selected].x}, ${plan.offsets[selected].y >= 0 ? '+' : ''}${plan.offsets[selected].y} px`
      : 'No point yet';
  document.querySelectorAll('.frame-button').forEach((button, i) => {
    button.setAttribute('aria-pressed', String(i === selected));
    button.setAttribute(
      'aria-label',
      `Frame ${i + 1}${anchors[i] ? ', point set' : ', needs point'}`,
    );
    button.querySelector('.marked').textContent = anchors[i] ? '✓' : '';
  });
  $('#export-png').disabled = !complete;
  $('#export-json').disabled = !complete;
  $('#draft').textContent = complete ? '' : '/ draft';
  $('#geometry').textContent =
    `${plan.width} × ${plan.height} px per corrected frame. Padding: ${plan.paddingX}px horizontal, ${plan.paddingY}px vertical.${complete ? ' All reference points align to frame 1.' : ` ${frames.length - count} points still needed; unset frames stay in place.`}`;
  $('#next-frame').textContent =
    selected === frames.length - 1 ? 'Back to frame 1 ↻' : 'Next frame →';
  for (const id of ['before', 'after']) {
    $('#' + id).width = plan.width;
    $('#' + id).height = plan.height;
  }
  drawEditor();
  drawPreview();
}

function setPoint(x, y) {
  const f = frames[selected];
  anchors[selected] = {
    x: Math.max(0, Math.min(f.width - 1, Math.round(x))),
    y: Math.max(0, Math.min(f.height - 1, Math.round(y))),
  };
  persist();
  update();
  say(
    ready()
      ? 'All points set. Check the corrected loop, then export the PNG and recipe.'
      : `Frame ${selected + 1} marked. Use Next frame when the point is right.`,
  );
}

editor.addEventListener('click', (event) => {
  if (!frames.length) return;
  const rect = editor.getBoundingClientRect(),
    f = frames[selected];
  setPoint(
    Math.floor(((event.clientX - rect.left) * f.width) / rect.width),
    Math.floor(((event.clientY - rect.top) * f.height) / rect.height),
  );
  editor.focus({ preventScroll: true });
});
editor.addEventListener('keydown', (event) => {
  if (!frames.length || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
    return;
  event.preventDefault();
  const p = anchors[selected] ?? {
      x: Math.floor(frames[selected].width / 2),
      y: Math.floor(frames[selected].height / 2),
    },
    step = event.shiftKey ? 10 : 1;
  setPoint(
    p.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
    p.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
  );
});
for (const id of ['anchor-x', 'anchor-y'])
  $('#' + id).addEventListener('change', () => {
    const x = $('#anchor-x').value,
      y = $('#anchor-y').value;
    if (
      frames.length &&
      x !== '' &&
      y !== '' &&
      Number.isFinite(Number(x)) &&
      Number.isFinite(Number(y))
    )
      setPoint(Number(x), Number(y));
  });
$('#clear-point').onclick = () => {
  if (!frames.length) return;
  anchors[selected] = null;
  persist();
  update();
};
$('#next-frame').onclick = () => {
  if (frames.length) selectFrame((selected + 1) % frames.length);
};
$('#zoom').onchange = () => {
  if (!frames.length) return;
  drawEditor();
  const p = anchors[selected],
    zoom = Number($('#zoom').value),
    viewport = $('#viewport');
  if (p)
    viewport.scrollTo(
      p.x * zoom - viewport.clientWidth / 2,
      p.y * zoom - viewport.clientHeight / 2,
    );
};
$('#onion').onchange = () => {
  if (frames.length) drawEditor();
};
$('#apply-grid').onclick = () => {
  if (!source) return;
  try {
    setupGrid(Number($('#columns').value), Number($('#rows').value));
    say('Grid applied. Points for each grid are saved separately.');
  } catch (error) {
    say(error.message, true);
  }
};
$('#image-file').onchange = async (event) => {
  const file = event.target.files[0];
  if (file) await loadImage(file, file.name);
  event.target.value = '';
};

function drawPreview() {
  if (!plan) return;
  for (const [id, corrected] of [
    ['before', false],
    ['after', true],
  ]) {
    const target = $('#' + id),
      g = target.getContext('2d'),
      d = corrected ? plan.offsets[currentFrame] : { x: 0, y: 0 };
    g.clearRect(0, 0, target.width, target.height);
    g.imageSmoothingEnabled = false;
    g.drawImage(clips[currentFrame], plan.paddingX + d.x, plan.paddingY + d.y);
  }
  $('#preview-frame').textContent =
    `${String(currentFrame + 1).padStart(2, '0')} / ${String(frames.length).padStart(2, '0')}`;
  $('#scrub').value = currentFrame;
  $('#play').textContent = paused ? 'Play' : 'Pause';
}
function tick(time) {
  if (frames.length && !paused && time - lastTick >= 1000 / Number($('#fps').value)) {
    currentFrame = (currentFrame + 1) % frames.length;
    lastTick = time;
    drawPreview();
  }
  requestAnimationFrame(tick);
}
$('#play').onclick = () => {
  paused = !paused;
  lastTick = performance.now();
  drawPreview();
};
$('#fps').oninput = () => {
  $('#fps-value').value = $('#fps').value;
};
$('#scrub').oninput = () => {
  if (!frames.length) return;
  paused = true;
  currentFrame = Number($('#scrub').value);
  drawPreview();
};

function download(blob, name) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
const stem = () => source.name.replace(/\.png$/i, '');
$('#export-json').onclick = () => {
  try {
    const recipe = makeRecipe(source, { columns, rows }, anchors);
    download(
      new Blob([JSON.stringify(recipe, null, 2) + '\n'], { type: 'application/json' }),
      `${stem()}.alignment.json`,
    );
  } catch (error) {
    say(error.message, true);
  }
};
$('#export-png').onclick = async () => {
  try {
    const recipe = makeRecipe(source, { columns, rows }, anchors);
    if (recipe.output.width * recipe.output.height > 67_108_864)
      throw new Error(
        'The corrected canvas is too large. Check for an accidental reference point far from the others.',
      );
    const output = canvas(recipe.output.width, recipe.output.height),
      g = output.getContext('2d');
    g.imageSmoothingEnabled = false;
    clips.forEach((tile, i) =>
      g.drawImage(
        tile,
        (i % columns) * plan.width + plan.paddingX + plan.offsets[i].x,
        Math.floor(i / columns) * plan.height + plan.paddingY + plan.offsets[i].y,
      ),
    );
    const blob = await new Promise((resolve) => output.toBlob(resolve, 'image/png'));
    if (!blob)
      throw new Error('PNG encoding failed. Save the recipe and use the command-line exporter.');
    download(blob, `${stem()}-aligned.png`);
    say(
      'Corrected PNG downloaded. Save the recipe too, so this exact alignment can be reproduced.',
    );
  } catch (error) {
    say(error.message, true);
  }
};
$('#recipe-file').onchange = async (event) => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    if (!source) throw new Error('Load the original PNG first.');
    if (file.size > 1_000_000) throw new Error('This recipe is too large.');
    const recipe = validateRecipe(JSON.parse(await file.text()), source);
    setupGrid(recipe.grid.columns, recipe.grid.rows, recipe.anchors);
    persist();
    say('Recipe restored and checked against the original image.');
  } catch (error) {
    say(error.message, true);
  }
  event.target.value = '';
};
requestAnimationFrame(tick);
try {
  const response = await fetch('/library.json');
  if (!response.ok) throw new Error('The sprite library is unavailable. Open a PNG to begin.');
  library = await response.json();
  buildLibrary();
  let remembered;
  try {
    remembered = localStorage.getItem('soybert-align/last-sheet');
  } catch {
    /* Optional. */
  }
  const requested = new URL(location.href).searchParams.get('sprite');
  const initial =
    library.find((sheet) => sheet.id === requested) ??
    library.find((sheet) => sheet.id === remembered) ??
    library[0];
  if (initial) await pickSheet(initial);
  else say('Open a PNG to begin. No bundled sprite sheets are available.');
} catch (error) {
  say(error.message, true);
}
