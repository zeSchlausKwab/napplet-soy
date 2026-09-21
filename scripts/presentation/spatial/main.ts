import { SpatialScene } from './scene';
import {
  beats,
  cameraAt,
  chapterAt,
  DURATION,
  FPS,
  focusPose,
  isOverviewAt,
  nodes,
  outroAt,
  overviewPose,
  smooth,
} from './story';
import { createGame, drawGame, stepGame, DT, type Game, type Input } from './game';
const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const capture = new URLSearchParams(location.search).has('capture');
const landing = new URLSearchParams(location.search).has('landing');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

async function boot() {
  await Promise.all([
    document.fonts.load('600 32px "DM Sans"'),
    document.fonts.load('400 32px "DM Sans"'),
    document.fonts.load('400 24px "DM Mono"'),
    document.fonts.load('600 32px "Fredoka"'),
  ]);
  const scene = new SpatialScene($<HTMLCanvasElement>('#scene'));
  let time = capture || landing ? 0 : DURATION,
    playing = landing && !reduced,
    explore = !capture && !landing,
    active = 0,
    overview = !capture && !landing,
    suspended = landing;
  let pose = capture || landing ? cameraAt(0) : overviewPose,
    flight: { from: typeof pose; to: typeof pose; at: number } | undefined;
  let last = performance.now(),
    game: Game | undefined,
    gameAccum = 0;
  const keys: Input = {};
  const pulses: Input = {};
  const audio = new Audio();
  audio.preload = 'none';
  audio.muted = true;
  let audioError = '';
  function syncAudio() {
    if (audio.muted || !playing || suspended || document.hidden || explore || game) {
      audio.pause();
      return;
    }
    if (Math.abs(audio.currentTime - time) > 0.15) audio.currentTime = time;
    if (audio.paused)
      void audio.play().catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        audio.muted = true;
        audioError = 'Sound could not start. Tap Sound off to retry.';
        labels();
      });
  }
  audio.addEventListener('error', () => {
    audio.muted = true;
    audioError = 'Sound could not load. Tap Sound off to retry.';
    labels();
  });
  audio.addEventListener('ended', () => {
    playing = false;
    seek(DURATION);
  });
  const dialog = $<HTMLDialogElement>('#game-dialog'),
    playCanvas = $<HTMLCanvasElement>('#play-canvas');
  const captions = [
    'Every little world starts somewhere.',
    'A player has a beautifully bad idea.',
    'The creator tries it. Then accepts it.',
    'Same roots. A different kind of game.',
  ];
  function labels() {
    document.documentElement.classList.toggle('exploring', explore);
    const outro = explore ? 0 : outroAt(time);
    $('#world').style.setProperty('--story-chrome', String(1 - smooth(outro * 1.5)));
    $('header').inert = outro > 0.6;
    const invitation = $('#enter-game');
    invitation.hidden = explore || time < beats.pressStart;
    invitation.style.opacity = String(smooth((time - beats.pressStart) / 0.3));
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
    $('#timeline').style.setProperty('--progress', `${(time / DURATION) * 100}%`);
    $('#timeline').setAttribute('aria-valuetext', `${time.toFixed(1)} seconds of ${DURATION}`);
    $('#time').textContent = `00:${String(Math.floor(time)).padStart(2, '0')} / 00:${DURATION}`;
    $('#sound').textContent = audio.muted ? 'Sound off' : 'Sound on';
    $('#sound').setAttribute('aria-pressed', String(!audio.muted));
    $('#audio-status').textContent = audioError;
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
    overview = isOverviewAt(time);
    explore = false;
    flight = undefined;
    pose = cameraAt(time);
    if (audio.src) audio.currentTime = time;
    syncAudio();
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
    syncAudio();
    explore = true;
    overview = false;
    time = nodes[index].start + 2.8;
    fly(focusPose(index));
    render();
  }
  function showOverview() {
    playing = false;
    syncAudio();
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
      last = performance.now();
    }
    syncAudio();
    labels();
  };
  $('#sound').onclick = () => {
    audioError = '';
    if (audio.muted) {
      if (!audio.src || audio.error) audio.src = 'story-audio.m4a';
      audio.muted = false;
      audio.currentTime = time;
    } else audio.muted = true;
    syncAudio();
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
    if (!explore && time >= beats.fillScreen) return play();
    const found = scene.pick(event.clientX, event.clientY);
    if (found !== undefined) select(found);
  };
  function clearKeys() {
    for (const k of Object.keys(keys) as (keyof Input)[]) keys[k] = false;
    for (const k of Object.keys(pulses) as (keyof Input)[]) pulses[k] = false;
  }
  function play() {
    playing = false;
    syncAudio();
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
  $('#enter-game').onclick = play;
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
      if (!landing) playing = false;
      clearKeys();
      labels();
    }
    syncAudio();
  });
  const observer = new ResizeObserver(resize);
  observer.observe($('#world'));
  function loop(now: number) {
    const dt = Math.min((now - last) / 1000, 0.06);
    last = now;
    if (!document.hidden && !suspended) {
      const advancing = playing || !!flight;
      if (playing) {
        // Audible playback follows the media clock, so dropped 3D frames don't drift.
        time = Math.min(
          DURATION,
          !audio.muted && !audio.paused && !audio.seeking && audio.readyState >= 2
            ? audio.currentTime
            : time + dt,
        );
        pose = cameraAt(time);
        active = chapterAt(time);
        overview = isOverviewAt(time);
        if (time >= DURATION) {
          playing = false;
          audio.pause();
        }
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
      if (advancing) render();
    }
    requestAnimationFrame(loop);
  }
  window.spatialProof = {
    at(frame) {
      playing = false;
      seek(frame / FPS);
      return { time, active, ...scene.stats() };
    },
    select,
    play,
    setVisible(visible) {
      suspended = !visible;
      last = performance.now();
      if (suspended) clearKeys();
      syncAudio();
    },
    state() {
      return {
        time,
        playing,
        explore,
        active,
        overview,
        suspended,
        muted: audio.muted,
        audioTime: audio.currentTime,
        audioPlaying: !audio.paused,
        audioError,
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
  if (new URLSearchParams(location.search).get('play') === 'release') {
    select(3);
    play();
  }
  if (!capture) requestAnimationFrame(loop);
  window.dispatchEvent(new Event('spatial-ready'));
  window.addEventListener(
    'pagehide',
    (event) => {
      if (event.persisted) return;
      observer.disconnect();
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
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
      setVisible(visible: boolean): void;
      state(): {
        time: number;
        playing: boolean;
        explore: boolean;
        active: number;
        overview: boolean;
        suspended: boolean;
        muted: boolean;
        audioTime: number;
        audioPlaying: boolean;
        audioError: string;
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
