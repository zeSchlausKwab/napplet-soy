import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import upstream from '../../apps/cli/vendor/boilerplate.json';

const enabled =
  process.env.SPACE_TEST_CLI && process.env.SPACE_TEST_BOILERPLATE === '1' ? test : test.skip;
enabled(
  'standalone upstream starter installs, verifies, previews, rebuilds capabilities and checks without global runtimes',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'napplet-boilerplate-'));
    const binary = process.env.SPACE_TEST_CLI!;
    const env = {
      ...process.env,
      PATH: '/usr/bin:/bin',
      SPACE_ACCOUNT_HOME: join(root, 'accounts'),
    };
    const project = join(root, 'creation');
    async function run(args: string[], cwd = project) {
      const child = Bun.spawn([binary, ...args], {
        cwd,
        env,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const timeout = setTimeout(() => child.kill('SIGKILL'), 120000);
      try {
        const [code, out, err] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(code, out + err).toBe(0);
        return out;
      } finally {
        clearTimeout(timeout);
      }
    }
    let dev: Bun.Subprocess | undefined;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      await run(['new', 'creation', '--identity', 'later', '--json'], root);
      expect(
        (await readFile(join(project, 'src/main.ts'), 'utf8')).replace(
          "import './napplet-settings.js';\n",
          '',
        ),
      ).toBe(upstream.files['src/main.ts']);
      expect(await readFile(join(project, 'pnpm-lock.yaml'), 'utf8')).toBe(
        upstream.files['pnpm-lock.yaml'],
      );
      expect(await Bun.file(join(project, '.agents/skills/napplet-make/SKILL.md')).exists()).toBe(
        true,
      );
      // The upstream default deliberately declares no hard requirements. Exercise
      // creator-specified standard metadata without changing the shipped template.
      await writeFile(
        join(project, 'vite.config.ts'),
        upstream.files['vite.config.ts'].replace(
          "nappletType: 'my-napplet',",
          "nappletType: 'my-napplet', requires: ['storage', 'theme'],",
        ),
      );
      await run(['run', 'verify']);
      expect(await run(['check', '--json'])).toContain('"status":"checked"');
      let output = '';
      dev = Bun.spawn([binary, 'dev', '--port', '0', '--no-open', '--json'], {
        cwd: project,
        env,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const drain = async (stream: ReadableStream<Uint8Array>) => {
        for await (const bytes of stream) output += new TextDecoder().decode(bytes);
      };
      const streams = Promise.all([
        drain(dev.stdout as ReadableStream<Uint8Array>),
        drain(dev.stderr as ReadableStream<Uint8Array>),
      ]);
      const deadline = Date.now() + 20000;
      while (!output.match(/\{"url":"[^"\n]+"\}/) && Date.now() < deadline && dev.exitCode === null)
        await Bun.sleep(50);
      const match = output.match(/\{"url":"[^"\n]+"\}/);
      expect(match, output).not.toBeNull();
      const url = JSON.parse(match![0]).url;
      const before = await (await fetch(new URL('revision', url))).json();
      expect(before.requires).toEqual(['storage', 'theme']);
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(url);
      const frame = page.frameLocator('iframe');
      await frame.locator('#noteInput').fill('Saved with upstream SDK');
      await frame.locator('#storageButton').click();
      await frame.locator('#storageValue').filter({ hasText: 'Saved with upstream SDK' }).waitFor();
      expect(await frame.locator('#notifyButton').isDisabled()).toBe(true);
      await page.getByRole('button', { name: 'Napplet settings', exact: true }).click();
      await page.getByLabel('Text size', { exact: true }).fill('18');
      await page.getByRole('button', { name: 'Save settings' }).click();
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
      expect(await frame.locator('html').evaluate((node) => node.style.fontSize)).toBe('18px');
      await writeFile(
        join(project, 'src/main.ts'),
        "import './napplet-settings.js';\n" +
          upstream.files['src/main.ts'] +
          '\ndocument.getElementById("noteInput")!.setAttribute("data-rebuilt", "yes");\n',
      );
      await frame.locator('#noteInput[data-rebuilt="yes"]').waitFor({ timeout: 15000 });
      const after = await (await fetch(new URL('revision', url))).json();
      expect(after.id).not.toBe(before.id);
      expect(after.requires).toEqual(before.requires);
      expect(errors).toEqual([]);
      dev.kill('SIGTERM');
      await Promise.race([
        dev.exited,
        Bun.sleep(3000).then(() => {
          throw Error('Preview did not stop');
        }),
      ]);
      await streams;
      await expect(fetch(url)).rejects.toThrow();
    } finally {
      await browser?.close();
      if (dev?.exitCode === null) {
        dev.kill('SIGTERM');
        await dev.exited;
      }
      await rm(root, { recursive: true, force: true });
    }
  },
  240000,
);
