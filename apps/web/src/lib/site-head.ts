import { OG_VERSION } from '../../../../packages/backend/src/public-model';

export const siteDescription =
  'A playground for tiny games, digital experiments, and wonderfully unnecessary things. Play, inspect, and remix.';

/** Shared SSR defaults. Entity routes override these with their own signed metadata. */
export function siteHead(
  origin: string,
  path = '/',
  title = 'napplet.soy — Small code. Big weird.',
  description = siteDescription,
) {
  const url = `${origin}${path}`;
  const image = `${origin}/api/og/site?v=${OG_VERSION}`;
  return {
    meta: [
      { title },
      { name: 'description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'napplet.soy' },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:url', content: url },
      { property: 'og:image', content: image },
      { property: 'og:image:type', content: 'image/png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: 'Soybert and napplet.soy — Small code. Big weird.' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
      { name: 'twitter:image', content: image },
      { name: 'twitter:image:alt', content: 'Soybert and napplet.soy — Small code. Big weird.' },
    ],
    links: [{ rel: 'canonical', href: url }],
  };
}
