// Offline browser-test catalog only. Never publish this public fixture key or these events.
import { finalizeEvent } from 'nostr-tools';
import { renderAsync } from '@resvg/resvg-js';
import { join } from 'node:path';
import records from '../../packages/backend/data/catalog.json';
import { sha256 } from '../../packages/protocol/src';
import { refreshPublicCatalog } from '../../scripts/publicdev';

const directory = process.argv[2];
if (!directory) throw new Error('Expected a test directory');
const key = new Uint8Array(32);
key[31] = 1;
const base = records[0].current;
const image = (
  await renderAsync(
    `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600"><rect width="960" height="600" fill="#24283a"/><circle cx="480" cy="300" r="190" fill="#ed7359"/><circle cx="430" cy="265" r="18" fill="#24283a"/><circle cx="530" cy="265" r="18" fill="#24283a"/><path d="M410 335Q480 420 550 335" fill="none" stroke="#24283a" stroke-width="15"/></svg>`,
  )
).asPng();
const hash = await sha256(image);
const descriptor = finalizeEvent(
  {
    kind: 32267,
    created_at: base.created_at,
    content: 'Offline preview test',
    tags: [
      ['d', 'preview-test'],
      ['name', 'Linked preview test'],
      ['image', `https://images.example/${hash}`],
    ],
  },
  key,
);
const manifest = finalizeEvent(
  {
    ...base,
    tags: base.tags
      .filter((t) => !['d', 'title'].includes(t[0]))
      .concat([
        ['d', 'preview-test'],
        ['title', 'Linked preview test'],
        ['app', `32267:${descriptor.pubkey}:preview-test`, 'wss://relay.example'],
      ]),
  },
  key,
);
const result = await refreshPublicCatalog(directory, {
  relays: [],
  discover: async () => [manifest],
  metadata: async () => (process.argv[3] === 'without-preview' ? [] : [descriptor]),
  download: async () =>
    new Uint8Array(
      await Bun.file(
        `packages/backend/data/artifacts/${records[0].artifactHash}.html`,
      ).arrayBuffer(),
    ),
  previewDownload: async () => image,
});
await Bun.write(join(directory, 'fixture.json'), JSON.stringify(result.cache!.entries[0]));
