/** Local, playable recording prototype. No relay traffic, identity or fabricated live metrics. */
export type Variant = 'original' | 'portals';
type Point = { x: number; y: number };
const anchors = [
  [98, 402],
  [155, 300],
  [278, 220],
  [421, 246],
  [461, 378],
  [560, 447],
  [704, 403],
  [743, 277],
  [858, 197],
  [956, 245],
];
export const route: Point[] = [];
for (let i = 0; i < anchors.length - 1; i++) {
  const a = anchors[Math.max(0, i - 1)],
    b = anchors[i],
    c = anchors[i + 1],
    d = anchors[Math.min(anchors.length - 1, i + 2)];
  for (let j = 0; j < 28; j++) {
    const t = j / 28;
    const axis = (k: number) =>
      0.5 *
      (2 * b[k] +
        (-a[k] + c[k]) * t +
        (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t * t +
        (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t * t * t);
    route.push({ x: axis(0), y: axis(1) });
  }
}
export type State = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  time: number;
  progress: number;
  teleports: number;
  flash: number;
  gems: Set<number>;
  won: boolean;
  trail: Point[];
};
export const fresh = (): State => ({
  ...route[0],
  vx: 0,
  vy: 0,
  time: 0,
  progress: 0,
  teleports: 0,
  flash: 0,
  gems: new Set(),
  won: false,
  trail: [],
});
export const entry = 83,
  exit = 170;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function step(state: State, variant: Variant, input: Point, auto: boolean, dt = 1 / 60) {
  state.time += dt;
  state.flash = Math.max(0, state.flash - dt * 2);
  if (state.won) return;
  let near = 0,
    nearest = Infinity;
  route.forEach((p, i) => {
    const d = distance(p, state);
    if (d < nearest) {
      nearest = d;
      near = i;
    }
  });
  state.progress = Math.max(state.progress, near);
  if (auto) {
    const target = route[Math.min(route.length - 1, near + 9)];
    const len = Math.max(1, distance(target, state));
    const speed = 148;
    state.vx += (((target.x - state.x) / len) * speed - state.vx) * Math.min(1, dt * 7);
    state.vy += (((target.y - state.y) / len) * speed - state.vy) * Math.min(1, dt * 7);
  } else {
    state.vx = (state.vx + input.x * dt * 460) * Math.exp(-dt * 1.6);
    state.vy = (state.vy + input.y * dt * 460) * Math.exp(-dt * 1.6);
    if (nearest > 43) {
      state.vx += (route[near].x - state.x) * dt * 25;
      state.vy += (route[near].y - state.y) * dt * 25;
    }
  }
  state.x += state.vx * dt;
  state.y += state.vy * dt;
  if (variant === 'portals' && !state.teleports && distance(state, route[entry]) < 27) {
    state.x = route[exit].x;
    state.y = route[exit].y;
    // Keep the velocity vector and speed: this is an actual portal, not an edit cut.
    state.teleports++;
    state.progress = exit;
    state.flash = 1;
    state.trail = [];
  }
  for (const gem of [24, 55, 111, 145, 195, 225])
    if (distance(state, route[gem]) < 31) state.gems.add(gem);
  state.trail.push({ x: state.x, y: state.y });
  if (state.trail.length > 26) state.trail.shift();
  if (distance(state, route.at(-1)!) < 22) state.won = true;
}

function line(ctx: CanvasRenderingContext2D, offset = 0) {
  ctx.beginPath();
  route.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y + offset) : ctx.moveTo(p.x, p.y + offset)));
}
function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}
export function draw(ctx: CanvasRenderingContext2D, state: State, variant: Variant) {
  const w = 1024,
    h = 640;
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#0b1a1c');
  bg.addColorStop(1, '#182e2a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const x = (i * 137.29) % w,
      y = (i * 73.71) % h;
    circle(
      ctx,
      x,
      y,
      i % 6 === 0 ? 1.5 : 0.6,
      `rgba(222,231,207,${0.12 + 0.13 * Math.sin(state.time * 0.5 + i) ** 2})`,
    );
  }
  ctx.save();
  ctx.strokeStyle = '#52675a';
  ctx.globalAlpha = 0.2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(840, 470, 205, 100, -0.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(840, 470, 125, 210, -0.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  circle(ctx, 825, 497, 52, '#21352d');
  circle(ctx, 816, 484, 44, '#2a3f31');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.save();
  ctx.shadowBlur = 30;
  ctx.shadowColor = '#000b';
  ctx.shadowOffsetY = 22;
  line(ctx, 18);
  ctx.strokeStyle = '#071513';
  ctx.lineWidth = 99;
  ctx.stroke();
  ctx.restore();
  line(ctx, 10);
  ctx.strokeStyle = '#526651';
  ctx.lineWidth = 94;
  ctx.stroke();
  line(ctx);
  ctx.strokeStyle = '#d0dca7';
  ctx.lineWidth = 95;
  ctx.stroke();
  line(ctx);
  ctx.strokeStyle = '#385346';
  ctx.lineWidth = 89;
  ctx.stroke();
  line(ctx);
  ctx.strokeStyle = '#1c3430';
  ctx.lineWidth = 79;
  ctx.stroke();
  ctx.save();
  ctx.setLineDash([3, 16]);
  line(ctx);
  ctx.strokeStyle = '#82987355';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  for (const i of [24, 55, 111, 145, 195, 225])
    if (!state.gems.has(i)) {
      const p = route[i];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.PI / 4 + Math.sin(state.time + i) * 0.12);
      ctx.shadowColor = '#e0e69b';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#e0e69b';
      ctx.fillRect(-5, -5, 10, 10);
      ctx.restore();
    }
  const finish = route.at(-1)!;
  ctx.save();
  ctx.translate(finish.x, finish.y);
  ctx.rotate(0.5);
  for (let x = 0; x < 4; x++)
    for (let y = 0; y < 4; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#243e31' : '#dce3b9';
      ctx.fillRect(x * 9 - 18, y * 9 - 18, 9, 9);
    }
  ctx.restore();
  if (variant === 'portals')
    for (const [index, color, label] of [
      [entry, '#fb8a70', 'IN'],
      [exit, '#93e4cf', 'OUT'],
    ] as const) {
      const p = route[index];
      ctx.save();
      ctx.translate(p.x, p.y - 7);
      ctx.shadowBlur = 28;
      ctx.shadowColor = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(0, 0, 27, 45, -0.24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = color + '20';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = color + '70';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, 34, 52, -0.24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.fillText(label, 0, -63);
      ctx.restore();
    }
  state.trail.forEach((p, i) =>
    circle(ctx, p.x, p.y, 2 + i * 0.15, `rgba(250,132,99,${(i / state.trail.length) * 0.35})`),
  );
  circle(ctx, state.x + 5, state.y + 8, 15, '#0006');
  const ball = ctx.createRadialGradient(state.x - 5, state.y - 7, 1, state.x, state.y, 17);
  ball.addColorStop(0, '#fff7d3');
  ball.addColorStop(0.28, '#ffc997');
  ball.addColorStop(0.65, '#f98062');
  ball.addColorStop(1, '#b0433e');
  ctx.save();
  ctx.shadowColor = '#ffae7880';
  ctx.shadowBlur = 22;
  circle(ctx, state.x, state.y, 15, ball as unknown as string);
  ctx.restore();
  if (state.flash > 0) {
    ctx.save();
    ctx.globalAlpha = state.flash * 0.65;
    ctx.strokeStyle = '#b8ffe4';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(state.x, state.y, 25 + (1 - state.flash) * 70, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = '#edf0d9';
  ctx.textAlign = 'left';
  ctx.font = '600 24px sans-serif';
  ctx.fillText('ORBIT RUN', 38, 47);
  ctx.font = '12px monospace';
  ctx.fillStyle = '#a5bca9';
  ctx.fillText('SMALL WORLD. BIG MOMENTUM.', 38, 70);
  ctx.fillStyle = '#b7c9a4';
  ctx.font = '12px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(variant === 'portals' ? 'PORTAL EDITION' : 'THE ORIGINAL', 985, 43);
  ctx.fillStyle = '#f8ecda';
  ctx.font = '28px monospace';
  ctx.fillText(state.won ? 'NICE RUN.' : state.time.toFixed(2).padStart(5, '0'), 985, 78);
  ctx.textAlign = 'left';
  ctx.font = '12px monospace';
  ctx.fillStyle = '#96aa95';
  ctx.fillText('ARROWS / WASD TO ROLL', 38, 603);
  ctx.textAlign = 'right';
  ctx.fillStyle = state.teleports ? '#a3ebd0' : '#b7c9a4';
  ctx.fillText(
    state.teleports ? 'SAME MOMENTUM. NEW POSSIBILITIES.' : `${state.gems.size} / 6 STARDUST`,
    985,
    603,
  );
}

declare global {
  interface Window {
    orbitCapture: { at(frame: number): { teleports: number; won: boolean }; state: () => State };
  }
}
if (typeof document !== 'undefined') {
  const canvas = document.querySelector('canvas')!;
  if (canvas) {
    const ctx = canvas.getContext('2d')!;
    const params = new URLSearchParams(location.search);
    let variant: Variant = params.get('variant') === 'original' ? 'original' : 'portals';
    let state = fresh(),
      last = 0,
      auto = params.has('auto');
    const keys = new Set<string>();
    const reset = () => {
      state = fresh();
      last = 0;
    };
    document.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key))
        e.preventDefault();
      keys.add(e.key.toLowerCase());
      if (e.key.toLowerCase() === 'r') reset();
    });
    document.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => keys.clear());
    document.querySelector('#restart')?.addEventListener('click', reset);
    document.querySelector('#auto')?.addEventListener('click', () => {
      auto = !auto;
      reset();
    });
    document.querySelector('#variant')?.addEventListener('click', () => {
      variant = variant === 'original' ? 'portals' : 'original';
      reset();
    });
    let recorded = -1;
    window.orbitCapture = {
      at(frame) {
        if (frame < recorded) {
          reset();
          recorded = -1;
        }
        while (recorded < frame) {
          step(state, variant, { x: 0, y: 0 }, true, 1 / 30);
          recorded++;
        }
        draw(ctx, state, variant);
        return { teleports: state.teleports, won: state.won };
      },
      state: () => state,
    };
    const tick = (now: number) => {
      if (!params.has('capture')) {
        const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
        last = now;
        step(
          state,
          variant,
          {
            x:
              Number(keys.has('arrowright') || keys.has('d')) -
              Number(keys.has('arrowleft') || keys.has('a')),
            y:
              Number(keys.has('arrowdown') || keys.has('s')) -
              Number(keys.has('arrowup') || keys.has('w')),
          },
          auto,
          dt,
        );
        draw(ctx, state, variant);
      }
      requestAnimationFrame(tick);
    };
    draw(ctx, state, variant);
    requestAnimationFrame(tick);
  }
}
