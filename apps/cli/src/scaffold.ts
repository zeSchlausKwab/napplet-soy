import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { examples, exampleHtml } from '../../../packages/examples/artifact';

export async function scaffold(parent: string, name: string, template: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name))
    throw new Error('Choose a folder name using lowercase letters, numbers, and hyphens.');
  if (!examples.some((e) => e.slug === template))
    throw new Error(`Unknown template. Choose: ${examples.map((e) => e.slug).join(', ')}`);
  const target = resolve(parent, name);
  // Fail atomically if anything already occupies the destination; never overwrite a project.
  await mkdir(target);
  await mkdir(resolve(target, '.napplet'));
  const built = await Bun.build({
    entrypoints: [new URL('../../../packages/runtime/src/index.ts', import.meta.url).pathname],
    target: 'bun',
    format: 'esm',
    minify: true,
  });
  if (!built.success) throw new Error('Could not prepare the shared preview runtime.');
  await writeFile(resolve(target, '.napplet/runtime.js'), await built.outputs[0].text());
  await writeFile(resolve(target, 'index.html'), exampleHtml(template));
  await writeFile(
    resolve(target, 'dev.ts'),
    await readFile(new URL('../templates/dev.template', import.meta.url), 'utf8'),
  );
  await writeFile(
    resolve(target, 'napplet.json'),
    JSON.stringify(
      { schema: 'space-local-project/v1', name, template, entry: 'index.html', license: 'MIT' },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    resolve(target, 'package.json'),
    JSON.stringify(
      { name, private: true, type: 'module', scripts: { dev: 'bun --hot dev.ts' } },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    resolve(target, 'AGENTS.md'),
    `# ${name}\n\nBuild a small, self-contained creative experiment in index.html.\n\n- All playable JavaScript, CSS, fonts, images, and audio must be embedded in index.html.\n- No CDN imports, network requests, WebSockets, service workers, forms, popups, or access to the parent window.\n- The player is a sandboxed iframe with scripts enabled and an opaque origin. Do not require localStorage.\n- Use canvas, inline SVG, DOM, Web Audio after a user gesture, or embedded data URLs.\n- Keep the package under 10 MiB. Support pointer and touch; respect reduced motion where practical.\n- Run bun run dev for the same restricted preview runtime as napplet.space.\n- Preserve license notices and credit when remixing. Never place private signing keys in this project.\n\nAsk what the creator wants to make, then start with a small visible change.\n`,
  );
  await writeFile(resolve(target, 'CLAUDE.md'), '@AGENTS.md\n');
  await writeFile(resolve(target, '.gitignore'), 'node_modules/\n.env\n.env.*\n.DS_Store\n');
  await writeFile(
    resolve(target, 'LICENSE'),
    `MIT License\n\nCopyright (c) 2026 napplet.space contributors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n`,
  );
  await writeFile(
    resolve(target, 'README.md'),
    `# ${name}\n\nA local napplet based on ${template}, from the Space lab starter collection.\n\nRun \`bun run dev\`, open http://localhost:4173, and edit \`index.html\` with your favorite coding agent. The preview reloads when the artifact changes. No dependency install is required.\n\nThe HTML is both the source and playable artifact. Keep it self-contained. Public publishing, managed Git hosting, and identity provisioning are not available in this initial local CLI.\n`,
  );
  const git = Bun.spawn(['git', 'init', '--initial-branch=main', target], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if ((await git.exited) !== 0)
    throw new Error(
      `Files created at ${target}, but Git initialization failed. Run git init in that folder.`,
    );
  return target;
}
