/** A small, real 2D platformer. Rendering never mutates the fixed-step simulation. */
export type Variant = 'original' | 'shotgun';
export type Input = { left?: boolean; right?: boolean; jump?: boolean; shoot?: boolean };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string };
type Bullet = { x: number; y: number; vx: number; vy: number; life: number };
export const WIDTH = 512,
  HEIGHT = 288,
  DT = 1 / 60;
export const gaps = [
  [390, 437],
  [780, 830],
  [1190, 1240],
];
export const platforms = [
  { x: 225, y: 180, w: 68 },
  { x: 580, y: 174, w: 64 },
  { x: 960, y: 175, w: 85 },
];
export type Game = ReturnType<typeof createGame>;
export function createGame(variant: Variant) {
  return {
    variant,
    tick: 0,
    x: 60,
    y: 207,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: true,
    cooldown: 0,
    flash: 0,
    hurt: 0,
    won: false,
    shots: 0,
    kills: 0,
    jumps: 0,
    deaths: 0,
    lastJump: false,
    gems: 0,
    enemies: [310, 535, 700, 930, 1105, 1410].map((x, i) => ({
      x,
      start: x,
      y: 215,
      alive: true,
      i,
    })),
    coins: [160, 255, 490, 610, 690, 890, 995, 1120, 1310, 1470].map((x, i) => ({
      x,
      y: i === 1 || i === 3 || i === 6 ? 152 : 206,
      taken: false,
    })),
    particles: [] as Particle[],
    bullets: [] as Bullet[],
  };
}
function burst(g: Game, x: number, y: number, colors: string[], count: number) {
  for (let i = 0; i < count; i++) {
    const angle = i * 2.399 + g.tick * 0.31,
      speed = 24 + ((i * 37 + g.tick) % 85);
    g.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: -20 + Math.sin(angle) * speed,
      life: 0.4 + (i % 5) * 0.12,
      color: colors[i % colors.length],
    });
  }
}
export function demoInput(g: Game): Input {
  const obstacle = g.enemies.some((e) => e.alive && e.x > g.x && e.x - g.x < 58);
  const edge = gaps.some(([a]) => a - g.x < 29 && a > g.x - 8);
  return {
    right: true,
    jump: g.grounded && (edge || (g.variant === 'original' && obstacle)),
    shoot:
      g.variant === 'shotgun' &&
      g.enemies.some(
        (e) => e.alive && e.x > g.x && e.x - g.x < 158 && Math.abs(e.y - (g.y + 13)) < 24,
      ),
  };
}
export function stepGame(g: Game, input: Input) {
  g.tick++;
  g.cooldown = Math.max(0, g.cooldown - DT);
  g.flash = Math.max(0, g.flash - DT);
  g.hurt = Math.max(0, g.hurt - DT);
  if (!g.won) {
    const direction = Number(!!input.right) - Number(!!input.left);
    g.vx += (direction * 107 - g.vx) * 0.22;
    if (direction) g.facing = direction;
    if (input.jump && !g.lastJump && g.grounded) {
      g.vy = -302;
      g.grounded = false;
      g.jumps++;
    }
    if (input.shoot && g.variant === 'shotgun' && g.cooldown === 0) {
      g.cooldown = 0.72;
      g.flash = 0.14;
      g.shots++;
      g.vx -= g.facing * 64;
      for (let i = -2; i <= 2; i++)
        g.bullets.push({
          x: g.x + 30 * g.facing,
          y: g.y + 13,
          vx: g.facing * 405,
          vy: i * 18,
          life: 0.48,
        });
      burst(g, g.x + 29 * g.facing, g.y + 13, ['#fff3af', '#ffb363', '#f47b68'], 6);
    }
    const previousFeet = g.y + 25;
    g.vy += 770 * DT;
    g.x = Math.max(16, Math.min(1545, g.x + g.vx * DT));
    g.y += g.vy * DT;
    g.grounded = false;
    const surfaces = [{ x: -100, y: 232, w: 1850 }, ...platforms];
    for (const p of surfaces) {
      if (p.y === 232 && gaps.some(([a, b]) => g.x > a + 3 && g.x < b - 3)) continue;
      if (
        g.x + 9 > p.x &&
        g.x - 9 < p.x + p.w &&
        g.vy >= 0 &&
        previousFeet <= p.y + 1 &&
        g.y + 25 >= p.y
      ) {
        g.y = p.y - 25;
        g.vy = 0;
        g.grounded = true;
      }
    }
    if (g.y > 335) {
      g.x = 60;
      g.y = 120;
      g.vy = 0;
      g.deaths++;
    }
    if (g.x > 1510) {
      g.won = true;
      burst(g, g.x, g.y, ['#fff4c8', '#ff9976', '#94d9ad'], 32);
    }
  }
  g.lastJump = !!input.jump;
  for (const e of g.enemies) {
    e.x = e.start + Math.sin((g.tick / 60) * 1.2 + e.i) * 15;
    if (e.alive && Math.abs(g.x - e.x) < 17 && g.y + 23 > e.y && g.y < e.y + 15 && !g.hurt) {
      g.hurt = 1.2;
      g.vx = -g.facing * 120;
      g.vy = -150;
      burst(g, g.x, g.y + 10, ['#f5eee0', '#eaa19d'], 8);
    }
  }
  for (const b of g.bullets) {
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    b.life -= DT;
    for (const e of g.enemies)
      if (e.alive && Math.abs(b.x - e.x) < 15 && b.y > e.y - 4 && b.y < e.y + 20) {
        e.alive = false;
        g.kills++;
        b.life = 0;
        burst(g, e.x, e.y, ['#e593b5', '#8466a2', '#ffcc87', '#faf1bd'], 22);
      }
  }
  for (const coin of g.coins)
    if (!coin.taken && Math.abs(coin.x - g.x) < 17 && Math.abs(coin.y - (g.y + 12)) < 23) {
      coin.taken = true;
      g.gems++;
      burst(g, coin.x, coin.y, ['#fff4b3', '#efb75d'], 8);
    }
  for (const p of g.particles) {
    p.x += p.vx * DT;
    p.y += p.vy * DT;
    p.vy += 175 * DT;
    p.life -= DT;
  }
  g.particles = g.particles.filter((p) => p.life > 0);
  g.bullets = g.bullets.filter((b) => b.life > 0);
}

