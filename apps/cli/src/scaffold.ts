import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { requireGit } from './prerequisites';
import { examples, exampleHtml } from '../../../packages/examples/artifact';

export class ScaffoldInputError extends Error {}

export async function scaffold(parent: string, name: string, template: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name))
    throw new ScaffoldInputError(
      'Choose a folder name using lowercase letters, numbers, and hyphens.',
    );
  if (!examples.some((e) => e.slug === template))
    throw new ScaffoldInputError(
      `Unknown template. Choose: ${examples.map((e) => e.slug).join(', ')}`,
    );
  await requireGit();
  const target = resolve(parent, name);
  // Fail atomically if anything already occupies the destination; never overwrite a project.
  await mkdir(target);
  await writeFile(resolve(target, 'index.html'), exampleHtml(template));
  const previewId = crypto.randomUUID();
  await writeFile(
    resolve(target, 'napplet.json'),
    JSON.stringify(
      {
        schema: 'space-local-project/v1',
        name,
        template,
        entry: 'index.html',
        previewId,
        identifier: `n-${previewId.replaceAll('-', '').slice(0, 11)}`,
        requires: [],
        relays: [],
        servers: [],
        license: 'MIT',
        topics: examples.find((e) => e.slug === template)!.topics,
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    resolve(target, 'package.json'),
    JSON.stringify(
      {
        name,
        private: true,
        type: 'module',
        scripts: {
          dev: 'napplet-space dev',
          check: 'napplet-space check',
          publish: 'napplet-space publish',
        },
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    resolve(target, 'AGENTS.md'),
    `# ${name}\n\nBuild a small, self-contained creative experiment in index.html.\n\n- Keep all executable JavaScript and CSS in index.html. Embed small assets; retrieve external byte resources only through napplet.resource.\n- No CDN imports, direct fetch/WebSockets, service workers, forms, popups, or parent-window access. Use host-mediated NAP APIs for resources and Nostr reads.\n- Await window.napplet.shell.ready() before using NAP APIs; use shell.supports(domain) for optional capabilities. Declare mandatory domains in napplet.json requires.\n- The player is an opaque sandbox. Use napplet.storage instead of localStorage. Listen to napplet.identity.onChanged when retaining account data in memory.\n- Use napplet.resource for assets, napplet.relay/outbox for reads, and napplet.fs for session files. Relays in napplet.json are an explicit allowlist; publishing/signing calls remain denied by the playback policy.\n- Use canvas, inline SVG, DOM, Web Audio after a user gesture, or embedded data URLs.\n- Keep the package under 10 MiB. Support pointer and touch; respect reduced motion where practical.\n- Run napplet-space dev for the same restricted preview runtime as napplet.soy. The preview and browser checks are provided by the installed CLI; no Bun or Node installation is needed.\n- Preserve license notices and credit when remixing. Never place private signing keys in this project.\n\nAsk what the creator wants to make, then start with a small visible change.\n`,
  );
  await writeFile(resolve(target, 'CLAUDE.md'), '@AGENTS.md\n');
  await writeFile(
    resolve(target, '.gitignore'),
    'node_modules/\n.napplet-space/\n.env\n.env.*\n.DS_Store\n',
  );
  await writeFile(
    resolve(target, 'LICENSE'),
    `MIT License\n\nCopyright (c) 2026 napplet.space contributors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n`,
  );
  await writeFile(
    resolve(target, 'README.md'),
    `# ${name}\n\nA local napplet based on ${template}, from the Space lab starter collection.\n\nRun \`napplet-space dev\`, open http://localhost:4173, and edit \`index.html\` with your favorite coding agent. The preview reloads when the artifact changes. No dependency install or separate Bun/Node runtime is required. Install the CLI from https://napplet.soy/create if needed. Git and an unlocked OS credential store are used for publishing; napplet-space doctor checks prerequisites.\n\nThe preview uses the same hash verification, srcdoc sandbox, pinned shim, NAP-SHELL handshake, and host services as the website. Await \`window.napplet.shell.ready()\` before calling host APIs. \`requires\` declares mandatory domains; \`relays\` configures allowed relay reads and \`servers\` supplies Blossom resource hints. Empty lists work for self-contained experiments. You can connect your browser extension to test identity changes; the preview never signs or publishes events.\n\nThe local \`previewId\` scopes your saves and is not a Nostr identity. Local bytes are trusted as your editable source and verified by hash in the browser; signature verification applies once a manifest is published. Files offered by napplet.fs stay in the preview session until you download them.\n\nEdit the optional lowercase topic labels in \`napplet.json\` as your idea evolves. They describe the creation, for example \`visual\`, \`generative\`, or \`game\`; they are not exclusive categories.\n\nThe HTML is both the source and playable artifact. Keep it self-contained. Creator identities are managed by the platform CLI account commands. A selected creator is recorded here only as a public key and network profile; keys and remote-signer credentials stay in your OS credential store. This public reference never authorizes a clone or remix to use another creator’s signer. Use \`napplet-space publish --dry-run\` to inspect the source and destinations, then omit --dry-run to publish. Add --network local to use the dev services. The publisher keeps frozen source and retry state in .napplet-space; keep that directory when moving the project. Publication returns a portable Nostr address and reports when the website has indexed it. Friendly named links are optional and do not affect public interoperability.\n`,
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
