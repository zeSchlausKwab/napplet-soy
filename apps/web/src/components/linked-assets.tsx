import { ArrowUpRight, FileArchive, Film, Image } from 'lucide-react';
import { useMemo } from 'react';
import { detailAssets } from '../../../../packages/backend/src/detail-assets';
import type { SignedEvent } from '../../../../packages/protocol/src';
import type { CachedPreview } from '../../../../packages/protocol/src/preview';
import type { CachedVideo } from '../../../../packages/protocol/src/preview-video';

export function LinkedAssets({
  manifest,
  preview,
  video,
  metadata = [],
}: {
  manifest: SignedEvent;
  preview?: CachedPreview | null;
  video?: CachedVideo | null;
  metadata?: SignedEvent[];
}) {
  const assets = useMemo(
    () => detailAssets(manifest, preview, video, metadata),
    [manifest, preview, video, metadata],
  );
  if (!assets.length) return null;
  return (
    <section className="linked-assets" aria-label="Linked assets">
      <h2>
        Linked assets <span>{assets.length}</span>
      </h2>
      <ul>
        {assets.map((asset) => {
          const Icon =
            asset.kind === 'video' ? Film : asset.kind === 'source' ? FileArchive : Image;
          return (
            <li key={asset.href}>
              <a
                href={asset.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${asset.title.toLowerCase()} (new tab)`}
              >
                <span className="linked-asset-icon" aria-hidden="true">
                  <Icon size={22} />
                  {asset.thumbnail && (
                    <img
                      src={asset.thumbnail}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={(event) => {
                        event.currentTarget.hidden = true;
                      }}
                    />
                  )}
                </span>
                <span className="linked-asset-label">
                  <strong>{asset.title}</strong>
                  <small>{asset.detail}</small>
                </span>
                <ArrowUpRight size={17} aria-hidden="true" />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
