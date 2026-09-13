import { dirname, join } from 'node:path';
import { realpathSync } from 'node:fs';

declare const NAPPLET_STANDALONE: boolean | undefined;
declare const NAPPLET_CLI_VERSION: string | undefined;
export const standalone = typeof NAPPLET_STANDALONE !== 'undefined' && NAPPLET_STANDALONE;
export const version =
  typeof NAPPLET_CLI_VERSION === 'undefined' ? '0.1.0-dev' : NAPPLET_CLI_VERSION;
export const commandName = standalone ? 'napplet-space' : 'bun run napplet';

export function playwrightDirectory() {
  if (standalone) return join(dirname(realpathSync(process.execPath)), 'lib/playwright-core');
  return dirname(
    Bun.resolveSync(
      'playwright-core/package.json',
      Bun.resolveSync('@playwright/test', import.meta.dir),
    ),
  );
}
