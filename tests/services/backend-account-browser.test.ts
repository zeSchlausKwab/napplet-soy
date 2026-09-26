import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initModule } from '../../apps/cli/src/dynamic-backend';
import { backendProject, localBackend } from '../../apps/cli/src/backend';
import { startPreviewServer } from '../../apps/cli/src/preview/server';
import { previewAssets } from '../../apps/cli/src/preview/assets';
import { browserEngine } from '../../apps/cli/src/browser';
import { connectTestIdentity, approveTestBackendAccount } from '../../apps/cli/src/test-identity';
import client from '../../apps/cli/templates/backend-client.ts.txt' with { type: 'text' };

test('a real extension approval longer than 15 seconds creates once through the supplied client', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soy-slow-approval-'));
  await initModule(directory);
  await Bun.write(
    join(directory, 'napplet.json'),
    JSON.stringify({
      schema: 'space-local-project/v1',
      name: 'Slow approval fixture',
      identifier: 'slow-approval',
      entry: 'index.html',
      previewId: crypto.randomUUID(),
      license: 'MIT',
      requires: ['cvm'],
      backend: { boards: [], modules: ['backend/backend.json'] },
    }),
  );
  const context = (await backendProject(directory))!;
  const script = new Bun.Transpiler({ loader: 'ts' })
    .transformSync(client)
    .replace(/\bexport /g, '');
  await Bun.write(
    join(directory, 'index.html'),
    `<!doctype html><button id="create">Create</button><output id="result"></output><script>
    ${script}
    const api=backendClient(window.napplet);
    const module={napplet:${JSON.stringify(context.napplet)},name:'main'};
    document.querySelector('#create').onclick=async()=>{
      try {
        const description=await api.describe(module);
        const intent=api.intent({module,release:description.active},'create',{});
        const first=await api.invoke(intent);
        const retry=await api.invoke(intent);
        document.querySelector('#result').textContent=JSON.stringify({value:first.result.value,same:first.instance===retry.instance && first.revision===retry.revision});
      } catch(error) { document.querySelector('#result').textContent=error.message; }
    };
  </script>`,
  );
  const backend = (await localBackend(directory))!;
  const server = startPreviewServer(
    pathToFileURL(directory + '/'),
    0,
    false,
    await previewAssets(),
    {
      network: 'local',
      backend: backend.provider,
    },
  );
  const browser = await (await browserEngine()).chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(server.url.href);
    const frame = page.frameLocator('iframe');
    await frame.locator('#create').waitFor();
    await connectTestIdentity(page, server.url.href);
    await page.evaluate(() => {
      const signer = (window as any).nostr;
      const original = signer.signEvent;
      signer.signEvent = async (event: unknown) => {
        await new Promise((resolve) => setTimeout(resolve, 16000));
        return original(event);
      };
    });
    await frame.locator('#create').click();
    await approveTestBackendAccount(page, 'main', backend.provider.pubkey);
    await frame.locator('#result').filter({ hasText: /./ }).waitFor({ timeout: 25000 });
    expect(await frame.locator('#result').textContent()).toBe('{"value":0,"same":true}');
  } finally {
    await browser.close();
    server.stop(true);
    await backend.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 45000);
