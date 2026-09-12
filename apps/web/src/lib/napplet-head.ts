type Shareable = { title: string; description: string; siteOrigin: string };
export function nappletHead(n: Shareable | undefined, path: string, imageId?: string) {
  if (!n || !imageId) return { meta: [{ title: 'Not found — napplet.space' }] };
  const url = `${n.siteOrigin}${path}`;
  const image = `${n.siteOrigin}/api/og/${imageId}?v=1`;
  return {
    meta: [
      { title: `${n.title} — napplet.space` },
      { name: 'description', content: n.description },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'napplet.space' },
      { property: 'og:title', content: n.title },
      { property: 'og:description', content: n.description },
      { property: 'og:url', content: url },
      { property: 'og:image', content: image },
      { property: 'og:image:type', content: 'image/png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: `${n.title} on napplet.space` },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: n.title },
      { name: 'twitter:description', content: n.description },
      { name: 'twitter:image', content: image },
      { name: 'twitter:image:alt', content: `${n.title} on napplet.space` },
    ],
    links: [{ rel: 'canonical', href: url }],
  };
}
