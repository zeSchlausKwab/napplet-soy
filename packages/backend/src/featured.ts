import { decodeAddress, identityAddress } from '../../protocol/src';
import { manifestBlocked, readPolicy } from '../../moderation/src/policy';
import { communityEntries, resolvePublicNapplet } from './public-catalog';
import type { PublicNapplet } from './public-model';

/** Curation is independent of gallery filters. A pinned selection always links to that event. */
export async function featuredGallery(entries?: PublicNapplet[]) {
  const catalog = entries ?? (await communityEntries());
  const byId = new Map(catalog.map((n) => [n.revisionId, n]));
  const byAddress = new Map(
    catalog.filter((n) => n.naddr).map((n) => [identityAddress(decodeAddress(n.naddr!)), n]),
  );
  const selected: PublicNapplet[] = [];
  const seen = new Set<string>();
  for (const rule of readPolicy().featured) {
    let entry = rule.type === 'address' ? byAddress.get(rule.target) : byId.get(rule.target);
    if (!entry && rule.type === 'event')
      entry = (await resolvePublicNapplet({ type: 'snapshot', id: rule.target })) ?? undefined;
    if (
      !entry ||
      entry.availability !== 'ready' ||
      manifestBlocked(entry.manifest) ||
      seen.has(entry.revisionId)
    )
      continue;
    seen.add(entry.revisionId);
    selected.push(rule.type === 'event' ? { ...entry, naddr: null } : entry);
    if (selected.length === 12) break;
  }
  return selected;
}
