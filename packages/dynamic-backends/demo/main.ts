import { createScene, materials } from './scene';
import {
  BackendFailure,
  chunkKey,
  intent,
  offsetFor,
  parseWorldCode,
  positionFor,
  positions,
  tool,
  worldCode,
  type Cell,
  type Chunk,
  type Intent,
  type Target,
} from './world-client';
declare const MINICRAFT_NAPPLET: string;
const module = { napplet: MINICRAFT_NAPPLET, name: 'worlds' };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (id: string) => $<HTMLButtonElement>(id);
let active: Target | null = null,
  release = '',
  revision = 0,
  busy = false,
  polling = false;
let chunks: Chunk[] = [],
  cell: Cell | null = null,
  material = 3,
  mode: 'build' | 'remove' = 'build';
let pending: Intent | null = null,
  recents: { name: string; code: string }[] = [],
  pollTimer: ReturnType<typeof setTimeout> | undefined;
const notify = (message: string, error = false) => {
  $('notification').textContent = message;
  $('notification').classList.toggle('error', error);
};
function status(message: string, state = 'ready') {
  $('status').textContent = message;
  $('status').dataset.state = state;
}
function lock(value: boolean) {
  busy = value;
  for (const id of ['create', 'join', 'refresh', 'retry']) button(id).disabled = value || !release;
  button('apply').disabled = value || !active || !cell || !!pending;
  document
    .querySelectorAll<HTMLButtonElement>('#saved button')
    .forEach((b) => (b.disabled = value || !!pending));
  if (pending) {
    button('create').disabled = true;
    button('join').disabled = true;
  }
}
const scene = createScene(
  $('scene'),
  (value) => {
    cell = value;
    $('selection').textContent = value
      ? [value.x, value.y, value.z].join(' · ')
      : 'tap a block to aim';
    button('apply').disabled = busy || !active || !cell || !!pending;
  },
  () => {
    void edit();
  },
);
function savedButtons() {
  $('saved').replaceChildren(
    ...recents.map((world) => {
      const b = document.createElement('button');
      b.textContent = world.name;
      b.onclick = () => {
        if (!busy && !pending) void open(parseWorldCode(world.code, module));
      };
      return b;
    }),
  );
}
async function remember(name: string) {
  const code = worldCode(active!);
  recents = [{ name, code }, ...recents.filter((w) => w.code !== code)].slice(0, 12);
  savedButtons();
  try {
    await (window as any).napplet.storage.setItem('minicraft.worlds', JSON.stringify(recents));
  } catch {
    notify(
      'World saved on the backend. Recent-world bookmarks are unavailable; keep the world code.',
    );
  }
}
async function read(operation: string, input: Record<string, unknown> = {}) {
  if (!active) throw new Error('Open a world first.');
  return tool('soy_backend_invoke', intent(active, operation, input));
}
async function snapshot() {
  const target = active;
  const result = await read('readChunks', { positions });
  if (active !== target) return;
  if (result.revision < revision) return;
  chunks = result.result.chunks;
  revision = result.revision;
  scene.render(chunks);
  $('revision').textContent = 'SAVED · REVISION ' + revision;
  $('revision').dataset.revision = String(revision);
}
async function open(target: Target) {
  if (busy) return;
  lock(true);
  notify('');
  status('Opening world…', 'busy');
  const previous = active,
    previousRevision = revision;
  active = target;
  revision = 0;
  try {
    const world = await read('readWorld');
    await snapshot();
    $('world-name').replaceChildren();
    const title = document.createElement('h1');
    title.textContent = world.result.name;
    const subtitle = document.createElement('p');
    subtitle.textContent = 'Make your mark. Your changes are saved on the backend.';
    $('world-name').append(title, subtitle);
    $<HTMLTextAreaElement>('invite').value = worldCode(active);
    $('share-box').style.display = 'block';
    await remember(world.result.name);
    status('● Connected · changes saved');
    if (innerWidth < 900) $<HTMLDetailsElement>('world-panel').open = false;
  } catch (error) {
    active = previous;
    revision = previousRevision;
    notify(error instanceof Error ? error.message : 'Could not open world.', true);
    status('Could not open world', 'error');
  } finally {
    lock(false);
  }
}
async function send(command: Intent) {
  pending = command;
  lock(true);
  notify('');
  status(command.operation === 'createWorld' ? 'Growing your island…' : 'Saving block…', 'busy');
  let created: Target | undefined;
  try {
    const response = await tool('soy_backend_invoke', command);
    pending = null;
    button('retry').style.display = 'none';
    if (command.operation === 'createWorld')
      created = { ...command.target, instance: response.instance };
    else {
      // A successful response proves commit. A failed refresh must never turn it
      // back into an uncertain write or cause a duplicate command.
      try {
        await snapshot();
        status('● Connected · changes saved');
      } catch (error) {
        notify(
          'Block saved, but refresh failed. Use Refresh world. ' + (error as Error).message,
          true,
        );
        status('Saved · refresh needed', 'error');
      }
    }
  } catch (error) {
    if (error instanceof BackendFailure && error.definitive) {
      pending = null;
      button('retry').style.display = 'none';
      notify(error.message + ' Nothing was changed by this request.', true);
      if (active) {
        try {
          await snapshot();
        } catch {}
      }
    } else {
      button('retry').style.display = 'inline-block';
      notify(
        'The connection was interrupted. Retry the saved action to find out whether it was saved. ' +
          (error as Error).message,
        true,
      );
    }
    status('Action needs attention', 'error');
  } finally {
    lock(false);
  }
  if (created) await open(created);
}
async function edit() {
  if (busy || pending || !active || !cell) return;
  const record = chunks.find((c) => chunkKey(c.position) === chunkKey(positionFor(cell!)));
  if (!record) return;
  const value = record.blocks[offsetFor(cell)];
  if (mode === 'build' && value !== 0)
    return notify('That space is occupied. Aim at a free face or remove the block.');
  if (mode === 'remove' && value === 0) return notify('There is no block at that position.');
  const input: Record<string, unknown> = { ...cell, expectedChunkRevision: record.revision };
  if (mode === 'build') input.block = materials[material - 1].name.toLowerCase();
  await send(intent(active, mode === 'build' ? 'placeBlock' : 'removeBlock', input));
}
materials.forEach((m, i) => {
  const b = document.createElement('button');
  b.className = 'material';
  b.title = m.name;
  b.setAttribute('aria-label', m.name);
  b.setAttribute('aria-pressed', String(i === material - 1));
  const swatch = document.createElement('i');
  swatch.style.setProperty('--block', m.color);
  const name = document.createElement('span');
  name.textContent = m.name;
  b.append(swatch, name);
  b.onclick = () => {
    material = i + 1;
    document
      .querySelectorAll('#palette button')
      .forEach((el, index) => el.setAttribute('aria-pressed', String(index === i)));
  };
  $('palette').append(b);
});
for (const value of ['build', 'remove'] as const)
  button(value).onclick = () => {
    mode = value;
    scene.mode(mode);
    for (const id of ['build', 'remove'])
      button(id).setAttribute('aria-pressed', String(id === value));
    button('apply').textContent = value === 'build' ? 'Place block' : 'Remove block';
  };
