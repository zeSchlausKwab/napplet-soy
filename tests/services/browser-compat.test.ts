import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test.skipIf(process.platform !== 'darwin' || process.env.SPACE_TEST_MAC_BROWSER_COMPAT !== '1')(
  'Mac compatibility driver downloads into a fresh cache, checks, captures, records and opens a window',
  async () => {
    const cache = await mkdtemp(join(tmpdir(), 'soyli-browser-compat-'));
    const child = Bun.spawn(
      [
        process.execPath,
        '--no-env-file',
        '-e',
        `
      import { mock, expect } from 'bun:test';
      import * as os from 'node:os';
      // Exercise the compatibility branch on current Macs as well. This is not
      // proof of execution on physical Monterey hardware.
      mock.module('node:os', () => ({ ...os, release: () => '22.6.0' }));
      const { installBrowser, browserInstalled, browserEngine } = await import('./apps/cli/src/browser.ts');
      const { doctor } = await import('./apps/cli/src/local.ts');
      const { checkPublication } = await import('./apps/cli/src/publish-check.ts');
      expect(await browserInstalled(true, true)).toBe(false);
      await installBrowser(undefined, true, true);
      expect(await browserInstalled(true, true)).toBe(true);
      expect(await browserInstalled()).toBe(true);
      expect((await doctor()).browser).toStartWith('ready; macOS compatibility');
      const encode = (value) => new TextEncoder().encode(value);
      const contents = new Map([
        ['napplet.json', encode(JSON.stringify({ schema: 'space-local-project/v1', name: 'Compatibility', license: 'MIT', preview: { delayMs: 250 }, previewId: crypto.randomUUID(), entry: 'index.html', requires: [], relays: [], servers: [] }))],
        ['index.html', encode('<!doctype html><style>body{background:#f60}</style><button onclick="this.textContent=123">Play</button>')],
      ]);
      const result = await checkPublication(contents, true, { durationMs: 1000, startMs: 0, actions: [] });
      expect(result.browser).toStartWith('149.');
      expect(Buffer.from(result.preview.subarray(0, 8)).toString('hex')).toBe('89504e470d0a1a0a');
      expect(result.video.length).toBeGreaterThan(100);
      const browser = await (await browserEngine()).chromium.launch({ headless: false });
      try {
        const page = await browser.newPage();
        await page.setContent('<button onclick="this.textContent=123">Play</button>');
        await page.getByRole('button').click();
        expect(await page.getByRole('button').textContent()).toBe('123');
      } finally { await browser.close(); }
      console.log('Compatibility checks, PNG, WebM decoding and headed interaction passed');
    `,
      ],
      {
        cwd: resolve(import.meta.dir, '../..'),
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          PLAYWRIGHT_BROWSERS_PATH: cache,
          PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: 'mac13' + (process.arch === 'arm64' ? '-arm64' : ''),
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const timer = setTimeout(() => child.kill('SIGKILL'), 300000);
    try {
      const [code, output, error] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(code, output + error).toBe(0);
      expect(output).toContain(
        'Compatibility checks, PNG, WebM decoding and headed interaction passed',
      );
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) {
        child.kill();
        await child.exited;
      }
      await rm(cache, { recursive: true, force: true });
    }
  },
  310000,
);