/** Cache immutable checkpoints, so arbitrary seeks and out-of-order renders agree. */
export class Replay {
  private states: Game[];
  constructor(readonly variant: Variant) {
    this.states = [createGame(variant)];
  }
  at(seconds: number): Game {
    const tick = Math.floor(Math.max(0, Math.min(18, seconds)) * 60);
    const checkpoint = Math.floor(tick / 60);
    while (this.states.length <= checkpoint) {
      const g = structuredClone(this.states.at(-1)!);
      for (let i = 0; i < 60; i++) stepGame(g, demoInput(g));
      this.states.push(g);
    }
    const g = structuredClone(this.states[checkpoint]);
    while (g.tick < tick) stepGame(g, demoInput(g));
    return g;
  }
}

/** The presentation's flying pickup uses the exact same sprite as the playable gun. */
export function drawShotgun(ctx: CanvasRenderingContext2D, kick = 0) {
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x + kick, y, w, h);
  };
  rect(4, 16, 9, 6, '#694b37');
  rect(10, 14, 20, 5, '#3b3e3c');
  rect(19, 16, 7, 4, '#a57243');
  rect(14, 13, 15, 2, '#656962');
  rect(12, 19, 3, 3, '#3b3e3c');
}

export function drawGame(ctx: CanvasRenderingContext2D, g: Game) {
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h));
  };
  ctx.imageSmoothingEnabled = false;
  const camera = Math.max(0, Math.min(1080, g.x - 155)),
    time = g.tick / 60;
  rect(0, 0, WIDTH, HEIGHT, '#b9c4b9');
  rect(0, 72, WIDTH, 90, '#d2cdb5');
  rect(0, 151, WIDTH, 100, '#e4d4ae');
  // A deliberately low-resolution palette and silhouettes; no 3D in the game.
  rect(363 - camera * 0.045, 32, 38, 38, '#fbe7b8');
  rect(356 - camera * 0.045, 39, 52, 24, '#fbe7b8');
  for (let i = 0; i < 9; i++) {
    const x = ((((i * 93 - camera * 0.13) % 700) + 700) % 700) - 60,
      y = 29 + (i % 3) * 24;
    rect(x, y + 7, 42, 7, '#ece2c7');
    rect(x + 8, y, 24, 15, '#ece2c7');
  }
  for (let i = 0; i < 18; i++) {
    const x = i * 59 - camera * 0.26 - 60,
      h = 54 + ((i * 19) % 70);
    rect(x, 222 - h, 39, h, '#a7b29d');
    rect(x + 6, 215 - h, 27, 10, '#a7b29d');
    rect(x + 10, 239 - h, 6, 17, '#bdc3a7');
    rect(x + 25, 239 - h, 6, 17, '#bdc3a7');
  }
  for (let i = 0; i < 19; i++) {
    const x = i * 72 - camera * 0.5 - 30,
      h = 30 + (i % 5) * 9;
    rect(x + 16, 223 - h, 7, h, '#6c9380');
    rect(x, 221 - h, 39, 19, '#8ca68a');
    rect(x + 7, 211 - h, 29, 17, '#8ca68a');
    rect(x + 5, 212 - h, 12, 4, '#afbc92');
  }
  ctx.save();
  ctx.translate(-Math.round(camera), 0);
  for (let x = 0; x < 1664; x += 16) {
    if (gaps.some(([a, b]) => x >= a && x < b)) continue;
    rect(x, 234, 16, 54, '#446c60');
    rect(x, 232, 16, 6, '#779b76');
    rect(x, 230, 16, 3, '#c4cd93');
    rect(x + 2, 242, 12, 12, (x / 16) % 3 ? '#50796a' : '#5e8370');
    rect(x + 5, 261, 8, 5, '#375b55');
    rect(x + 1, 281, 13, 3, '#63806a');
    if (x % 48 === 0) {
      rect(x + 5, 221, 2, 10, '#5d8c64');
      rect(x + 2, 218, 7, 5, '#e8b38a');
    }
  }
  for (const p of platforms) {
    rect(p.x, p.y, p.w, 13, '#ad8a70');
    rect(p.x, p.y, p.w, 4, '#f0d7a3');
    for (let x = p.x; x < p.x + p.w; x += 16) {
      rect(x + 3, p.y + 6, 10, 4, '#806c60');
      rect(x + 1, p.y + 13, 3, 8, '#829874');
    }
  }
  for (const c of g.coins)
    if (!c.taken) {
      const y = c.y + Math.round(Math.sin(time * 3 + c.x) * 3),
        w = Math.abs(Math.cos(time * 3 + c.x)) * 5 + 2;
      rect(c.x - w / 2 - 1, y - 6, w + 2, 11, '#aa874e');
      rect(c.x - w / 2, y - 7, w, 11, '#fae6a3');
      rect(c.x - 1, y - 5, 2, 6, '#e6b76a');
    }
  for (const e of g.enemies)
    if (e.alive) {
      const x = e.x - 12,
        y = e.y + Math.round(Math.sin(time * 5 + e.i) * 1.5);
      rect(x + 2, y + 3, 22, 12, '#654466');
      rect(x + 4, y, 17, 14, '#aa7392');
      rect(x + 5, y - 3, 4, 5, '#d495a0');
      rect(x + 18, y - 3, 4, 5, '#d495a0');
      rect(x + 6, y + 4, 5, 5, '#f8e4bc');
      rect(x + 15, y + 4, 5, 5, '#f8e4bc');
      rect(x + 6, y + 6, 2, 3, '#42343f');
      rect(x + 15, y + 6, 2, 3, '#42343f');
      rect(x + 9, y + 11, 7, 2, '#653d57');
      rect(x + 1, y + 14, 8, 3, '#644660');
      rect(x + 17, y + 14, 8, 3, '#644660');
    }
  const x = Math.round(g.x),
    y = Math.round(g.y),
    stride = g.grounded && Math.abs(g.vx) > 10 ? Math.round(Math.sin(time * 16) * 2) : 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(g.facing, 1);
  if (g.hurt && g.tick % 8 < 3) ctx.globalAlpha = 0.5;
  rect(-11, 2, 24, 21, '#4c4137');
  rect(-8, 0, 19, 24, '#4c4137');
  rect(-9, 3, 20, 18, '#f7e4b7');
  rect(-7, 1, 16, 22, '#fff0c9');
  rect(9, 4, 3, 17, '#dcb783');
  rect(-5, 4, 3, 2, '#e8cca0');
  rect(5, 6, 2, 2, '#e8cca0');
  rect(-8, 15, 4, 3, '#efa79d');
  rect(5, 15, 4, 3, '#efa79d');
  rect(-5, 10, 3, 4, '#423831');
  rect(4, 10, 3, 4, '#423831');
  rect(-1, 16, 5, 2, '#755845');
  rect(0, 18, 3, 1, '#755845');
  rect(-8, 23 + stride, 7, 3, '#4c4137');
  rect(3, 23 - stride, 8, 3, '#4c4137');
  rect(-7, 23 + stride, 5, 2, '#f7e4b7');
  rect(4, 23 - stride, 6, 2, '#f7e4b7');
  if (g.variant === 'shotgun') {
    const kick = g.flash > 0 ? -2 : 0;
    drawShotgun(ctx, kick);
    rect(6, 18, 5, 3, '#f6d8a5');
    if (g.flash > 0) {
      rect(31, 11, 5, 10, '#fff5c8');
      rect(35, 8, 5, 16, '#ffc473');
      rect(40, 12, 8, 7, '#fff5c8');
    }
  } else {
    rect(-12, 14 - stride, 4, 6, '#e3c393');
    rect(10, 14 + stride, 4, 6, '#f7e4b7');
  }
  ctx.restore();
  for (const b of g.bullets) rect(b.x, b.y, 5, 2, '#fff7d0');
  for (const p of g.particles) {
    ctx.globalAlpha = Math.min(1, p.life * 3);
    rect(p.x, p.y, 3, 3, p.color);
  }
  ctx.globalAlpha = 1;
  rect(1532, 162, 3, 70, '#f8e6bc');
  rect(1535, 162, 27, 16, '#ec907a');
  rect(1538, 165, 4, 4, '#f8e6bc');
  ctx.restore();
  // Deliberately spare in-game HUD; presentation labels live in the surrounding node.
  rect(12, 12, 142, 23, '#355b54');
  ctx.fillStyle = '#faf0d1';
  ctx.font = 'bold 9px monospace';
  ctx.fillText('SOYBERT / LITTLE WORLD', 20, 27);
  rect(420, 12, 80, 23, '#355b54');
  ctx.fillStyle = '#faf0d1';
  ctx.fillText(
    `✦ ${String(g.gems).padStart(2, '0')}  ${g.variant === 'shotgun' ? 'BOOM' : 'JUMP'}`,
    430,
    27,
  );
  if (g.won) {
    rect(155, 86, 208, 65, '#24463c');
    ctx.fillStyle = '#faf0d1';
    ctx.font = 'bold 17px monospace';
    ctx.fillText('NICE LITTLE RUN.', 176, 116);
    ctx.font = '9px monospace';
    ctx.fillText('R TO GO AGAIN', 222, 137);
  }
}
