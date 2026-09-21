/** Original, quiet synthesized cues. No sampled or licensed music dependencies. */
export async function writeScore(path: string) {
  const rate = 48000,
    seconds = 15,
    samples = rate * seconds;
  const bytes = Buffer.alloc(44 + samples * 4);
  bytes.write('RIFF', 0);
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
  bytes.writeUInt32LE(samples * 4, 40);
  const cues = [
    [0.3, 440, 0.16],
    [0.62, 554.37, 0.17],
    [1.2, 659.25, 0.15],
    [2.67, 880, 0.48],
    [3.65, 554.37, 0.22],
    [3.83, 659.25, 0.26],
    [5.06, 440, 0.22],
    [5.2, 659.25, 0.2],
    [7.67, 880, 0.48],
    [10.08, 329.63, 0.25],
    [11.17, 880, 0.48],
    [11.8, 440, 0.6],
    [11.91, 554.37, 0.6],
    [12.04, 659.25, 0.65],
    [13.27, 880, 0.9],
  ];
  for (let n = 0; n < samples; n++) {
    const t = n / rate,
      fade = Math.min(1, t * 2, (seconds - t) * 1.3);
    const bed =
      (Math.sin(t * Math.PI * 2 * 110) * 0.018 +
        Math.sin(t * Math.PI * 2 * 164.81) * 0.012 +
        Math.sin(t * Math.PI * 2 * 220.1) * 0.009) *
      (0.6 + 0.4 * Math.sin(t * 0.5) ** 2);
    for (let channel = 0; channel < 2; channel++) {
      let v = bed;
      cues.forEach(([start, pitch, duration], i) => {
        const age = t - start - channel * 0.003;
        if (age < 0 || age > duration * 4) return;
        const envelope = Math.min(1, age / 0.008) * Math.exp(-age / (duration * 0.4));
        v +=
          (Math.sin(age * Math.PI * 2 * pitch) +
            0.22 * Math.sin(age * Math.PI * 2 * pitch * 2.003)) *
          envelope *
          0.075 *
          (channel === i % 2 ? 1 : 0.7);
      });
      bytes.writeInt16LE(
        Math.round(Math.max(-0.8, Math.min(0.8, v * fade)) * 32767),
        44 + n * 4 + channel * 2,
      );
    }
  }
  await Bun.write(path, bytes);
}
