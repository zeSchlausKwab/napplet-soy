import { lstatSync, realpathSync, statSync } from 'node:fs';

export function previousRelease(current: string): string {
  let entry;
  try {
    entry = lstatSync(current);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
  if (!entry.isSymbolicLink()) throw new Error('The active release must be a symlink.');
  const previous = realpathSync(current);
  if (!statSync(previous).isDirectory()) throw new Error('The active release must be a directory.');
  return previous;
}

export function graspReady(response: string, version: string, name: string): boolean {
  try {
    const info = JSON.parse(response);
    return info?.version === version && info?.name === name;
  } catch {
    return false;
  }
}

if (import.meta.main) {
  try {
    if (process.argv[2] === 'previous' && process.argv[3]) {
      console.log(previousRelease(process.argv[3]));
    } else if (process.argv[2] === 'grasp' && process.argv[3] && process.argv[4]) {
      process.exit(graspReady(await Bun.stdin.text(), process.argv[3], process.argv[4]) ? 0 : 1);
    } else {
      throw new Error('Usage: deploy-state.ts previous <current> | grasp <version> <name>');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
