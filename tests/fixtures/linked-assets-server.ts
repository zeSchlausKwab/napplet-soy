import { finalizeEvent, matchFilters, verifyEvent } from 'nostr-tools';
import { commentTemplate, likeTemplate, socialScope } from '../../packages/protocol/src/social';
import records from '../../packages/backend/data/catalog.json';
// Offline Blossom used by browser tests. Public test key; never target a live server.
import { join } from 'node:path';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { createBlossom } from '../../services/blossom/server';
import { uploadBlob } from '../../packages/blossom/src/client';

const directory = process.argv[2];
if (!directory) throw new Error('Expected test directory');
const service = await createBlossom({
  directory: join(directory, 'blossom'),
  origin: 'http://127.0.0.1:19348',
  local: true,
  port: 0,
  instance: 'asset-test',
  build: 'asset-test',
});
const events: any[] = [],
  wire: any[] = [];
const relay = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request, server) {
    if (server.upgrade(request)) return;
    if (new URL(request.url).pathname === '/wire') return Response.json(wire);
    return new Response('', { status: 404 });
  },
  websocket: {
    message(ws, raw) {
      const message = JSON.parse(String(raw));
      wire.push(message);
      if (message[0] === 'REQ') {
        for (const event of events.filter((e) => matchFilters(message.slice(2), e)))
          ws.send(JSON.stringify(['EVENT', message[1], event]));
        ws.send(JSON.stringify(['EOSE', message[1]]));
      }
      if (message[0] === 'EVENT') {
        const event = message[1];
        const valid = verifyEvent(event);
        if (valid && !events.some((e) => e.id === event.id)) events.push(event);
        ws.send(JSON.stringify(['OK', event.id, valid, valid ? '' : 'invalid']));
      }
    },
  },
});
try {
  const origin = `http://127.0.0.1:${service.server.port}`;
  const fixture = Bun.spawn(['bun', 'tests/fixtures/linked-preview.ts', directory, 'assets'], {
    env: {
      ...process.env,
      FIXTURE_ASSET_ORIGIN: origin,
      FIXTURE_RELAY_ORIGIN: `ws://127.0.0.1:${relay.port}`,
    },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (await fixture.exited) throw new Error('Fixture generation failed');
  const key = new Uint8Array(32);
  key[31] = 1;
  const signer = new PrivateKeySigner(key);
  for (const [path, type] of [
    [join(directory, 'original.png'), 'image/png'],
    [`packages/backend/data/artifacts/${records[0].artifactHash}.html`, 'text/html'],
    ['tests/fixtures/preview.webm', 'video/webm'],
    [join(directory, 'source/source.tar'), 'application/x-tar'],
  ])
    await uploadBlob({ origin, type, bytes: await Bun.file(path).bytes(), signer, local: true });
  const entry = await Bun.file(join(directory, 'fixture.json')).json();
  const now = Math.floor(Date.now() / 1000);
  const sign = (template: any) => finalizeEvent(template, key);
  const profile = sign({
    kind: 0,
    created_at: now,
    tags: [],
    content: JSON.stringify({ name: 'Independent creator', picture: entry.preview.url }),
  });
  const comment = sign(
    commentTemplate(
      socialScope(entry.manifest),
      'A comment read directly from the relay.',
      undefined,
      now,
    ),
  );
  events.push(
    entry.manifest,
    entry.preview.descriptor,
    profile,
    comment,
    sign(likeTemplate(socialScope(entry.manifest), entry.manifest, now)),
  );
  await Bun.write(
    join(directory, 'relay.json'),
    JSON.stringify({ url: `ws://127.0.0.1:${relay.port}`, pubkey: profile.pubkey }),
  );
  console.log(`Assets listening on ${origin}`);
  await new Promise<void>((done) => {
    process.once('SIGTERM', done);
    process.once('SIGINT', done);
  });
} finally {
  relay.stop(true);
  await service.close(true);
}
