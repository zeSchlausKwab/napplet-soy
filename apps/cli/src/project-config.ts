import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { realpath as realDirectory } from 'node:fs/promises';
import {
  PublishError,
  projectSchema,
  resolveTargets,
  type Project,
} from '../../../packages/publish/src/config';
import { inspectProject, regularFile } from '../../../packages/publish/src/project';
import type { Network } from '../../../packages/identity/src/signer';
import { checkPublication } from './publish-check';

async function readProject(directory: string) {
  const root = await realDirectory(directory);
  const bytes = await regularFile(root, 'napplet.json', 16384);
  try {
    return {
      root,
      bytes,
      project: projectSchema.parse(JSON.parse(new TextDecoder().decode(bytes))),
    };
  } catch {
    throw new PublishError('PROJECT_CONFIG', 'Invalid napplet.json.');
  }
}
async function saveProject(root: string, original: Uint8Array, project: Project) {
  if (!Buffer.from(await regularFile(root, 'napplet.json', 16384)).equals(Buffer.from(original)))
    throw new PublishError(
      'PROJECT_CHANGED',
      'Configuration changed while checking. Retry with the current file.',
    );
  const temporary = join(root, `.napplet-config-${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(project, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, join(root, 'napplet.json'));
  } finally {
    await rm(temporary, { force: true });
  }
}

/** No account, build, signing or network access is needed to inspect destinations. */
export async function projectConfiguration(
  directory: string,
  network: Network,
  initialize = false,
) {
  const { root, bytes, project } = await readProject(directory);
  const targets = resolveTargets(project, network);
  if (initialize) {
    project.publish = {
      ...project.publish,
      networks: { ...project.publish?.networks, [network]: targets },
    };
    await saveProject(root, bytes, project);
  }
  return {
    file: join(root, 'napplet.json'),
    network,
    targets,
    runtime: { relays: project.relays, servers: project.servers },
    preview: project.preview?.image
      ? { image: project.preview.image }
      : { capture: 'automatic', delayMs: project.preview?.delayMs ?? 1500 },
  };
}

/** Save a reviewable project image without overwriting an existing asset or publishing anything. */
export async function screenshotProject(directory: string, network: Network, name = 'preview.png') {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}\.png$/.test(name))
    throw new PublishError(
      'PREVIEW_PATH',
      'Choose a PNG filename in the project root, such as preview-2.png.',
    );
  const { root, bytes, project } = await readProject(directory);
  const { plan, contents, fingerprint } = await inspectProject(
    root,
    network,
    project.creator?.pubkey ?? '0'.repeat(64),
  );
  const checked = await checkPublication(contents, true);
  if ((await inspectProject(root, network, plan.pubkey)).fingerprint !== fingerprint)
    throw new PublishError(
      'PROJECT_CHANGED',
      'Source changed during capture. Build and capture again.',
    );
  const path = join(root, name);
  try {
    await writeFile(path, checked.preview, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new PublishError(
        'PREVIEW_EXISTS',
        'This image already exists. Use screenshot preview-2.png to keep it and capture a new image.',
      );
    throw error;
  }
  try {
    project.preview = { ...project.preview, image: name };
    await saveProject(root, bytes, project);
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  }
  return {
    image: path,
    artifactHash: plan.artifactHash,
    bytes: checked.preview.length,
    selected: 'preview.image in napplet.json',
  };
}
