import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browserCache, browserEngine } from '../../apps/cli/src/browser';
import { DiagnosticError } from '../../packages/diagnostics/src';

export async function captureGame(output: string) {
  await mkdir(output, { recursive: true });
  const build = await Bun.build({
    entrypoints: [resolve(import.meta.dir, 'game.ts')],
    target: 'browser',
    minify: true,
  });
  if (!build.success)
    throw new AggregateError(build.logs, 'Could not compile the recording prototype.');
  const script = await build.outputs[0].text();
  const html = await Bun.file(join(import.meta.dir, 'game.html')).text();
  await Bun.write(join(output, 'game.js'), script);
  await Bun.write(join(output, 'game.html'), html);
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      return new URL(request.url).pathname === '/game.js'
        ? new Response(script, { headers: { 'Content-Type': 'text/javascript' } })
        : new Response(html, { headers: { 'Content-Type': 'text/html' } });
    },
  });
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= browserCache();
  const { chromium } = await browserEngine();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1024, height: 640 },
      deviceScaleFactor: 1,
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // A real keyboard input must move the same prototype that supplies the film.
    await page.goto(server.url.href);
    await page.waitForFunction(() => !!window.orbitCapture);
    const before = await page.evaluate(() => window.orbitCapture.state().x);
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(350);
    await page.keyboard.up('ArrowRight');
    if ((await page.evaluate(() => window.orbitCapture.state().x)) - before < 8)
      throw new Error('Keyboard input did not move the marble.');
    await page.close();
    for (const variant of ['original', 'portals']) {
      const page = await browser.newPage({
        viewport: { width: 1024, height: 640 },
        deviceScaleFactor: 1,
      });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${server.url}?capture&variant=${variant}`);
      await page.waitForFunction(() => !!window.orbitCapture);
      const target = join(output, `${variant}.mp4`);
      const encoder = Bun.spawn(
        [
          'ffmpeg',
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-f',
          'image2pipe',
          '-vcodec',
          'png',
          '-framerate',
          '30',
          '-i',
          'pipe:0',
          '-an',
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '18',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
          target,
        ],
        { stdin: 'pipe', stdout: 'ignore', stderr: 'pipe' },
      );
      const stderr = new Response(encoder.stderr).text();
      let final: { teleports: number; won: boolean } | undefined;
      try {
        for (let frame = 0; frame < 300; frame++) {
          final = await page.evaluate((f) => window.orbitCapture.at(f), frame);
          const png = await page.screenshot({ type: 'png' });
          encoder.stdin.write(png);
          await encoder.stdin.flush();
          if (frame % 90 === 0) console.log(`Capture ${variant}: ${frame}/300`);
        }
        encoder.stdin.end();
        const code = await encoder.exited;
        if (code !== 0)
          throw new DiagnosticError('FILM_CAPTURE', 'Gameplay encoding failed.', {
            tool: 'ffmpeg',
            exitCode: code,
            detail: await stderr,
          });
      } finally {
        if (encoder.exitCode === null) {
          encoder.kill();
          await encoder.exited;
        }
        await page.close();
      }
      if (!final?.won || final.teleports !== (variant === 'portals' ? 1 : 0))
        throw new Error(`Incomplete ${variant} run: ${JSON.stringify(final)}`);
      console.log(`${variant}: complete, ${final.teleports} portal transfer(s)`);
    }
    if (errors.length) throw new Error(errors.join('\n'));
    await Bun.write(
      join(output, 'capture-verification.json'),
      JSON.stringify(
        {
          keyboard: true,
          browserErrors: errors,
          variants: ['original', 'portals'],
          frames: 300,
          fps: 30,
          source:
            'Local playable Canvas prototype; fixed-step browser capture. No public operations.',
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    server.stop(true);
  }
}
if (import.meta.main)
  await captureGame(resolve(process.argv[2] ?? 'output/presentation-proof/media'));
