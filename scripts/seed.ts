import { mkdir } from 'node:fs/promises';
import { finalizeEvent, getPublicKey, getEventHash, type EventTemplate } from 'nostr-tools';
import { examples, exampleHtml, examplePoster } from '../packages/examples/artifact';
import {
  aggregateHash,
  sha256,
  encodeAddress,
  validateRelease,
  verifiedEvent,
} from '../packages/protocol/src';

// Public, deterministic fixture identity. Never use this key for a real account.
const fixtureKey = new Uint8Array(32).fill(0);
fixtureKey[31] = 1;
const pubkey = getPublicKey(fixtureKey);
export async function seedExamples(root = new URL('../', import.meta.url)) {
  const started = performance.now();
  let writes = 0;
  async function writeIfChanged(path: string, content: string) {
    const file = Bun.file(new URL(path, root));
    if ((await file.exists()) && (await file.text()) === content) return;
    await Bun.write(file, content);
    writes++;
  }
  const previous = new Map<string, unknown>();
  try {
    for (const record of await Bun.file(
      new URL('packages/backend/data/catalog.json', root),
    ).json()) {
      for (const event of [record.current, record.snapshot]) previous.set(event.id, event);
    }
  } catch {
    /* First run, or a damaged fixture catalog that will be repaired below. */
  }
  function sign(template: EventTemplate) {
    const id = getEventHash({ ...template, pubkey });
    try {
      return verifiedEvent(previous.get(id));
    } catch {
      return verifiedEvent(finalizeEvent(template, fixtureKey));
    }
  }
  await mkdir(new URL('packages/backend/data/artifacts/', root), { recursive: true });
  await mkdir(new URL('apps/web/public/posters/', root), { recursive: true });
  const catalog = [];
  for (const [index, example] of examples.entries()) {
    const html = exampleHtml(example.slug);
    const hash = await sha256(html);
    const aggregate = await aggregateHash([{ path: '/index.html', hash }]);
    const identifier = ['orbit', 'tennis', 'plasma', 'blob', 'button', 'rain'][index];
    const identity = { kind: 35129, pubkey, identifier } as const;
    const tags = [
      ['path', '/index.html', hash],
      ['x', aggregate, 'aggregate'],
      ['title', example.title],
      ['description', example.description],
      ...example.topics.map((topic) => ['t', topic]),
    ];
    const snapshot = sign({
      kind: 5129,
      content: '',
      created_at: 1789128000 + index,
      tags: [...tags, ['a', `35129:${pubkey}:${identifier}`]],
    });
    const current = sign({
      kind: 35129,
      content: '',
      created_at: snapshot.created_at,
      tags: [...tags, ['d', identifier]],
    });
    await validateRelease(current, snapshot);
    await writeIfChanged(`packages/backend/data/artifacts/${hash}.html`, html);
    await writeIfChanged(`apps/web/public/posters/${example.slug}.svg`, examplePoster(example));
    catalog.push({
      ...example,
      handle: 'space-lab',
      creator: 'Space lab',
      identifier,
      pubkey,
      naddr: encodeAddress(identity),
      artifactHash: hash,
      bytes: new TextEncoder().encode(html).length,
      current,
      snapshot,
      license: 'MIT',
      fixture: true,
    });
  }
  await writeIfChanged(
    'packages/backend/data/catalog.json',
    JSON.stringify(catalog, null, 2) + '\n',
  );
  return { count: catalog.length, writes, milliseconds: Math.round(performance.now() - started) };
}
if (import.meta.main) console.log('Local examples:', await seedExamples());
