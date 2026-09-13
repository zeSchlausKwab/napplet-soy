import { mkdir, rename, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import pin from '../services/grasp/upstream.json';

const root = resolve(import.meta.dir, '..');
const workspace = resolve(root, '.local/grasp-build');
export const graspBinary = resolve(root, '.local/bin/ngit-grasp');
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export async function graspBuildID() {
  return digest(
    JSON.stringify(pin) +
      process.platform +
      process.arch +
      (await Bun.file(import.meta.path).text()),
  ).slice(0, 16);
}
export async function graspVersion() {
  return `${pin.version}-${pin.commit.slice(0, 8)}+space.${await graspBuildID()}`;
}
async function command(
  args: string[],
  cwd: string,
  capture = false,
  extra: Record<string, string> = {},
) {
  const child = Bun.spawn(args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      ...extra,
    },
    stdout: capture ? 'pipe' : 'inherit',
    stderr: 'inherit',
  });
  const output = capture ? await new Response(child.stdout as ReadableStream).text() : '';
  if ((await child.exited) !== 0)
    throw new Error(`GRASP build command failed: ${args[0]} ${args[1] ?? ''}`);
  return output.trim();
}
/** Pinned upstream with narrow, checksum-guarded deployment guards. No shared cache edits. */
export async function buildGrasp(output = graspBinary) {
  const build = await graspBuildID();
  if (
    (await Bun.file(output).exists()) &&
    (await Bun.file(`${output}.build`).exists()) &&
    (await Bun.file(`${output}.build`).text()) === build
  )
    return build;
  if (!['darwin', 'linux'].includes(process.platform))
    throw new Error('GRASP builds support macOS and Linux.');
  await mkdir(workspace, { recursive: true });
  const lock = new Database(resolve(workspace, 'build.sqlite'), { create: true });
  try {
    lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');
  } catch {
    lock.close();
    throw new Error('Another GRASP build is running in this checkout.');
  }
  try {
    const installed = await command(['rustc', '--version'], root, true).catch(() => '');
    if (!installed.startsWith(`rustc ${pin.rust} `))
      throw new Error(
        `GRASP requires Rust ${pin.rust}. Install/select it with rustup, then retry. The VPS script installs the pinned compiler automatically.`,
      );
    const source = resolve(workspace, 'source');
    if (!(await Bun.file(resolve(source, '.git/HEAD')).exists()))
      await command(
        ['git', 'clone', '--depth', '1', '--branch', `v${pin.version}`, pin.repository, source],
        root,
      );
    const commit = await command(['git', 'rev-parse', 'HEAD'], source, true);
    if (commit !== pin.commit)
      throw new Error('GRASP source revision does not match the reviewed pin.');
    await command(['git', 'restore', '--source', pin.commit, '--worktree', '.'], source);
    if (digest(await Bun.file(resolve(source, 'Cargo.lock')).bytes()) !== pin.cargoLockSha256)
      throw new Error('GRASP Cargo.lock changed.');
    const patches = [
      {
        path: 'src/main.rs',
        sha: 'ec509e7b522b74b1ec175acc5a3f29a3585cbdb9a4669af41878205ac5db5c84',
        apply: (source: string) =>
          source
            .replace('use anyhow::Result;', 'use anyhow::{Context, Result};')
            .replace(
              'dotenvy::dotenv().ok();',
              'if std::env::var("SPACE_GRASP_LOCAL_ONLY").as_deref() != Ok("1") { dotenvy::dotenv().ok(); }',
            )
            .replace(
              'let mut config = *config;',
              `let mut config = *config;
            // One writer owns the complete working-directory state, including key generation.
            let state_lock = std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(".napplet-service.lock")?;
            fs2::FileExt::try_lock_exclusive(&state_lock).context("GRASP state directory is already in use")?;
            let local_only = std::env::var("SPACE_GRASP_LOCAL_ONLY").as_deref() == Ok("1");
            if local_only {
                config.sync_bootstrap_relay_url = None;
                config.user_index_relays.clear();
                config.sync_plus_fallback_relays.clear();
                config.sync_plus_enabled = false;
                config.sync_allow_non_global_targets = true;
            }`,
            )
            .replace(
              'config.relay_owner_nsec = Some(Config::load_relay_owner_key()?);',
              'config.relay_owner_nsec = Some(if local_only { Config::load_or_generate_relay_owner_key()? } else { Config::load_relay_owner_key()? });',
            ),
      },
      {
        path: 'src/outbound.rs',
        sha: 'bf4bf54bcd5dc8e2e14065ea72eb45de0b73cfe5b0472a250c2fb764f4eb0bea',
        apply: (source: string) =>
          source.replace(
            'let url = Url::parse(raw_url).map_err(|error| format!("invalid URL: {error}"))?;',
            `let url = Url::parse(raw_url).map_err(|error| format!("invalid URL: {error}"))?;
        if std::env::var("SPACE_GRASP_LOCAL_ONLY").as_deref() == Ok("1") {
            let loopback = match url.host() {
                Some(Host::Ipv4(ip)) => ip == Ipv4Addr::LOCALHOST,
                Some(Host::Ipv6(ip)) => ip == Ipv6Addr::LOCALHOST,
                _ => false,
            };
            if !loopback { return Err("Local GRASP only connects to literal loopback targets".to_string()); }
        }`,
          ),
      },
      {
        path: 'src/http/nip11.rs',
        sha: 'e5ffd80e3310c75ef1bcad791d22b0ecaa438bb48fbe12f28935dc3104070003',
        apply: (source: string) =>
          source.replace(
            'Some(commit) => format!("{}-{}", env!("CARGO_PKG_VERSION"), commit),',
            'Some(commit) => format!("{}-{}+space.{}", env!("CARGO_PKG_VERSION"), commit, env!("SPACE_GRASP_BUILD_ID")),',
          ),
      },
    ];
    for (const patch of patches) {
      const path = resolve(source, patch.path);
      const text = await Bun.file(path).text();
      if (digest(text) !== patch.sha) throw new Error(`Pinned GRASP file changed: ${patch.path}`);
      const patched = patch.apply(text);
      if (patched === text) throw new Error(`GRASP patch did not apply: ${patch.path}`);
      await Bun.write(path, patched);
    }
    await command(
      [
        'cargo',
        'build',
        '--locked',
        '--release',
        '-p',
        'ngit-grasp',
        '-j',
        process.env.CARGO_BUILD_JOBS || '4',
      ],
      source,
      false,
      {
        CARGO_TARGET_DIR: resolve(workspace, 'target'),
        CARGO_INCREMENTAL: '0',
        CARGO_PROFILE_RELEASE_DEBUG: '0',
        CARGO_PROFILE_RELEASE_STRIP: 'debuginfo',
        NGIT_BUILD_REVISION: pin.commit,
        SPACE_GRASP_BUILD_ID: build,
      },
    );
    await mkdir(resolve(output, '..'), { recursive: true });
    const temporary = `${output}.${process.pid}.tmp`;
    await copyFile(resolve(workspace, 'target/release/ngit-grasp'), temporary);
    await rename(temporary, output);
    await Bun.write(`${output}.build`, build);
    return build;
  } finally {
    lock.close();
  }
}
if (import.meta.main) console.log('GRASP build:', await buildGrasp(process.argv[2]));
