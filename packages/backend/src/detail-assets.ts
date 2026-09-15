import type { SignedEvent } from '../../protocol/src';
import { descriptorImages, validatedPreview, type CachedPreview } from '../../protocol/src/preview';
import {
  descriptorVideos,
  validatedVideo,
  type CachedVideo,
} from '../../protocol/src/preview-video';

export type DetailAsset = {
  kind: 'image' | 'video' | 'source';
  title: string;
  href: string;
  detail: string;
  thumbnail?: string;
  download?: string;
};

const size = (bytes: number) =>
  bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
function linkedUrl(value: string) {
  try {
    const url = new URL(value);
    return value.length <= 4096 && url.protocol === 'https:' && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

/** Presentation only: use existing signed associations; never fetch or infer attachments. */
export function detailAssets(
  manifest: SignedEvent,
  image?: CachedPreview | null,
  clip?: CachedVideo | null,
): DetailAsset[] {
  const preview = validatedPreview(manifest, image);
  const video = validatedVideo(manifest, clip);
  const assets: DetailAsset[] = [];
  const seen = new Set<string>();
  if (preview) {
    const href = `/api/previews/${manifest.id}?v=${preview.hash}`;
    assets.push({
      kind: 'image',
      title: 'Preview image',
      href,
      thumbnail: href,
      detail: `PNG · ${preview.width} × ${preview.height} · ${size(preview.bytes)}`,
    });
    seen.add(preview.url);
  }
  if (video) {
    assets.push({
      kind: 'video',
      title: 'Preview clip',
      href: `/api/preview-videos/${manifest.id}?v=${video.hash}`,
      detail: `WebM · ${(video.durationMs / 1000).toFixed(1)} sec · ${size(video.bytes)}`,
    });
    seen.add(video.url);
  }
  // The cache selects one cover/clip. Other declared files remain opt-in links
  // to the publisher's server, not unverified embeds or downloads at render time.
  const descriptors = new Map<string, { event: SignedEvent; profile?: SignedEvent }>();
  if (preview)
    descriptors.set(preview.descriptor.id, { event: preview.descriptor, profile: preview.profile });
  if (video && !descriptors.has(video.descriptor.id))
    descriptors.set(video.descriptor.id, { event: video.descriptor });
  let images = 0,
    videos = 0;
  for (const { event, profile } of descriptors.values()) {
    const links = [
      ...descriptorImages(event, profile).map((url) => ({ url, kind: 'image' as const })),
      ...descriptorVideos(event).map(({ url }) => ({ url, kind: 'video' as const })),
    ];
    for (const link of links) {
      const url = linkedUrl(link.url);
      if (!url || seen.has(url.href) || seen.has(link.url)) continue;
      seen.add(url.href);
      assets.push({
        kind: link.kind,
        href: url.href,
        title:
          link.kind === 'image' ? `Additional image ${++images}` : `Additional clip ${++videos}`,
        detail: `Original file · ${url.hostname}`,
      });
    }
  }
  const archives = manifest.tags.filter((tag) => tag[0] === 'source-archive');
  if (archives.length === 1 && archives[0][1]?.length <= 4096) {
    try {
      const url = new URL(archives[0][1]);
      // The existing source endpoint owns download policy and hash/tar checks,
      // including the operator's local development storage configuration.
      if (
        ['https:', 'http:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.hash &&
        /\/[a-f0-9]{64}(?:\.tar)?$/.test(url.pathname)
      )
        assets.push({
          kind: 'source',
          title: 'Source archive',
          href: `/api/source?${new URLSearchParams({ revision: manifest.id, view: 'project', archive: '1' })}`,
          detail: 'TAR · original project files',
          download: 'source.tar',
        });
    } catch {
      /* A malformed optional reference does not become a download. */
    }
  }
  return assets;
}
