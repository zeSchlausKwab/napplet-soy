import { createGame, drawGame, drawShotgun, Replay, WIDTH, HEIGHT } from './game';
import { beats, nodes, smooth } from './story';

const ink = '#15312b',
  cream = '#f6ecd2',
  coral = '#fa9b81',
  mint = '#9bdec3';
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const screenPosters = [4.1, 9.12, 15.9, 21.4];

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.font = 'bold 10px "DM Mono"';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
function buffer() {
  const c = document.createElement('canvas');
  c.width = WIDTH;
  c.height = HEIGHT;
  return c;
}

/** Four different story beats, using the same real game renderer and explicit time. */
export class StoryScreens {
  private original = new Replay('original');
  private shotgun = new Replay('shotgun');
  private before = buffer();
  private after = buffer();
  constructor() {
    // Identical world/character state makes the accepted change a genuine visual diff.
    const g = this.original.at(0.7);
    drawGame(this.before.getContext('2d')!, g);
    drawGame(this.after.getContext('2d')!, { ...g, variant: 'shotgun' });
  }
  draw(ctx: CanvasRenderingContext2D, index: number, time: number) {
    ctx.save();
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.imageSmoothingEnabled = false;
    if (index === 0) drawGame(ctx, this.original.at(time - nodes[0].start));
    else if (index === 1) this.delivery(ctx, time);
    else if (index === 2) this.merge(ctx, time);
    else drawGame(ctx, this.shotgun.at(time - nodes[3].start));
    ctx.restore();
  }
  private delivery(ctx: CanvasRenderingContext2D, time: number) {
    if (time >= beats.equipped) {
      drawGame(ctx, this.shotgun.at(time - beats.equipped));
      const glow = Math.max(0, 1 - (time - beats.equipped) / 0.45);
      if (glow > 0) {
        ctx.strokeStyle = cream;
        ctx.lineWidth = 2;
        ctx.globalAlpha = glow;
        ctx.beginPath();
        ctx.arc(77, 223, 17 + (1 - glow) * 38, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      return;
    }
    drawGame(ctx, createGame('original'));
    if (time < beats.deliveryStart) return;
    const p = smooth((time - beats.deliveryStart) / (beats.equipped - beats.deliveryStart));
    const x = mix(554, 77, p),
      y = mix(95, 224, p) - Math.sin(p * Math.PI) * 90;
    const scale = mix(4, 1, p),
      angle = mix(-0.45, 0, p);
    // A short dashed motion trail and pixel sparkles make this read as an arrival.
    ctx.strokeStyle = coral;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.moveTo(x + 40 * (1 - p), y - 8);
    ctx.quadraticCurveTo(x + 100 * (1 - p), y - 26, 536, 94);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 + p;
      ctx.fillStyle = i % 2 ? cream : coral;
      ctx.fillRect(x + Math.cos(a) * 42 * (1 - p), y + Math.sin(a) * 30 * (1 - p), 3, 3);
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.translate(-17, -17);
    drawShotgun(ctx);
    ctx.restore();
    label(ctx, '+ ONE SHOTGUN', 181, 57, ink);
  }
  private merge(ctx: CanvasRenderingContext2D, time: number) {
    const approach = smooth((time - beats.mergeStart) / 0.75);
    const apply = smooth(
      (time - (beats.mergeStart + 0.75)) / (beats.merged - beats.mergeStart - 0.75),
    );
    ctx.fillStyle = '#102b27';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const w = mix(224, WIDTH, approach),
      h = mix(126, HEIGHT, approach);
    const y = mix(62, 0, approach);
    const left = mix(20, 0, approach),
      right = mix(268, 0, approach);
    for (const [image, x, clipX, color] of [
      [this.before, left, 0, '#d4deae'],
      [this.after, right, WIDTH / 2, coral],
    ] as const) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(clipX, 0, WIDTH / 2, HEIGHT);
      ctx.clip();
      ctx.drawImage(image, x, y, w, h);
      ctx.globalAlpha = 1 - approach;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
    if (approach === 1) {
      const seam = (WIDTH / 2) * (1 - apply);
      ctx.save();
      ctx.beginPath();
      ctx.rect(seam, 0, WIDTH - seam, HEIGHT);
      ctx.clip();
      ctx.drawImage(this.after, 0, 0);
      ctx.restore();
      if (apply < 1) {
        ctx.fillStyle = mint;
        ctx.fillRect(Math.round(seam), 0, 2, HEIGHT);
      }
    }
    if (approach < 1) {
      ctx.globalAlpha = 1 - smooth(approach * 3);
      label(ctx, "MIKA'S ORIGINAL", 20, 43, '#d4deae');
      label(ctx, "JULES'S CHANGE", 268, 43, coral);
      ctx.lineWidth = 2;
      label(ctx, 'JUMP + DODGE', 20, 207, '#d4deae');
      label(ctx, '+ SHOTGUN', 268, 207, coral);
      // Two parents join one output. The game panels follow this same movement.
      for (const [x, color] of [
        [132, '#d4deae'],
        [380, coral],
      ] as const) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, 219);
        ctx.lineTo(x, 226);
        ctx.bezierCurveTo(x, 244, 256, 226, 256, 244);
        ctx.lineTo(256, 249);
        ctx.stroke();
      }
      ctx.fillStyle = mint;
      ctx.fillRect(252, 245, 8, 8);
      ctx.textAlign = 'center';
      label(ctx, 'BRING THE CHANGE INTO THE ORIGINAL', 256, 274, cream);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
    if (apply > 0.3) {
      ctx.globalAlpha = smooth((apply - 0.3) / 0.7);
      ctx.fillStyle = ink;
      ctx.fillRect(101, 52, 310, 46);
      ctx.textAlign = 'center';
      label(ctx, 'MERGED INTO MIKA’S GAME', 256, 71, mint);
      ctx.font = '9px "DM Mono"';
      ctx.fillStyle = cream;
      ctx.fillText('Original world. Jules’s new trick. Not published yet.', 256, 88);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
  }
}