button('apply').onclick = () => void edit();
button('create').onclick = () => {
  if (busy || pending) return;
  const name = $<HTMLInputElement>('name').value.trim();
  if (!name) return notify('Give your island a name first.', true);
  const everyone = $<HTMLSelectElement>('access').value === 'everyone';
  void send(
    intent({ module, release }, 'createWorld', {
      name,
      seed: crypto.getRandomValues(new Uint32Array(1))[0] % 2147483647,
      mode: 'creative',
      visibility: everyone ? 'public' : 'members',
      building: everyone ? 'everyone' : 'members',
      guestsMayBuild: everyone,
      terrain: 'island',
    }),
  );
};
button('join').onclick = () => {
  if (busy || pending) return;
  try {
    void open(parseWorldCode($<HTMLInputElement>('join-code').value, module));
  } catch (error) {
    notify((error as Error).message, true);
  }
};
button('refresh').onclick = async () => {
  if (!active || busy) return;
  lock(true);
  try {
    await snapshot();
    status('● Connected · changes saved');
    if (!pending) notify('');
  } catch (error) {
    notify((error as Error).message, true);
  } finally {
    lock(false);
  }
};
button('retry').onclick = () => {
  if (!pending || busy) return;
  if (pending.expiresAt <= Math.floor(Date.now() / 1000)) {
    notify(
      'The retry window expired. Refresh the world to inspect its state before making another change.',
      true,
    );
    pending = null;
    button('retry').style.display = 'none';
    lock(false);
    return;
  }
  void send(pending);
};
button('copy').onclick = async () => {
  const input = $<HTMLTextAreaElement>('invite');
  input.focus();
  input.select();
  // Clipboard API can be unavailable in sandboxed frames; selection still works.
  try {
    await navigator.clipboard.writeText(input.value);
    button('copy').textContent = 'Copied!';
  } catch {
    button('copy').textContent = 'Selected — copy this code';
  }
};
async function poll() {
  if (active && !busy && !polling && document.visibilityState === 'visible') {
    polling = true;
    try {
      const changes = await tool('soy_backend_changes', { target: active, after: revision });
      if (!busy && changes.revision > revision) await snapshot();
      if (!busy && !pending) status('● Connected · changes saved');
    } catch (error) {
      if ((error as Error).message.includes('Cursor')) {
        try {
          await snapshot();
        } catch {}
      } else if (!busy) status('Reconnecting · your world is saved', 'error');
    } finally {
      polling = false;
    }
  }
  pollTimer = setTimeout(poll, 2500);
}
async function start() {
  if (innerWidth < 700) $<HTMLDetailsElement>('world-panel').open = false;
  await (window as any).napplet.shell.ready();
  const description = await tool('soy_backend_describe', { module });
  release = description.release;
  if (!release) throw new Error('No active world backend. Restart the demo server.');
  try {
    const data = JSON.parse(
      (await (window as any).napplet.storage.getItem('minicraft.worlds')) ?? '[]',
    );
    recents = Array.isArray(data)
      ? data.filter((w) => typeof w.name === 'string' && typeof w.code === 'string').slice(0, 12)
      : [];
  } catch {
    recents = [];
  }
  savedButtons();
  status('● Ready · create or join an island');
  lock(false);
  void poll();
}
window.addEventListener('pagehide', () => {
  clearTimeout(pollTimer);
  scene.close();
});
void start().catch((error) => {
  status('Connection unavailable', 'error');
  notify(error.message + ' Reload this preview to reconnect.', true);
});
