import { test, expect } from 'bun:test';
import { resolve } from 'node:path';

// Chromium could hang after a download when this followed the NIP-46 suite in
// the same Bun process. Keep the browser harness isolated from other SDK tests.
test('About SSR and browser key generation, backup, restore and cleanup', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, 'about-identity.browser.ts')],
    {
      cwd: resolve(import.meta.dir, '../..'),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const timer = setTimeout(() => child.kill(), 30000);
  try {
    const [status, output, errors] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(status, errors).toBe(0);
    expect(output).toContain('About and browser recovery checks passed.');
  } finally {
    clearTimeout(timer);
    child.kill();
    await child.exited;
  }
}, 45000);
