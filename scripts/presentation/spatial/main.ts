import { SpatialScene } from './scene';
import { cameraAt, chapterAt, DURATION, focusPose, nodes, overviewPose, smooth } from './story';
import { createGame, drawGame, stepGame, DT, type Game, type Input } from './game';
const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const capture = new URLSearchParams(location.search).has('capture');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

async function boot() {
  await Promise.all([
    document.fonts.load('600 32px "DM Sans"'),
    document.fonts.load('400 32px "DM Sans"'),
    document.fonts.load('400 24px "DM Mono"'),
    document.fonts.load('600 32px "Fredoka"'),
  ]);
  const scene = new SpatialScene($<HTMLCanvasElement>('#scene'));
  let time = capture ? 0 : DURATION,
    playing = false,
    explore = !capture,
    active = 0,
    overview = !capture;
  let pose = capture ? cameraAt(0) : overviewPose,
    flight: { from: typeof pose; to: typeof pose; at: number } | undefined;
  let last = performance.now(),
    game: Game | undefined,
    gameAccum = 0;
  const keys: Input = {};
  const pulses: Input = {};
  const dialog = $<HTMLDialogElement>('#game-dialog'),
    playCanvas = $<HTMLCanvasElement>('#play-canvas');
  const captions = [
    'Every little world starts somewhere.',
    'A player has a beautifully bad idea.',
    'The creator tries it. Then accepts it.',
    'Same roots. A different kind of game.',
  ];
  function labels() {
    $<HTMLButtonElement>('#play').disabled = overview;
    $('#play').textContent = overview ? 'Select a version' : 'Play this version ↗';
    $('#chapter-label').textContent = overview ? 'THE WHOLE IDEA' : nodes[active].status;
    $('#chapter-title').textContent = overview ? 'One idea. More possibilities.' : captions[active];
    $('#watch').textContent = playing
      ? 'Pause story'
      : time >= DURATION
        ? 'Replay story'
        : 'Watch the story';
    $('#mobile-owner').textContent = `${nodes[active].owner} · ${nodes[active].role}`;
    $('#mobile-prompt').textContent = '“' + nodes[active].prompt + '”';
    $('#mobile-command').textContent = nodes[active].command;
    document
      .querySelectorAll<HTMLButtonElement>('[data-node]')
      .forEach((b) =>
        b.setAttribute('aria-pressed', String(Number(b.dataset.node) === active && !overview)),
      );
    $<HTMLInputElement>('#timeline').value = String(time);
    $('#time').textContent = `00:${String(Math.floor(time)).padStart(2, '0')} / 00:24`;
  }
  function resize() {
    const rect = $('#world').getBoundingClientRect();
    scene.resize(Math.round(rect.width), Math.round(rect.height));
    render();
  }
  function render() {
    scene.render(time, { pose, explore, active });
    labels();
  }
  function seek(t: number) {
    time = Math.max(0, Math.min(DURATION, t));
    active = chapterAt(time);
    overview = time >= 23.8;
    explore = false;
    flight = undefined;
    pose = cameraAt(time);
    render();
  }
  function fly(to: typeof pose) {
    if (reduced || capture) {
      pose = to;
      flight = undefined;
    } else flight = { from: pose, to, at: performance.now() };
  }
  function select(index: number) {
    active = index;
    playing = false;
    explore = true;
    overview = false;
    time = nodes[index].start + 2.8;
    fly(focusPose(index));
    render();
  }
  function showOverview() {
    playing = false;
    explore = true;
    overview = true;
    fly(overviewPose);
    render();
  }
  $('#overview').onclick = showOverview;
  $('#watch').onclick = () => {
    if (playing) playing = false;
    else {
      if (explore || time >= DURATION) seek(0);
      playing = true;
      explore = false;
      flight = undefined;
    }
    labels();
  };
  $<HTMLInputElement>('#timeline').oninput = (event) => {
    playing = false;
    seek(Number((event.target as HTMLInputElement).value));
  };
  document.querySelectorAll<HTMLButtonElement>('[data-node]').forEach((b) => {
    b.onclick = () => select(Number(b.dataset.node));
  });
  $('#scene').onclick = (event) => {
    const found = scene.pick(event.clientX, event.clientY);
    if (found !== undefined) select(found);
  };
  function clearKeys() {
    for (const k of Object.keys(keys) as (keyof Input)[]) keys[k] = false;
    for (const k of Object.keys(pulses) as (keyof Input)[]) pulses[k] = false;
  }
  function play() {
    playing = false;
    flight = undefined;
    clearKeys();
    gameAccum = 0;
    game = createGame(nodes[active].variant);
    $('#game-title').textContent =
      nodes[active].variant === 'original'
        ? 'Soybert’s little world · original'
        : 'Soybert’s little world · shotgun remix';
    $<HTMLButtonElement>('[data-key="shoot"]').disabled = nodes[active].variant === 'original';
    if (!dialog.open) dialog.showModal();
    playCanvas.focus();
    drawGame(playCanvas.getContext('2d')!, game);
    labels();
  }
  $('#play').onclick = play;
  $('#close-game').onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    game = undefined;
    clearKeys();
    $('#play').focus();
  });
  $('#restart-game').onclick = () => {
    if (game) game = createGame(game.variant);
  };
  const keyMap: Record<string, keyof Input> = {
    ArrowLeft: 'left',
    a: 'left',
    ArrowRight: 'right',
    d: 'right',
    ArrowUp: 'jump',
    w: 'jump',
    ' ': 'jump',
    x: 'shoot',
    j: 'shoot',
  };
  document.addEventListener('keydown', (event) => {
    if (!game) return;
    const key = keyMap[event.key];
    if (key) {
      keys[key] = true;
      if (!event.repeat && (key === 'jump' || key === 'shoot')) pulses[key] = true;
      event.preventDefault();
    }
    if (event.key.toLowerCase() === 'r') game = createGame(game.variant);
  });
  document.addEventListener('keyup', (event) => {
    const key = keyMap[event.key];
    if (key) keys[key] = false;
  });
  document.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((b) => {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      keys[b.dataset.key as keyof Input] = true;
      if (b.dataset.key === 'jump' || b.dataset.key === 'shoot') pulses[b.dataset.key] = true;
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
      b.addEventListener(type, () => {
        keys[b.dataset.key as keyof Input] = false;
      });
  });
  window.addEventListener('blur', clearKeys);
  document.addEventListener('visibilitychange', () => {
    last = performance.now();
    if (document.hidden) {
      playing = false;
      clearKeys();
      labels();
    }
  });
  const observer = new ResizeObserver(resize);
  observer.observe($('#world'));
  function loop(now: number) {
    const dt = Math.min((now - last) / 1000, 0.06);
    last = now;
    if (!document.hidden) {
      if (playing) {
        time = Math.min(DURATION, time + dt);
        pose = cameraAt(time);
        active = chapterAt(time);
        overview = time >= 23.8;
        if (time >= DURATION) playing = false;
      }
      if (flight) {
        const a = smooth((now - flight.at) / 1100);
        pose = {
          eye: flight.from.eye.map((x, i) => x + (flight!.to.eye[i] - x) * a),
          target: flight.from.target.map((x, i) => x + (flight!.to.target[i] - x) * a),
        };
        if (a >= 1) flight = undefined;
      }
      if (game) {
        gameAccum += dt;
        while (gameAccum >= DT) {
          stepGame(game, {
            ...keys,
            jump: keys.jump || pulses.jump,
            shoot: keys.shoot || pulses.shoot,
          });
          pulses.jump = false;
          pulses.shoot = false;
          gameAccum -= DT;
        }
        drawGame(playCanvas.getContext('2d')!, game);
      }
      if (playing || flight) render();
    }
    requestAnimationFrame(loop);
  }
  window.spatialProof = {
    at(frame) {
      playing = false;
      seek(frame / 30);
      return { time, active, ...scene.stats() };
    },
    select,
    play,
    state() {
      return {
        time,
        playing,
        explore,
        active,
        overview,
        game: game
          ? {
              x: game.x,
              y: game.y,
              variant: game.variant,
              shots: game.shots,
              kills: game.kills,
              jumps: game.jumps,
            }
          : null,
        ...scene.stats(),
      };
    },
  };
  resize();
  if (!capture) requestAnimationFrame(loop);
  window.addEventListener(
    'pagehide',
    (event) => {
      if (event.persisted) return;
      observer.disconnect();
      scene.dispose();
    },
    { once: true },
  );
}
void boot().catch((error) => {
  const box = $('#error');
  box.style.display = 'block';
  box.textContent = `The 3D view could not start: ${error instanceof Error ? error.message : String(error)}. `;
  const a = document.createElement('a');
  a.href = 'spatial-proof.mp4';
  a.textContent = 'Watch the rendered film';
  box.append(a);
  console.error(error);
});
declare global {
  interface Window {
    spatialProof: {
      at(frame: number): unknown;
      select(index: number): void;
      play(): void;
      state(): {
        time: number;
        playing: boolean;
        explore: boolean;
        active: number;
        overview: boolean;
        game: {
          x: number;
          y: number;
          variant: string;
          shots: number;
          kills: number;
          jumps: number;
        } | null;
        calls: number;
        triangles: number;
        textures: number;
        width: number;
        height: number;
      };
    };
  }
}
