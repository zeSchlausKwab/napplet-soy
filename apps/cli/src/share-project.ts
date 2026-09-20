import { join } from 'node:path';
import { committedSource } from '../../../packages/publish/src/git-source';
import { publishProject, type PublishOptions } from '../../../packages/publish/src';
import { propose, type CollaborationOptions } from '../../../packages/collaboration/src/service';
import { buildProject } from './toolchain';
import { syncBackend } from './backend';
import { Accounts } from '../../../packages/identity/src/accounts';
import { checkPublication } from './publish-check';

export async function buildForSharing(directory: string, signal?: AbortSignal) {
  await committedSource(directory);
  if ((await Bun.file(join(directory, 'napplet.json')).json()).entry === 'dist/index.html')
    await buildProject(directory, signal);
}
export async function publishFromProject(options: PublishOptions) {
  if (!options.dryRun && !options.resume) {
    await committedSource(options.directory);
    await syncBackend(
      options.directory,
      options.network,
      options.accounts ?? new Accounts(options.network),
      { signal: options.signal, onAuth: options.onAuth },
      false,
    );
    await buildForSharing(options.directory, options.signal);
  }
  return publishProject(options);
}
export async function proposeFromProject(
  options: CollaborationOptions & {
    description: string;
    resume?: boolean;
    check?: PublishOptions['check'];
  },
) {
  if (!options.resume) await buildForSharing(options.directory, options.signal);
  return propose({ ...options, check: options.check ?? checkPublication });
}
