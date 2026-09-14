import { expect, test } from 'bun:test';
import { builtConfiguration } from './artifact';

test('publisher reads the upstream static schema and rejects unsupported constructs before launching a browser', async () => {
  const html = (schema: unknown) =>
    new TextEncoder().encode(
      `<meta name="napplet-config-schema" content='${JSON.stringify(schema)}'>`,
    );
  expect(await builtConfiguration(new TextEncoder().encode('<p>No settings</p>'))).toBeNull();
  expect(
    await builtConfiguration(
      html({ type: 'object', properties: { text: { type: 'string', default: 'a &amp; b' } } }),
    ),
  ).toMatchObject({ properties: { text: { default: 'a & b' } } });
  for (const property of [
    { type: 'string', $ref: '#/definitions/x' },
    { type: 'string', pattern: 'x' },
    { type: 'string', 'x-napplet-secret': true, default: 'bad' },
  ])
    await expect(
      builtConfiguration(html({ type: 'object', properties: { value: property } })),
    ).rejects.toMatchObject({ code: 'CONFIG_SCHEMA' });
  const single = html({ type: 'object' });
  await expect(builtConfiguration(new Uint8Array([...single, ...single]))).rejects.toMatchObject({
    code: 'CONFIG_SCHEMA',
  });
});
