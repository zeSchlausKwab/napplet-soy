import { chromium } from '@playwright/test';
import { test, expect } from 'bun:test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordProject } from '../../apps/cli/src/project-config';
import { checkPublication } from '../../apps/cli/src/publish-check';
import { inspectProject } from '../../packages/publish/src/project';
import { inspectPreviewVideo } from '../../packages/protocol/src/preview-video';

test('records exact-build silent WebM, preserves previous clips and rejects stale selections', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soyli-video-'));
  try {
    await Bun.write(
      join(root, 'napplet.json'),
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Video check',
        entry: 'index.html',
        license: 'MIT',
        previewId: crypto.randomUUID(),
        preview: {
          delayMs: 250,
          recording: {
            durationMs: 2000,
            startMs: 0,
            actions: [{ type: 'click', x: 480, y: 300, atMs: 600 }],
          },
        },
      }),
    );
    await Bun.write(join(root, 'LICENSE'), 'MIT');
    await Bun.write(
      join(root, 'index.html'),
      '<!doctype html><style>html,body{margin:0;height:100%;background:#2064b4}body{display:grid;place-items:center}button{font:40px sans-serif}</style><button onclick="document.body.style.background=\'#ec7458\'">Change color</button>',
    );
    const result = await recordProject(root, 'local');
    const bytes = await Bun.file(result.video).bytes();
    const info = inspectPreviewVideo(bytes);
    expect(info.width).toBe(960);
    expect(info.height).toBe(600);
    expect(info.durationMs).toBeGreaterThanOrEqual(1900);
    expect(info.durationMs).toBeLessThan(4500);
    expect(bytes.length).toBeLessThan(1024 * 1024);
    const decoder = await chromium.launch();
    try {
      const page = await decoder.newPage();
      const pixel = await page.evaluate(
        async (data) => {
          const video = document.createElement('video');
          video.muted = true;
          await new Promise<void>((resolve, reject) => {
            video.onloadeddata = () => resolve();
            video.onerror = () => reject(new Error('Decode failed'));
            video.src = data;
          });
          await new Promise<void>((resolve) => {
            video.onseeked = () => resolve();
            video.currentTime = 1.5;
          });
          const canvas = document.createElement('canvas');
          canvas.width = 960;
          canvas.height = 600;
          const context = canvas.getContext('2d')!;
          context.drawImage(video, 0, 0);
          return [...context.getImageData(900, 550, 1, 1).data];
        },
        `data:video/webm;base64,${Buffer.from(bytes).toString('base64')}`,
      );
      // The timed click changed the app from blue to coral; lossy VP8 can shift channels slightly.
      expect(Math.abs(pixel[0] - 236)).toBeLessThan(12);
      expect(Math.abs(pixel[1] - 116)).toBeLessThan(12);
      expect(Math.abs(pixel[2] - 88)).toBeLessThan(12);
    } finally {
      await decoder.close();
    }

    await mkdir('.local/video-preview', { recursive: true });
    await Bun.write('.local/video-preview/captured.webm', bytes);
    console.log('Recorded WebM:', { ...info, bytes: bytes.length });
    const selected = await inspectProject(root, 'local', '0'.repeat(64));
    expect(selected.contents.has('preview.webm')).toBe(true);
    expect((await checkPublication(selected.contents)).video).toEqual(bytes);
    await expect(recordProject(root, 'local')).rejects.toMatchObject({ code: 'PREVIEW_EXISTS' });
    expect(await Bun.file(result.video).bytes()).toEqual(bytes);
    await Bun.write(join(root, 'index.html'), '<!doctype html><p>Changed build</p>');
    await expect(
      checkPublication((await inspectProject(root, 'local', '0'.repeat(64))).contents),
    ).rejects.toMatchObject({ code: 'PREVIEW_VIDEO_STALE' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
