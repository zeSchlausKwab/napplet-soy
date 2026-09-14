import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { previewAssets } from './preview/assets';
import { browserEngine, installBrowser } from './browser';
import { startPreviewServer } from './preview/server';
import { PublishError } from '../../../packages/publish/src/config';
import { AccountError } from '../../../packages/identity/src/signer';
import { RUNTIME_PROFILE } from '../../../packages/runtime/src/capabilities';
import { executableEntry } from '../../../packages/publish/src/artifact';

/** Execute only the frozen HTML in our current sandbox. Never run a project's build/preview scripts. */
export async function checkPublication(contents: Map<string, Uint8Array>) {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-publish-check-'));
  let browser: import('@playwright/test').Browser | undefined;
  let server: ReturnType<typeof startPreviewServer> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await mkdir(join(directory, '.napplet'));
    await mkdir(join(directory, 'dist'));
    for (const path of [executableEntry(contents), 'napplet.json'])
      await Bun.write(join(directory, path), contents.get(path)!);
    server = startPreviewServer(pathToFileURL(directory + '/'), 0, false, await previewAssets());
    await installBrowser();
    try {
      const { chromium } = await browserEngine();
      browser = await chromium.launch({ headless: true });
    } catch {
      throw new PublishError(
        'BROWSER_REQUIRED',
        'The check browser could not start. Run napplet-space doctor; Linux needs the Chromium system libraries. Browser setup is available with napplet-space browser install.',
      );
    }
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', () => errors.push('script error'));
    await page.addInitScript(() => {
      (window as any).__publishViolations = [];
      document.addEventListener('securitypolicyviolation', (event) =>
        (window as any).__publishViolations.push(event.violatedDirective),
      );
    });
    await page.route('**/*', (route) =>
      new URL(route.request().url()).origin === server!.url.origin
        ? route.continue()
        : route.abort(),
    );
    await page.goto(server.url.href, { waitUntil: 'load', timeout: 10000 });
    await page.waitForFunction(
      () => !!document.querySelector('iframe')?.getAttribute('srcdoc'),
      undefined,
      { timeout: 10000 },
    );
    const iframe = page.locator('iframe');
    if (
      (await iframe.getAttribute('sandbox')) !== 'allow-scripts' ||
      (await iframe.getAttribute('src'))
    )
      throw new Error();
    const frame = page.frames().find((frame) => frame.parentFrame());
    if (!frame) throw new Error();
    await frame.waitForFunction(() => !!(window as any).napplet?.shell, undefined, {
      timeout: 5000,
    });
    await Promise.race([
      frame.evaluate(() => (window as any).napplet.shell.ready()),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Handshake timed out')), 5000);
      }),
    ]);
    await page.waitForTimeout(250);
    if (errors.length || (await frame.evaluate(() => (window as any).__publishViolations?.length)))
      throw new Error();
    return { profile: RUNTIME_PROFILE, browser: browser.version() };
  } catch (error) {
    if (error instanceof AccountError) throw error;
    throw new PublishError(
      'BROWSER_CHECK',
      'The frozen creation failed the shared sandbox startup check. Run the local preview and fix script or handshake errors before publishing.',
    );
  } finally {
    clearTimeout(timer);
    await browser?.close();
    server?.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}
