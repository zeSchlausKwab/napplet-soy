import { renderAsync } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { resolveNapplet } from './catalog';
import { readPublicCatalog } from './public-catalog';
import { examples, examplePoster } from '../../examples/artifact';
import { previewImage } from './previews';
import { sha256 } from '../../protocol/src/artifact';
import { OG_VERSION } from './public-model';
import { indexedRevision } from './indexed-catalog';
import textMetrics from '../assets/og-text-metrics.json';
type Preview = {
  title: string;
  description: string;
  creator: string;
  topics: readonly string[];
  slug: string;
  fixture?: boolean;
  label?: string;
};
const escapeXml = (text: string) =>
  text
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(
      /[<>&"']/g,
      (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
    );
function lines(text: string, width: number, count: number, size: number, bold = false) {
  const characters = Array.from(text.replace(/\s+/g, ' ').trim());
  const output: string[] = [];
  const metrics: Record<string, number> = bold ? textMetrics.bold : textMetrics.regular;
  const measure = (letters: string[]) => letters.reduce((n, c) => n + (metrics[c] ?? 1) * size, 0);
  while (characters.length && output.length < count) {
    let end = 1;
    while (end < characters.length && measure(characters.slice(0, end + 1)) <= width) end++;
    if (end < characters.length) {
      const space = characters.slice(0, end).lastIndexOf(' ');
      if (space > 0) end = space;
    }
    output.push(characters.splice(0, end).join('').trim());
    while (characters[0] === ' ') characters.shift();
  }
  if (characters.length) {
    const last = Array.from(output.at(-1)!);
    while (last.length && measure([...last, '…']) > width) last.pop();
    output[output.length - 1] = last.join('').trimEnd() + '…';
  }
  return output;
}
// Trusted, shipped branding only. Creator images enter as already normalized PNGs.
// Load lazily: CLI consumers of backend modules don't need website branding assets.
let mascot: string | undefined;
function soybert(x: number, y: number, size: number) {
  mascot ??= readFileSync(
    process.env.SPACE_OG_MASCOT_PATH ??
      new URL('../../../apps/web/public/brand/soy-mascot.png', import.meta.url),
  ).toString('base64');
  return `<image x="${x}" y="${y}" width="${size}" height="${size}" href="data:image/png;base64,${mascot}"/>`;
}
function wordmark(x: number, y: number, size: number) {
  // SVG 1.1 renderers don't all support paint-order: draw the outline then fill.
  const attributes = `x="${x}" y="${y}" font-family="Fredoka" font-weight="700" font-size="${size}" letter-spacing="${-size * 0.035}"`;
  return `<text ${attributes} fill="#32231c" stroke="#32231c" stroke-width="${size * 0.09}" stroke-linejoin="round">napplet.soy</text>
    <text ${attributes} fill="#fff2d5">napplet.soy</text>`;
}
export function siteSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#f7f5ec"/>
    <path d="M795 0H1200V630H943C706 540 663 265 795 0" fill="#e6ebd8"/>
    <circle cx="1100" cy="102" r="18" fill="#f2775f"/>
    <g font-family="DM Sans" fill="#292f24">
      <circle cx="62" cy="69" r="5" fill="#83a664"/>
      <text x="80" y="75" font-size="18" letter-spacing="3">A PLAYGROUND FOR THE INTERNET</text>
      ${wordmark(54, 214, 106)}
      <text x="56" y="329" font-size="76" font-weight="700">Small code.</text>
      <text x="56" y="412" font-size="76" font-weight="700">Big weird<tspan fill="#f2775f">.</tspan></text>
      <path d="M59 436Q196 421 326 435T500 430" fill="none" stroke="#f2775f" stroke-width="5" stroke-linecap="round"/>
      <text x="58" y="501" font-size="24" fill="#646b59">Tiny games. Happy accidents.</text>
      <text x="58" y="535" font-size="24" fill="#646b59">Wonderfully unnecessary things.</text>
      <text x="58" y="594" font-size="18" font-weight="700" letter-spacing="2" fill="#4c7150">PLAY · REMIX · BUILD TOGETHER</text>
    </g>
    <ellipse cx="959" cy="528" rx="154" ry="24" fill="#ccd6b7"/>
    ${soybert(694, 89, 494)}
  </svg>`;
}
export function previewSvg(n: Preview, cover?: Buffer) {
  const example = n.fixture ? examples.find((e) => e.slug === n.slug) : undefined;
  const art = cover
    ? `<image x="36" y="112" width="724" height="482" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${cover.toString('base64')}"/>`
    : example
      ? `<image x="36" y="112" width="724" height="482" preserveAspectRatio="xMidYMid meet" href="data:image/svg+xml;base64,${Buffer.from(examplePoster(example)).toString('base64')}"/>`
      : soybert(162, 116, 474);
  let titleSize = 43;
  let title = lines(n.title, 360, 3, titleSize, true);
  while (title.at(-1)?.endsWith('…') && titleSize > 31) {
    titleSize -= 3;
    title = lines(n.title, 360, 3, titleSize, true);
  }
  const titleLeading = titleSize + 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs><clipPath id="cover"><rect x="36" y="112" width="724" height="482" rx="20"/></clipPath>
      <clipPath id="copy"><rect x="800" y="112" width="364" height="420"/></clipPath></defs>
    <rect width="1200" height="630" fill="#f7f5ec"/>
    ${soybert(28, 14, 82)}${wordmark(113, 72, 43)}
    <text x="1164" y="61" text-anchor="end" font-family="DM Sans" font-size="16" letter-spacing="2" fill="#4c7150">SMALL CODE. BIG WEIRD.</text>
    <rect x="36" y="112" width="724" height="482" rx="20" fill="#e6ebd8"/>
    <g clip-path="url(#cover)">${art}</g>
    <g font-family="DM Sans" fill="#292f24">
      <g clip-path="url(#copy)">
        <text x="800" y="140" font-size="16" letter-spacing="1.5" fill="#4c7150">${escapeXml(n.label ?? 'PLAY SOMETHING NEW')}</text>
        ${title.map((line, i) => `<text x="800" y="${204 + i * titleLeading}" font-size="${titleSize}" font-weight="700">${escapeXml(line)}</text>`).join('')}
        ${lines(n.description, 360, 5, 22)
          .map(
            (line, i) =>
              `<text x="800" y="${240 + title.length * titleLeading + i * 29}" font-size="22" fill="#646b59">${escapeXml(line)}</text>`,
          )
          .join('')}
      </g>
      <text x="800" y="562" font-size="16" fill="#4c7150">${escapeXml(lines(n.topics.map((t) => `#${t}`).join(' · '), 360, 1, 16)[0] ?? '')}</text>
      <text x="800" y="591" font-size="17">${escapeXml(lines(n.creator, 360, 1, 17)[0] ?? '')}</text>
    </g>
  </svg>`;
}
/** Bundled fonts make OG output identical on macOS, Linux and VPS hosts. */
export async function renderOg(svg: string) {
  return (
    await renderAsync(svg, {
      font: {
        loadSystemFonts: false,
        defaultFontFamily: 'DM Sans',
        fontFiles: [
          process.env.SPACE_FONT_PATH ?? new URL('../assets/DMSans.ttf', import.meta.url).pathname,
          process.env.SPACE_OG_BODY_BOLD_PATH ??
            new URL('../assets/DMSans-Bold.ttf', import.meta.url).pathname,
          process.env.SPACE_OG_FONT_PATH ??
            new URL('../assets/Fredoka-Bold.ttf', import.meta.url).pathname,
        ],
      },
    })
  ).asPng();
}
let siteImage: Promise<Buffer> | undefined;
const cache = new Map<string, Promise<Buffer>>();
export async function ogImage(id: string) {
  if (id === 'site') {
    siteImage ??= renderOg(siteSvg()).catch((error) => {
      siteImage = undefined;
      throw error;
    });
    return siteImage;
  }
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  // Resolve on every request so an old process cache cannot enable publicdev content.
  const n =
    (await resolveNapplet({ type: 'snapshot', id })) ??
    (await indexedRevision(id)) ??
    (await readPublicCatalog())?.entries.find((entry) => entry.revisionId === id);
  if (!n) return null;
  const cover = await previewImage(id);
  const key = `${id}:${cover ? await sha256(cover) : 'generated'}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = renderOg(previewSvg(n, cover ?? undefined)).catch((error) => {
      cache.delete(key);
      throw error;
    });
    if (cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(key, pending);
  }
  return pending;
}
export async function ogResponse(id: string, request: Request) {
  const bytes = await ogImage(id);
  if (!bytes) return new Response('Preview not found', { status: 404 });
  const etag = `"og-${OG_VERSION}-${await sha256(bytes)}"`;
  const headers = {
    'Content-Type': 'image/png',
    'Content-Length': String(bytes.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ETag: etag,
  };
  if (request.headers.get('if-none-match') === etag) {
    const { 'Content-Length': _, ...notModified } = headers;
    return new Response(null, { status: 304, headers: notModified });
  }
  return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), { headers });
}
