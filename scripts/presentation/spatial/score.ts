import { Replay } from './game';
import { beats, DURATION, nodes } from './story';
/** Effects-only stem. Music is a separate input so it can be replaced or muted cleanly. */
export async function spatialEffects(path: string) {
  const seconds = DURATION,
    rate = 48000,
    count = seconds * rate;
  const bytes = Buffer.alloc(44 + count * 4);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 4, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(count * 4, 40);
  const shots: number[] = [];
  const jumps: number[] = [],
    coins: number[] = [],
    hits: number[] = [];
  for (const index of [0, 1, 3]) {
    const n = nodes[index];
    const start = index === 1 ? beats.equipped : n.start;
    const replay = new Replay(index === 0 ? 'original' : 'shotgun');
    let last = replay.at(0);
    const end = index === 0 ? 5.1 : index === 1 ? 12.6 : DURATION;
    for (let f = 0; start + f / 60 < end; f++) {
      const g = replay.at(f / 60);
      const at = start + f / 60;
      if (g.shots > last.shots) shots.push(at);
      if (g.jumps > last.jumps) jumps.push(at);
      if (g.gems > last.gems) coins.push(at);
      if (g.kills > last.kills) hits.push(at);
      last = g;
    }
  }
  let noise = 173;
  for (let i = 0; i < count; i++) {
    const t = i / rate,
      fade = Math.min(1, t * 2, (seconds - t) * 1.5);
    let sample = 0;
    noise = (Math.imul(noise, 1664525) + 1013904223) | 0;
    const grain = noise / 2147483648;
    for (const start of shots) {
      const a = t - start;
      if (a >= 0 && a < 0.24)
        sample +=
          (0.22 * grain + 0.28 * Math.sin(2 * Math.PI * (90 - 130 * a) * a)) * Math.exp(-a * 22);
    }
    for (const start of jumps) {
      const a = t - start;
      if (a >= 0 && a < 0.18)
        sample +=
          0.11 * Math.sin(2 * Math.PI * (300 * a + 1400 * a * a)) * Math.sin((Math.PI * a) / 0.18);
    }
    for (const start of coins) {
      const a = t - start;
      if (a >= 0 && a < 0.28)
        sample +=
          0.14 * Math.sin(2 * Math.PI * (a < 0.065 ? 1318.5 : 1760) * a) * Math.exp(-a * 12);
    }
    for (const start of hits) {
      const a = t - start;
      if (a >= 0 && a < 0.18)
        sample +=
          (0.07 * grain + 0.1 * Math.sin(2 * Math.PI * (260 * a - 520 * a * a))) *
          Math.exp(-a * 20);
    }
    for (const start of [
      5.3,
      beats.deliveryStart,
      13,
      beats.mergeStart,
      18.1,
      22.1,
      beats.flyToPlayer,
    ]) {
      const a = t - start;
      if (a >= 0 && a < 1) sample += grain * Math.sin(a * Math.PI) * 0.018;
    }
    for (const start of [beats.equipped, beats.merged, 21.6, beats.fillScreen]) {
      const a = t - start;
      if (a >= 0 && a < 1.5)
        sample +=
          (Math.sin(a * Math.PI * 880) +
            Math.sin(a * Math.PI * 1108.73) +
            Math.sin(a * Math.PI * 1318.51)) *
          0.045 *
          Math.min(1, a * 50) *
          Math.exp(-a * 3);
    }
    const v = Math.round(Math.max(-0.8, Math.min(0.8, sample * fade)) * 32767);
    bytes.writeInt16LE(v, 44 + i * 4);
    bytes.writeInt16LE(v, 46 + i * 4);
  }
  await Bun.write(path, bytes);
}
