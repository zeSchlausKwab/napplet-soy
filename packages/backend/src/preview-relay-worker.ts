// Bundled for Node and launched only by the catalog refresh process, never an HTTP request.
import { queryPreviewMetadata } from './preview-relay';
import { queryDiscoveryEvents } from './discovery-relay';

let text = '';
for await (const chunk of process.stdin) {
  text += chunk.toString();
  if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error('Metadata job exceeds size limit');
}
const { manifests, relays, filters } = JSON.parse(text);
const events = filters
  ? await queryDiscoveryEvents(relays, filters, AbortSignal.timeout(5000))
  : await queryPreviewMetadata(manifests, relays, AbortSignal.timeout(15000));
process.stdout.write(JSON.stringify(events));
