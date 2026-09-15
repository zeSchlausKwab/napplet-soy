import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { previewAssets } from './preview/assets';
import { browserEngine, installBrowser } from './browser';
import { startPreviewServer } from './preview/server';
import { inspectPreviewVideo, MAX_VIDEO_BYTES } from '../../../packages/protocol/src/preview-video';
import { sha256 } from '../../../packages/protocol/src';
import { regularFile } from '../../../packages/publish/src/project';
import { PublishError, type Recording } from '../../../packages/publish/src/config';
import { AccountError } from '../../../packages/identity/src/signer';
import { RUNTIME_PROFILE } from '../../../packages/runtime/src/capabilities';
import { MAX_PREVIEW_BYTES } from '../../../packages/protocol/src/preview';
import {
  builtConfiguration,
  executableBytes,
  executableEntry,
} from '../../../packages/publish/src/artifact';

/** Execute only the frozen HTML in our current sandbox. Never run a project's build/preview scripts. */
export async function checkPublication(
  contents: Map<string, Uint8Array>,
  forceScreenshot = false,
  recording?: Recording,
) {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-publish-check-'));
  let browser: import('@playwright/test').Browser | undefined;
  let server: ReturnType<typeof startPreviewServer> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await builtConfiguration(executableBytes(contents));
    const config = JSON.parse(new TextDecoder().decode(contents.get('napplet.json')));
    if (
      !recording &&
      !forceScreenshot &&
      config.preview?.video &&
      config.preview.video.artifactHash !== (await sha256(executableBytes(contents)))
    )
      throw new PublishError(
        'PREVIEW_VIDEO_STALE',
        'The clip belongs to an older build. Record again or remove preview.video before publishing.',
      );
    await mkdir(join(directory, '.napplet'));
    await mkdir(join(directory, 'dist'));
    for (const path of [executableEntry(contents), 'napplet.json'])
      await Bun.write(join(directory, path), contents.get(path)!);
    server = startPreviewServer(pathToFileURL(directory + '/'), 0, false, await previewAssets());
    await installBrowser(undefined, !!recording);
    try {
      const { chromium } = await browserEngine();
      browser = await chromium.launch({ headless: true });
    } catch {
      throw new PublishError(
        'BROWSER_REQUIRED',
        'The check browser could not start. Run soyli doctor; Linux needs the Chromium system libraries. Browser setup is available with soyli browser install.',
      );
    }
    const delayMs = config.preview?.delayMs ?? 1500;
    if (!Number.isInteger(delayMs) || delayMs < 250 || delayMs > 10000)
      throw new PublishError('PREVIEW_CONFIG', 'preview.delayMs must be between 250 and 10000.');
    const page = await browser.newPage({
      viewport: { width: 1200, height: 850 },
      deviceScaleFactor: 1,
    });
    page.setDefaultTimeout(5000);
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
    await iframe.evaluate((node) => {
      node.style.cssText =
        'position:fixed;top:0;left:0;width:1200px;height:750px;border:0;display:block;';
    });
    await frame.waitForFunction(() => document.fonts.status === 'loaded', undefined, {
      timeout: 5000,
    });
    await page.waitForTimeout(delayMs);
    if (errors.length || (await frame.evaluate(() => (window as any).__publishViolations?.length)))
      throw new Error();
    let preview: Uint8Array;
    if (config.preview?.image && !forceScreenshot) {
      const selected = contents.get(config.preview.image);
      if (
        !selected ||
        selected.length > MAX_PREVIEW_BYTES ||
        Buffer.from(selected.subarray(0, 8)).toString('hex') !== '89504e470d0a1a0a'
      )
        throw new PublishError(
          'PREVIEW_IMAGE',
          'preview.image must select a PNG under 5 MiB in the project.',
        );
      const header = Buffer.from(selected);
      if (
        header.length < 24 ||
        header.toString('ascii', 12, 16) !== 'IHDR' ||
        header.readUInt32BE(16) > 4096 ||
        header.readUInt32BE(20) > 4096
      )
        throw new PublishError(
          'PREVIEW_IMAGE',
          'The selected PNG must be no larger than 4096 × 4096.',
        );
      const valid = await page.evaluate(
        async (data) => {
          const image = new Image();
          image.src = data;
          try {
            await image.decode();
          } catch {
            return false;
          }
          return (
            image.naturalWidth > 0 &&
            image.naturalHeight > 0 &&
            image.naturalWidth <= 4096 &&
            image.naturalHeight <= 4096
          );
        },
        `data:image/png;base64,${Buffer.from(selected).toString('base64')}`,
      );
      if (!valid)
        throw new PublishError(
          'PREVIEW_IMAGE',
          'The selected preview must be a valid PNG no larger than 4096 × 4096.',
        );
      preview = selected;
    } else {
      preview = new Uint8Array(await iframe.screenshot({ type: 'png', timeout: 5000 }));
    }
    if (preview.length > MAX_PREVIEW_BYTES)
      throw new PublishError(
        'PREVIEW_IMAGE',
        'The preview exceeds 5 MiB. Choose a smaller PNG with preview.image.',
      );
    let video: Uint8Array | undefined;
    if (recording) {
      // Capture only the verified iframe. The host controls are outside the recording viewport.
      await page.setViewportSize({ width: 960, height: 600 });
      await iframe.evaluate((node) => {
        node.style.width = '960px';
        node.style.height = '600px';
        node.style.zIndex = '2147483647';
      });
      await page.waitForTimeout(recording.startMs + 100);
      const path = join(directory, 'preview.webm');
      await page.screencast.start({ path, size: { width: 960, height: 600 } });
      try {
        const start = Date.now();
        for (const action of [...recording.actions].sort((a, b) => a.atMs - b.atMs)) {
          await page.waitForTimeout(Math.max(0, start + action.atMs - Date.now()));
          if (action.type === 'click') await page.mouse.click(action.x, action.y);
          else await page.keyboard[action.type === 'keyDown' ? 'down' : 'up'](action.key);
        }
        await page.waitForTimeout(Math.max(0, start + recording.durationMs - Date.now()));
      } finally {
        await page.screencast.stop();
      }
      video = await regularFile(directory, 'preview.webm', MAX_VIDEO_BYTES);
    } else if (config.preview?.video && !forceScreenshot) {
      video = contents.get(config.preview.video.file);
      if (!video) throw new PublishError('PREVIEW_VIDEO', 'The selected preview video is missing.');
    }
    if (video) {
      try {
        inspectPreviewVideo(video);
      } catch {
        throw new PublishError(
          'PREVIEW_VIDEO',
          'Use a silent VP8 WebM up to 12 seconds, 1200 × 750 and 5 MiB, or record a new clip.',
        );
      }
      // Decode an actual frame with our cached browser; metadata alone is insufficient.
      const decoded = await page.evaluate(
        async (data) => {
          const v = document.createElement('video');
          v.muted = true;
          v.preload = 'auto';
          try {
            return await new Promise<boolean>((resolve) => {
              const timer = setTimeout(() => resolve(false), 5000);
              v.onloadeddata = () => {
                clearTimeout(timer);
                resolve(v.videoWidth > 0);
              };
              v.onerror = () => {
                clearTimeout(timer);
                resolve(false);
              };
              v.src = data;
            });
          } finally {
            v.removeAttribute('src');
            v.load();
          }
        },
        `data:video/webm;base64,${Buffer.from(video).toString('base64')}`,
      );
      if (!decoded)
        throw new PublishError(
          'PREVIEW_VIDEO',
          'The selected WebM could not be decoded. Record a new clip.',
        );
    }
    if (errors.length || (await frame.evaluate(() => (window as any).__publishViolations?.length)))
      throw new Error();
    return { profile: RUNTIME_PROFILE, browser: browser.version(), preview, video };
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
