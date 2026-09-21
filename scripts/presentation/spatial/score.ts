import { Replay } from './game';
import { beats, DURATION, nodes } from './story';
/** Original synthesized score and effects, with deterministic noise; no samples. */
export async function spatialScore(path: string) {
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
  for (const index of [1, 3]) {
    const n = nodes[index];
    const start = index === 1 ? beats.equipped : n.start;
    const replay = new Replay('shotgun');
    let last = 0;
    const end = index === 1 ? 12.6 : 22.1;
    for (let f = 0; start + f / 60 < end; f++) {
      const g = replay.at(f / 60);
      if (g.shots > last) shots.push(start + f / 60);
      last = g.shots;
    }
  }
  const notes = [220, 329.63, 440, 554.37, 493.88, 329.63, 293.66, 440];
  let noise = 173;
  for (let i = 0; i < count; i++) {
    const t = i / rate,
      fade = Math.min(1, t * 2, (seconds - t) * 1.5);
    const beat = Math.floor(t / 0.42),
      age = t % 0.42,
      pitch = notes[beat % notes.length];
    const pluck =
      (Math.sin(2 * Math.PI * pitch * t) + 0.12 * Math.sin(2 * Math.PI * pitch * 3 * t)) *
      Math.exp(-age * 12) *
      0.025;
    let sample = Math.sin(2 * Math.PI * 110 * t) * 0.012 + pluck;
    noise = (Math.imul(noise, 1664525) + 1013904223) | 0;
    const grain = noise / 2147483648;
    for (const start of shots) {
      const a = t - start;
      if (a >= 0 && a < 0.24)
        sample +=
          (0.045 * grain + 0.055 * Math.sin(2 * Math.PI * (90 - 130 * a) * a)) * Math.exp(-a * 25);
    }
    for (const start of [5.3, beats.deliveryStart, 13, beats.mergeStart, 18.1, 22.1]) {
      const a = t - start;
      if (a >= 0 && a < 1) sample += grain * Math.sin(a * Math.PI) * 0.008;
    }
    for (const start of [beats.equipped, beats.merged, 21.6]) {
      const a = t - start;
      if (a >= 0 && a < 1.5)
        sample +=
          (Math.sin(a * Math.PI * 880) +
            Math.sin(a * Math.PI * 1108.73) +
            Math.sin(a * Math.PI * 1318.51)) *
          0.019 *
          Math.min(1, a * 50) *
          Math.exp(-a * 3);
    }
    const v = Math.round(Math.max(-0.8, Math.min(0.8, sample * fade)) * 32767);
    bytes.writeInt16LE(v, 44 + i * 4);
    bytes.writeInt16LE(v, 46 + i * 4);
  }
  await Bun.write(path, bytes);
}
