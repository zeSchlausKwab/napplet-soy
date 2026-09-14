import { decodeAddress, identityAddress } from '../../protocol/src';
import { resolveNapplet } from './catalog';
import { resolvePublicNapplet, catalogStatus } from './public-catalog';
import { indexedRevision } from './indexed-catalog';
import { newerManifest } from './index-store';

/** Read-only accelerator; the CLI verifies the signed manifest and every downloaded byte. */
export async function manifestResponse(request: Request) {
  try {
    const reference = new URL(request.url).searchParams.get('reference') ?? '';
    if (reference.length > 4096) throw new Error();
    let lookup;
    if (/^[a-f0-9]{64}$/.test(reference)) lookup = { type: 'snapshot' as const, id: reference };
    else {
      identityAddress(decodeAddress(reference));
      lookup = { type: 'address' as const, naddr: reference };
    }
    const fixture = await resolveNapplet(lookup);
    const remote =
      (await resolvePublicNapplet(lookup)) ??
      (lookup.type === 'snapshot' ? await indexedRevision(lookup.id) : null);
    const local = fixture && (lookup.type === 'snapshot' ? fixture.snapshot : fixture.current);
    const manifest =
      remote && (!local || newerManifest(remote.manifest, local)) ? remote.manifest : local;
    if (!manifest) return Response.json({ error: 'Napplet not found' }, { status: 404 });
    return Response.json(
      { manifest, relays: (await catalogStatus()).relays },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json({ error: 'Invalid napplet reference' }, { status: 400 });
  }
}
