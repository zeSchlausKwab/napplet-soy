import { renderAsync } from '@resvg/resvg-js';
import { resolveNapplet } from './catalog';
import { readPublicCatalog } from './public-catalog';
import { examples, examplePoster } from '../../examples/artifact';
import { previewImage } from './previews';
import { sha256 } from '../../protocol/src/artifact';
import { OG_VERSION } from './public-model';
import { indexedRevision } from './indexed-catalog';
type Preview = {
  title: string;
  description: string;
  creator: string;
  topics: readonly string[];
  slug: string;
  fixture?: boolean;
};
const escapeXml = (text: string) =>
  text
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(
      /[<>&"']/g,
      (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
    );
function lines(text: string, width: number, count: number) {
  const characters = Array.from(text.replace(/\s+/g, ' ').trim());
  const output: string[] = [];
  while (characters.length && output.length < count) {
    let end = Math.min(width, characters.length);
    if (end < characters.length) {
      const space = characters.slice(0, end).lastIndexOf(' ');
      if (space > width / 2) end = space;
    }
    output.push(characters.splice(0, end).join('').trim());
    while (characters[0] === ' ') characters.shift();
  }
  if (characters.length) output[output.length - 1] = output.at(-1)!.slice(0, -1) + '…';
  return output;
}
export function previewSvg(n: Preview, cover?: Buffer) {
  const example = n.fixture ? examples.find((e) => e.slug === n.slug) : undefined;
  const art = cover
    ? `<image x="750" y="150" width="394" height="330" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${cover.toString('base64')}"/>`
    : example
      ? `<image x="790" y="140" width="350" height="330" preserveAspectRatio="xMidYMid slice" href="data:image/svg+xml;base64,${Buffer.from(examplePoster(example)).toString('base64')}"/>`
      : `<g transform="translate(965 307)" fill="none" stroke="#77ad96" stroke-width="5"><ellipse rx="150" ry="60" transform="rotate(-35)"/><ellipse rx="150" ry="60" transform="rotate(35)"/><circle r="30" fill="#ed7359" stroke="none"/><circle cx="119" cy="-84" r="12" fill="#77ad96" stroke="none"/></g>`;
  // Covers have already been decoded into bounded raster PNGs. No remote URL reaches the renderer.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#f5f3eb"/>
    <path d="M56 105H1144M56 524H1144" stroke="#d5d4cc"/>
    <g font-family="DM Sans" fill="#252922">
    <path d="M68 48V78M53 63H83M57 52L79 74M57 74L79 52" stroke="#42755d" stroke-width="3"/>
    <text x="98" y="72" font-size="32" font-weight="700">napplet.space</text>
    <text x="1144" y="68" font-size="19" text-anchor="end" fill="#42755d">SMALL CODE. BIG WEIRD.</text>
    <text x="56" y="162" font-size="18" fill="#42755d">${escapeXml(lines(n.topics.length ? n.topics.map((t) => `#${t}`).join(' · ') : 'NAPPLET', 58, 1)[0] ?? 'NAPPLET')}</text>
    ${lines(n.title, 19, 3)
      .map(
        (line, i) =>
          `<text x="52" y="${249 + i * 75}" font-size="68" font-weight="700">${escapeXml(line)}</text>`,
      )
      .join('')}
    ${lines(n.description, 55, 2)
      .map(
        (line, i) =>
          `<text x="56" y="${462 + i * 26}" font-size="21" fill="#646b61">${escapeXml(line)}</text>`,
      )
      .join('')}
    <text x="56" y="574" font-size="21">${escapeXml(lines(n.creator, 52, 1)[0] ?? '')}</text>
    <text x="1144" y="574" font-size="21" text-anchor="end" fill="#42755d">Explore this napplet ↗</text>
    </g>${art}</svg>`;
}
const cache = new Map<string, Promise<Buffer>>();
export async function ogImage(id: string) {
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
    pending = renderAsync(previewSvg(n, cover ?? undefined), {
      font: {
        loadSystemFonts: false,
        defaultFontFamily: 'DM Sans',
        fontFiles: [
          process.env.SPACE_FONT_PATH ?? new URL('../assets/DMSans.ttf', import.meta.url).pathname,
        ],
      },
    })
      .then((result) => result.asPng())
      .catch((error) => {
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
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    ETag: etag,
  };
  if (request.headers.get('if-none-match') === etag) {
    const { 'Content-Length': _, ...notModified } = headers;
    return new Response(null, { status: 304, headers: notModified });
  }
  return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), { headers });
}
