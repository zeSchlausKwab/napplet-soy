import { dirname, join } from 'node:path';
import { realpathSync } from 'node:fs';
import { release as kernelRelease } from 'node:os';
import { AccountError } from '../../../packages/identity/src/signer';
import release from '../distribution/version.json';

declare const NAPPLET_STANDALONE: boolean | undefined;
declare const NAPPLET_CLI_VERSION: string | undefined;
export const standalone = typeof NAPPLET_STANDALONE !== 'undefined' && NAPPLET_STANDALONE;
export const version =
  typeof NAPPLET_CLI_VERSION === 'undefined' ? `${release.version}-dev` : NAPPLET_CLI_VERSION;
export const commandName = standalone ? 'soyli' : 'bun run soyli';

export function browserProfile(platform = process.platform, kernel = kernelRelease()) {
  if (platform === 'darwin') {
    // Darwin 21 = Monterey, 22 = Ventura. The current Playwright registry has
    // no Chromium downloads for either; use a matching driver, not just an old binary.
    const major = Number(kernel.split('.')[0]);
    if (!Number.isInteger(major) || major < 21)
      throw new AccountError(
        'BROWSER_OS',
        'soyLI browser checks and captures require macOS 12 or newer. Project editing does not require this browser.',
      );
    if (major < 23) return 'mac-compat';
  }
  return 'current';
}

export function playwrightDirectory(profile: 'current' | 'mac-compat' = browserProfile()) {
  const name = profile === 'mac-compat' ? 'playwright-core-mac-compat' : 'playwright-core';
  if (standalone) return join(dirname(realpathSync(process.execPath)), 'lib', name);
  if (profile === 'mac-compat')
    return dirname(Bun.resolveSync(`${name}/package.json`, import.meta.dir));
  return dirname(
    Bun.resolveSync(
      'playwright-core/package.json',
      Bun.resolveSync('@playwright/test', import.meta.dir),
    ),
  );
}
