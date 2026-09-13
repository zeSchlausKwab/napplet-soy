import { expect, test } from 'bun:test';
import { checkPublication } from '../../apps/cli/src/publish-check';

test('publication startup rejects script failures and direct networking, then accepts a working isolated creation', async () => {
  const config = new TextEncoder().encode(
    JSON.stringify({
      previewId: crypto.randomUUID(),
      entry: 'index.html',
      requires: [],
      relays: [],
      servers: [],
    }),
  );
  const contents = (html: string) =>
    new Map([
      ['napplet.json', config],
      ['index.html', new TextEncoder().encode(html)],
    ]);
  for (const html of [
    '<!doctype html><script>throw new Error("Broken creation")</script>',
    '<!doctype html><img src="https://must-not-contact.invalid/image.png">',
  ])
    await expect(checkPublication(contents(html))).rejects.toMatchObject({ code: 'BROWSER_CHECK' });
  expect(await checkPublication(contents('<!doctype html><p>Working creation</p>'))).toMatchObject({
    profile: 'space-playback-1',
  });
}, 30000);
