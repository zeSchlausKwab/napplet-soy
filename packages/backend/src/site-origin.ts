export function siteOrigin() {
  const url = new URL(
    process.env.SPACE_SITE_ORIGIN || `http://localhost:${process.env.PORT || '3000'}`,
  );
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('SPACE_SITE_ORIGIN must be an absolute HTTP(S) origin without a path.');
  // Host and forwarded headers are deliberately not used to build canonical/share URLs.
  return url.origin;
}
