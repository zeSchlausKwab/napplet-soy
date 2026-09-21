import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spatialEffects } from './score';
import { DURATION } from './story';

test('the effects stem has no music bed and retains prominent replay-timed shots', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spatial-effects-'));
  try {
    const path = join(dir, 'effects.wav');
    await spatialEffects(path);
    const data = Buffer.from(await Bun.file(path).arrayBuffer());
    expect(data.subarray(0, 4).toString()).toBe('RIFF');
    expect(data.readUInt32LE(24)).toBe(48000);
    expect((data.length - 44) / 4 / 48000).toBe(DURATION);
    // The first second contains no game actions: any tonal bed here is a regression.
    expect(data.subarray(44, 44 + 48000 * 4).every((byte) => byte === 0)).toBe(true);
    let peak = 0;
    for (let i = 44 + Math.floor(10.73 * 48000) * 4; i < 44 + Math.floor(10.95 * 48000) * 4; i += 4)
      peak = Math.max(peak, Math.abs(data.readInt16LE(i)) / 32768);
    expect(peak).toBeGreaterThan(0.25);
    expect(peak).toBeLessThan(0.9);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
