import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

// Review the upstream changes before running this against clean, pinned checkouts.
const { values } = parseArgs({
  options: { boilerplate: { type: 'string' }, skills: { type: 'string' } },
});
async function snapshot(directory: string, repository: string, skills = false) {
  async function git(...args: string[]) {
    const child = Bun.spawn(['git', '-C', directory, ...args], { stdout: 'pipe', stderr: 'pipe' });
    const output = await new Response(child.stdout).text();
    if (await child.exited) throw new Error('Cannot read upstream checkout');
    return output;
  }
  if ((await git('status', '--porcelain')).trim()) throw new Error('Use a clean upstream checkout');
  const revision = (await git('rev-parse', 'HEAD')).trim();
  const tree = await git('ls-tree', '-r', 'HEAD');
  const files: Record<string, string> = {};
  for (const line of tree.trim().split('\n')) {
    const [metadata, path] = line.split('\t');
    if (skills && path !== 'LICENSE' && !/^skills\/napplet-[a-z]+\/SKILL\.md$/.test(path)) continue;
    if (!metadata.startsWith('100644 ') || /(^|\/)\.\.?($|\/)|[\s\\]/.test(path))
      throw new Error(`Unsupported upstream file: ${path}`);
    files[path] = await git('show', `HEAD:${path}`);
  }
  return { repository, revision, files };
}
if (!values.boilerplate || !values.skills)
  throw new Error('Provide --boilerplate and --skills checkout paths');
const directory = resolve(import.meta.dir, '../apps/cli/vendor');
await mkdir(directory, { recursive: true });
await Bun.write(
  resolve(directory, 'boilerplate.json'),
  JSON.stringify(
    await snapshot(values.boilerplate, 'https://github.com/napplet/boilerplate'),
    null,
    2,
  ) + '\n',
);
await Bun.write(
  resolve(directory, 'skills.json'),
  JSON.stringify(
    await snapshot(values.skills, 'https://github.com/napplet/napplet', true),
    null,
    2,
  ) + '\n',
);
console.log('Saved exact upstream file contents and revisions. Review the diff before release.');
