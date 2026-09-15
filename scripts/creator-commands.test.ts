import { expect, test } from 'bun:test';
import { createCommand, remixCommand } from '../apps/web/src/lib/creator-commands';

test('starter uses the installed CLI interface and preserves exact shell arguments', async () => {
  expect(createCommand()).toBe(
    'curl -fsSL https://napplet.soy/install.sh | sh -s -- new my-napplet',
  );
  const template = "custom'; $(printf injected) #";
  const command = createCommand(template).split(' | sh -s -- ')[1];
  const result = Bun.spawn(['/bin/sh', '-c', `set -- ${command}; printf '%s\n' "$@"`]);
  expect(await new Response(result.stdout).text()).toBe(
    `new\nmy-napplet\n--template\n${template}\n`,
  );
  expect(await result.exited).toBe(0);
});

test('remix commands keep source URLs literal and local mode limited to loopback hosts', async () => {
  const source = "https://napplet.soy/r/a'b?value=$(printf injected)";
  const installed = remixCommand(source, false);
  const result = Bun.spawn(['/bin/sh', '-c', `set -- ${installed}; printf '%s\n' "$@"`]);
  expect(await new Response(result.stdout).text()).toBe(
    `soyli\nremix\n${source}\nmy-remix\n`,
  );
  expect(await result.exited).toBe(0);
  for (const host of ['localhost', '127.0.0.1', '[::1]'])
    expect(remixCommand(`http://${host}:8080/r/123`)).toEndWith('--network local');
  expect(remixCommand('https://localhost.example/r/123')).not.toContain('--network');
});
