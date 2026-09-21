import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import records from '../../packages/backend/data/catalog.json';
import { OG_VERSION } from '../../packages/backend/src/public-model';

test('production HTML exposes one absolute OG image on main, profile and napplet routes without JavaScript', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-og-routes-'));
  const root = resolve(import.meta.dir, '../..');
  const web = Bun.spawn([process.execPath, join(root, 'apps/web/server.ts')], {
    // Also verifies that shipped fonts/mascot resolve independently of the CWD.
    cwd: directory,
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: '0',
      SPACE_SITE_ORIGIN: 'https://share.example',
      SPACE_COMMUNITY_DIR: join(directory, 'community'),
    },
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const timer = setTimeout(() => web.kill(), 30000);
  try {
    const reader = web.stdout.getReader();
    let output = '',
      site = '';
    try {
      while (!site) {
        const next = await reader.read();
        if (next.done) throw new Error(`Web server exited: ${output}`);
        output += new TextDecoder().decode(next.value);
        site = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] ?? '';
      }
    } finally {
      reader.releaseLock();
      void (async () => {
        for await (const _ of web.stdout) {
          /* drain */
        }
      })();
    }
    const n = records[0];
    const routes = [
      ['/', 'site'],
      ['/about', 'site'],
      ['/create', 'site'],
      ['/docs', 'site'],
      ['/network', 'site'],
      ['/admin', 'site'],
      ['/cli', 'site'],
      [`/proposals/${'a'.repeat(64)}`, 'site'],
      ['/@space-lab', 'site'],
      [`/p/${n.pubkey}`, 'profile'],
      [`/@space-lab/${n.slug}`, n.snapshot.id],
      [`/@space-lab/${n.slug}/play`, n.snapshot.id],
      [`/n/${n.naddr}`, n.snapshot.id],
      [`/n/${n.naddr}/play`, n.snapshot.id],
      [`/r/${n.snapshot.id}`, n.snapshot.id],
      [`/r/${n.snapshot.id}/play`, n.snapshot.id],
      [`/r/${n.snapshot.id}/source?view=html`, n.snapshot.id],
    ];
    const images = new Set<string>();
    for (const [path, expected] of routes) {
      const response = await fetch(`${site}${path}`, {
        headers: { 'x-forwarded-host': 'untrusted.example', 'x-forwarded-proto': 'http' },
      });
      expect(response.status, path).toBe(200);
      const meta = new Map<string, string[]>();
      await new HTMLRewriter()
        .on('meta', {
          element(el) {
            const key = el.getAttribute('property') ?? el.getAttribute('name');
            if (key) meta.set(key, [...(meta.get(key) ?? []), el.getAttribute('content') ?? '']);
          },
        })
        .transform(response)
        .text();
      const image = meta.get('og:image');
      expect(image, path).toHaveLength(1);
      expect(meta.get('twitter:image'), path).toEqual(image);
      expect(meta.get('og:image:width'), path).toEqual(['1200']);
      expect(meta.get('og:image:height'), path).toEqual(['630']);
      expect(meta.get('og:title'), path).toHaveLength(1);
      expect(meta.get('og:description')?.[0], path).toBeTruthy();
      expect(image![0], path).toStartWith('https://share.example/');
      expect(image![0], path).toContain(
        expected === 'profile' ? '/api/profile-og?' : `/api/og/${expected}?v=${OG_VERSION}`,
      );
      if (/^[a-f0-9]{64}$/.test(expected)) {
        expect(meta.get('og:title'), path).toEqual([n.title]);
        expect(meta.get('og:description'), path).toEqual([n.description]);
      }
      images.add(image![0]);
    }
    for (const image of images) {
      const url = image.replace('https://share.example', site);
      const response = await fetch(url);
      expect(response.status, image).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      const png = Buffer.from(await response.arrayBuffer());
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(png.readUInt32BE(16)).toBe(1200);
      expect(png.readUInt32BE(20)).toBe(630);
      const head = await fetch(url, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.headers.get('content-length')).toBe(String(png.length));
      expect((await head.arrayBuffer()).byteLength).toBe(0);
      if (head.headers.has('etag')) {
        expect(
          (await fetch(url, { headers: { 'if-none-match': head.headers.get('etag')! } })).status,
        ).toBe(304);
      }
    }
    expect((await fetch(`${site}/api/og/unknown`)).status).toBe(404);
  } finally {
    clearTimeout(timer);
    web.kill();
    await web.exited;
    await rm(directory, { recursive: true, force: true });
  }
}, 45000);
