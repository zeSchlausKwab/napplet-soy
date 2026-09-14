import { projectConfiguration, screenshotProject } from './project-config';
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { nip19 } from 'nostr-tools';
import { scaffold, ScaffoldInputError } from './scaffold';
import { Accounts, type Account } from '../../../packages/identity/src/accounts';
import {
  AccountError,
  defaultSignerRelays,
  type Network,
} from '../../../packages/identity/src/signer';
import { ask, hiddenInput as readHiddenInput, secretStdin } from './input';
import { publishProject, publicationStatus, PublishError } from '../../../packages/publish/src';
import { checkPublication } from './publish-check';
import { preview, checkProject, doctor } from './local';
import { installBrowser } from './browser';
import { commandName, version } from './distribution';
import { setupProject, buildProject, projectTool, installConformanceBrowser } from './toolchain';
import { installCreatorSkills } from './creator-kit';
import { loadRemix, createRemix } from '../../../packages/remix/src';

const help = `Usage:
  bun run napplet new <folder> [--template boilerplate] [--identity create|connect|later] [--no-install]
  bun run napplet remix <portable-link-or-nostr-id> <folder> [--identity create|connect|later]
  bun run napplet setup|build [--project <folder>]
  bun run napplet run <package-script> [arguments...]
  bun run napplet exec <project-tool> [arguments...]
  bun run napplet config [init] [--project <folder>]
  bun run napplet screenshot [preview.png] [--project <folder>]
  bun run napplet skills update [--project <folder>]
  bun run napplet account create|show|list|check|backup
  bun run napplet account connect [--stdin]
  bun run napplet account pair [--signer-relay <url>] [--timeout <seconds>] [--open]
  bun run napplet account import [--stdin]
  bun run napplet account use <npub-or-account-id>
  bun run napplet account export <new-recovery-file> [--passphrase-stdin]
  bun run napplet publish [--project <folder>] [--dry-run | --resume]
  bun run napplet status [--project <folder>] [--refresh]
  bun run napplet dev [--project <folder>] [--port 4173] [--no-open]
  bun run napplet check [--project <folder>]
  bun run napplet browser install
  bun run napplet doctor
  bun run napplet --version

All commands accept --network public|local and --json.
Create reuses your selected account. Connect accepts a hidden bunker link.
Pair creates a nostrconnect link and QR to approve in your signer (120-second wait).
Signer relays carry encrypted signing requests; they do not change publishing targets.
Create and new save a private nsec backup outside Git projects and report its path.
Account backup saves/reuses that file for an existing local creator. Keep it private.
Import accepts a hidden nsec or encrypted NIP-49 recovery key. With --stdin,
provide the key on line 1 and, for an encrypted key, its passphrase on line 2.
Export writes a passphrase-encrypted NIP-49 file outside Git projects.
Publish targets: --relay <url> --blossom <origin> --grasp <origin> --site <origin>
and optional repeated --mirror <url>. Local mode defaults to the dev services.
Secrets never belong in command arguments. Check/publish download a cached Chromium
browser when needed. Git and an unlocked OS credential store are needed to publish.`.replaceAll(
  'bun run napplet',
  commandName,
);
let json = process.argv.slice(2).includes('--json');
let createdProject: string | undefined;
const controller = new AbortController();
for (const [signal, code] of [
  ['SIGTERM', 143],
  ['SIGINT', 130],
] as const) {
  process.once(signal, () => {
    controller.abort();
    // Native keychain prompts cannot be aborted. The pending reservation is
    // recoverable even when we must exit before that OS operation returns.
    setTimeout(() => process.exit(code), 1000).unref();
  });
}
const hiddenInput = (label: string) => readHiddenInput(label, controller.signal);
const publicAccount = (a: Account, network: Network) => ({
  id: a.id,
  npub: nip19.npubEncode(a.pubkey),
  pubkey: a.pubkey,
  type: a.type,
  status: a.status,
  network,
});
try {
  const raw = process.argv.slice(2);
  if (raw[0] === 'run' || raw[0] === 'exec') {
    if (!raw[1] || raw[1].startsWith('-'))
      throw new AccountError('USAGE', 'Use run <package-script> or exec <project-tool>.');
    if (!(await Bun.file(join(process.cwd(), 'node_modules/.modules.yaml')).exists()))
      await setupProject(process.cwd(), controller.signal);
    if (raw[0] === 'run' && raw[1] === 'test:conformance')
      await installConformanceBrowser(process.cwd(), controller.signal);
    await projectTool(process.cwd(), raw, controller.signal);
    process.exit(0);
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        template: { type: 'string' },
        'no-install': { type: 'boolean' },
        identity: { type: 'string' },
        network: { type: 'string', default: 'public' },
        stdin: { type: 'boolean' },
        'passphrase-stdin': { type: 'boolean' },
        json: { type: 'boolean' },
        help: { type: 'boolean' },
        version: { type: 'boolean' },
        port: { type: 'string' },
        'no-open': { type: 'boolean' },
        project: { type: 'string' },
        'dry-run': { type: 'boolean' },
        resume: { type: 'boolean' },
        refresh: { type: 'boolean' },
        relay: { type: 'string' },
        blossom: { type: 'string' },
        grasp: { type: 'string' },
        site: { type: 'string' },
        mirror: { type: 'string', multiple: true },
        'signer-relay': { type: 'string', multiple: true },
        timeout: { type: 'string' },
        open: { type: 'boolean' },
      },
    });
  } catch {
    throw new AccountError(
      'USAGE',
      'Unknown or invalid option. Use --help. Secrets must be entered at the hidden prompt or through stdin.',
    );
  }
  const { values, positionals } = parsed;
  json = !!values.json;
  if (values.version) {
    console.log(json ? JSON.stringify({ version }) : `napplet-space ${version}`);
    process.exit(0);
  }
  if (values.help || !positionals.length) {
    console.log(help);
    process.exit(0);
  }
  if (!['public', 'local'].includes(values.network!))
    throw new AccountError('USAGE', 'Choose --network public or local.');
  const network = values.network as Network;
  const accounts = new Accounts(network);
  const onAuth = async (url: string) => {
    if (!process.stdin.isTTY || json)
      throw new AccountError(
        'SIGNER_AUTH',
        'Authorize this client in your remote signer, then retry interactively.',
      );
    process.stderr.write(`Approve this request in your signer: ${url}\n`);
  };
  const connect = async () =>
    accounts.connect(
      (values.stdin
        ? (await secretStdin())[0]
        : await hiddenInput('Paste bunker connection link (hidden): ')
      ).trim(),
      { signal: controller.signal, onAuth },
    );
  const backupNotice = (path: string) =>
    `Private-key backup: ${path}\nThis unencrypted nsec file is outside your project and readable only by your user. Preserve a private copy to recover your identity.`;
  const output = (account: Account | null, backupFile?: string) => {
    const data = account ? publicAccount(account, network) : null;
    if (json) console.log(JSON.stringify({ account: data, ...(backupFile ? { backupFile } : {}) }));
    else
      console.log(
        data
          ? `${data.npub}\n${data.type === 'local' ? 'Local key in OS credential store' : 'Remote signer'} · ${network} · ${data.status}`
          : 'No creator selected. Run account create or account connect.',
      );
    if (!json && backupFile) console.log(backupNotice(backupFile));
  };
  const [command, action, argument, ...extra] = positionals;
  if (
    (values['signer-relay'] || values.timeout || values.open) &&
    !(command === 'account' && action === 'pair')
  )
    throw new AccountError('USAGE', 'Use --signer-relay, --timeout and --open with account pair.');
  const publishingOptions =
    values['dry-run'] ||
    values.resume ||
    values.refresh ||
    values.relay ||
    values.blossom ||
    values.grasp ||
    values.site ||
    values.mirror;
  if (!['publish', 'status'].includes(command) && publishingOptions)
    throw new AccountError('USAGE', 'Publication options are only valid for publish/status.');
  if (
    (values['no-install'] && !['new', 'remix'].includes(command)) ||
    (values.project &&
      ![
        'publish',
        'status',
        'dev',
        'check',
        'setup',
        'build',
        'skills',
        'config',
        'screenshot',
      ].includes(command)) ||
    ((values.port || values['no-open']) && command !== 'dev')
  )
    throw new AccountError(
      'USAGE',
      'Use --project with dev/check/publish/status; --port and --no-open with dev.',
    );
  if (command === 'new' || command === 'remix') {
    if (
      !action ||
      (command === 'new' ? !!argument : !argument || !!values.template) ||
      extra.length ||
      values.stdin ||
      values['passphrase-stdin'] ||
      (values.identity && !['create', 'connect', 'later'].includes(values.identity))
    )
      throw new AccountError(
        'USAGE',
        'Use new <folder> [--template name] [--identity create|connect|later].',
      );
    const template = values.template ?? 'boilerplate';
    const folder = command === 'remix' ? argument! : action;
    const remix =
      command === 'remix'
        ? await createRemix(
            process.cwd(),
            folder,
            await loadRemix(
              action,
              network,
              AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
            ),
          )
        : undefined;
    const directory = remix?.directory ?? (await scaffold(process.cwd(), folder, template));
    if (remix) await installCreatorSkills(directory);
    createdProject = directory;
    let account = values.identity === 'later' ? null : await accounts.current();
    let identity = values.identity;
    if (!account && !identity && process.stdin.isTTY && !json) {
      const answer = (
        await ask(
          'Creator identity: [1] Create new [2] Connect existing [3] Set up later (1): ',
          controller.signal,
        )
      ).trim();
      if (!['', '1', '2', '3'].includes(answer))
        throw new AccountError(
          'USAGE',
          'Choose 1, 2 or 3 for creator setup. Your preview project is ready; use the account commands to finish setup.',
        );
      identity = answer === '2' ? 'connect' : answer === '3' ? 'later' : 'create';
    }
    if (identity === 'create') account = await accounts.create();
    if (identity === 'connect') account = await connect();
    if (identity === 'later') account = null;
    if (account) {
      const configPath = join(directory, 'napplet.json');
      const config = await Bun.file(configPath).json();
      config.creator = { pubkey: account.pubkey, network };
      await Bun.write(configPath, JSON.stringify(config, null, 2) + '\n');
    }
    const backupFile = account?.type === 'local' ? await accounts.backup(account.id) : undefined;
    // Report recovery information before dependency setup, which may be interrupted or fail.
    if (backupFile && !json) console.log(backupNotice(backupFile));
    if (!remix && template === 'boilerplate' && !values['no-install']) {
      await setupProject(directory, controller.signal);
      await buildProject(directory, controller.signal);
    }
    if (json)
      console.log(
        JSON.stringify({
          directory,
          account: account ? publicAccount(account, network) : null,
          ...(backupFile ? { backupFile } : {}),
          ...(remix ? { remix } : {}),
        }),
      );
    else
      console.log(
        `\nYour napplet is ready at ${directory}\n\n  cd ${folder}\n${remix?.needsSetup ? '  napplet-space setup\n' : ''}  napplet-space dev\n\nOpen your coding agent in that folder and make something weird.\n${account ? `Creator: ${nip19.npubEncode(account.pubkey)}` : 'Creator setup can be completed with account create or account connect.'}\nRun napplet-space publish to share it.`,
      );
  } else if (command === 'skills') {
    if (
      action !== 'update' ||
      argument ||
      extra.length ||
      values.template ||
      values.identity ||
      values.stdin ||
      values['passphrase-stdin']
    )
      throw new AccountError('USAGE', 'Use skills update [--project folder].');
    const result = await installCreatorSkills(values.project ?? process.cwd());
    console.log(
      json
        ? JSON.stringify(result)
        : `${result.updated.length} skill/support files updated. ${result.conflicts.length} edited files preserved.${result.conflicts.length ? '\n' + result.conflicts.join('\n') : ''}`,
    );
    if (result.conflicts.length) process.exitCode = 1;
  } else if (['dev', 'check', 'doctor', 'browser', 'setup', 'build'].includes(command)) {
    if (
      values.template ||
      values.identity ||
      values.stdin ||
      values['passphrase-stdin'] ||
      argument ||
      extra.length ||
      (command === 'browser' ? action !== 'install' : !!action)
    )
      throw new AccountError('USAGE', 'Use dev, check, doctor, or browser install.');
    if (command === 'setup' || command === 'build') {
      const directory = values.project ?? process.cwd();
      if (command === 'setup') await setupProject(directory, controller.signal);
      else await buildProject(directory, controller.signal);
      console.log(
        json
          ? JSON.stringify({ status: command === 'setup' ? 'ready' : 'built' })
          : `${command === 'setup' ? 'Project dependencies ready.' : 'Built dist/index.html.'}`,
      );
    } else if (command === 'dev') {
      const port = Number(values.port ?? 4173);
      if (
        !/^\d+$/.test(values.port ?? '4173') ||
        !Number.isInteger(port) ||
        port < 0 ||
        port > 65535
      )
        throw new AccountError('USAGE', 'Choose a port from 0 to 65535.');
      await preview(
        values.project ?? process.cwd(),
        port,
        !values['no-open'],
        json,
        controller.signal,
        network,
      );
    } else {
      const result =
        command === 'check'
          ? await checkProject(values.project ?? process.cwd(), network)
          : command === 'doctor'
            ? await doctor()
            : (await installBrowser(), { browser: 'ready' });
      console.log(
        json
          ? JSON.stringify(result)
          : Object.entries(result)
              .map(([key, value]) => `${key}: ${value}`)
              .join('\n'),
      );
    }
  } else if (command === 'config' || command === 'screenshot') {
    if (
      argument ||
      extra.length ||
      values.template ||
      values.identity ||
      values.stdin ||
      values['passphrase-stdin'] ||
      (command === 'config' && action && action !== 'init')
    )
      throw new AccountError(
        'USAGE',
        'Use config [init] or screenshot [preview.png], optionally with --project.',
      );
    const result =
      command === 'config'
        ? await projectConfiguration(values.project ?? process.cwd(), network, action === 'init')
        : await screenshotProject(values.project ?? process.cwd(), network, action);
    console.log(JSON.stringify(result, null, json ? undefined : 2));
  } else if (command === 'publish' || command === 'status') {
    if (
      action ||
      values.template ||
      values.identity ||
      values.stdin ||
      values['passphrase-stdin'] ||
      (command === 'publish' && values.refresh) ||
      (command === 'status' &&
        (values['dry-run'] ||
          values.resume ||
          values.relay ||
          values.blossom ||
          values.grasp ||
          values.site ||
          values.mirror))
    )
      throw new AccountError(
        'USAGE',
        'Use publish [--project folder] [--dry-run | --resume], or status [--project folder].',
      );
    const targets = {
      ...(values.relay ? { relay: values.relay } : {}),
      ...(values.blossom ? { blossom: values.blossom } : {}),
      ...(values.grasp ? { grasp: values.grasp } : {}),
      ...(values.site ? { site: values.site } : {}),
      ...(values.mirror ? { mirrors: values.mirror } : {}),
    };
    const result =
      command === 'status'
        ? await publicationStatus(values.project ?? process.cwd(), network, {
            refresh: values.refresh,
            signal: controller.signal,
          })
        : await publishProject({
            directory: values.project ?? process.cwd(),
            network,
            targets,
            accounts,
            dryRun: values['dry-run'],
            resume: values.resume,
            check: checkPublication,
            requirePreview: true,
            signal: controller.signal,
            onAuth,
            progress: json ? undefined : (stage) => process.stderr.write(`Publishing: ${stage}\n`),
            summary: json
              ? undefined
              : (plan) =>
                  process.stderr.write(
                    `Creator: ${plan.pubkey}\nSource (${plan.sourceBytes} bytes, ${JSON.stringify(plan.license)}):\n${plan.files.map((file) => `  ${file.path}`).join('\n')}\nRelay: ${plan.targets.relay}\nBlossom: ${plan.targets.blossom}\nGit: ${plan.targets.grasp}\nSite: ${plan.targets.site}\nAdditional relay copies (best effort): ${plan.targets.mirrors.join(', ') || 'none'}\nPreview: selected PNG or automatic sandbox capture\n`,
                  ),
          });
    if (json) console.log(JSON.stringify(result));
    else if (result.status === 'dry_run') console.log(JSON.stringify(result, null, 2));
    else if (result.status === 'not_started')
      console.log(
        'No publication yet. Run publish --dry-run to inspect the source and destinations.',
      );
    else {
      console.log(
        `${result.unchanged ? 'Existing publication' : 'Publication'}: ${result.status}\nSource commit: ${result.sourceCommit}\nNapplet: ${result.naddr}\nSnapshot: ${result.snapshotId ?? 'pending'}\n${result.websiteReady ? `Website confirmed at ${new Date(result.websiteCheckedAt!).toISOString()}: ${result.url}\nPinned snapshot: ${result.snapshotUrl}` : `Website ${result.websiteStatus}; the route is not yet confirmed: ${result.url}`}`,
      );
      if (result.preview)
        console.log(
          `Preview: ${result.preview.url}\nSaved image: ${join(values.project ?? process.cwd(), '.napplet-space', network, result.jobId, 'preview.png')}`,
        );
      if (result.error) console.log(`${result.error.code}: ${result.error.message}`);
      if (result.websiteReady)
        console.log(
          'Readable link: open the napplet page, connect the creator account and choose Named link. Claim /@your-handle/your-slug once; future releases keep it.',
        );
    }
  } else if (command === 'account') {
    if (
      !action ||
      extra.length ||
      values.template ||
      values.identity ||
      (argument && !['export', 'use'].includes(action)) ||
      (values.stdin && !['import', 'connect'].includes(action)) ||
      (values['passphrase-stdin'] && action !== 'export')
    )
      throw new AccountError('USAGE', 'Invalid account command/options. Use --help.');
    switch (action) {
      case 'create': {
        const account = await accounts.create();
        output(account, account.type === 'local' ? await accounts.backup(account.id) : undefined);
        break;
      }
      case 'backup': {
        const backupFile = await accounts.backup();
        console.log(
          json ? JSON.stringify({ backupFile, format: 'nsec' }) : backupNotice(backupFile),
        );
        break;
      }
      case 'show':
        output(await accounts.current());
        break;
      case 'list': {
        const current = await accounts.current();
        const rows = (await accounts.list()).map((a) => ({
          ...publicAccount(a, network),
          selected: a.id === current?.id,
        }));
        console.log(
          json
            ? JSON.stringify({ accounts: rows })
            : rows
                .map((a) => `${a.selected ? '*' : ' '} ${a.id} ${a.npub} ${a.type} ${a.status}`)
                .join('\n') || 'No saved creators.',
        );
        break;
      }
      case 'connect':
        output(await connect());
        break;
      case 'pair': {
        const timeout = Number(values.timeout ?? 120);
        if (!Number.isInteger(timeout) || timeout < 1 || timeout > 600 || (json && values.open))
          throw new AccountError(
            'USAGE',
            'Pairing timeout must be 1–600 seconds; --open requires text output.',
          );
        const relays =
          values['signer-relay'] ??
          (network === 'local' ? ['ws://127.0.0.1:19347'] : defaultSignerRelays);
        output(
          await accounts.pair(relays, {
            signal: controller.signal,
            timeoutMs: timeout * 1000,
            onAuth,
            onPairing: async (uri) => {
              if (json)
                console.log(JSON.stringify({ pairing: { uri, relays, timeoutSeconds: timeout } }));
              else {
                console.log(
                  `Open or paste this one-time link in your NIP-46 signer. Keep it private.\n${uri}\n`,
                );
                if (process.stdout.isTTY) {
                  const qr = await import('qrcode');
                  console.log(await qr.toString(uri, { type: 'terminal', small: true }));
                }
                console.log(`Waiting up to ${timeout} seconds for approval. Ctrl+C cancels.`);
                if (values.open) {
                  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
                  try {
                    const child = Bun.spawn([opener, uri], { stdout: 'ignore', stderr: 'ignore' });
                    void child.exited;
                  } catch {
                    console.log('Could not open your signer. Copy the link above.');
                  }
                }
              }
            },
          }),
        );
        break;
      }
      case 'import': {
        const lines = values.stdin
          ? await secretStdin()
          : [await hiddenInput('Recovery key / nsec (hidden): ')];
        const secret = lines[0].trim();
        const password = secret.startsWith('ncryptsec1')
          ? values.stdin
            ? lines[1]
            : await hiddenInput('Recovery passphrase (hidden): ')
          : undefined;
        output(await accounts.import(secret, password));
        break;
      }
      case 'use':
        if (!argument) throw new AccountError('USAGE', 'Choose an account from account list.');
        output(await accounts.use(argument, { signal: controller.signal, onAuth }));
        break;
      case 'check': {
        const signer = await accounts.signer({ signal: controller.signal, onAuth });
        try {
          await signer.getPublicKey();
          output(await accounts.current());
        } finally {
          await signer.close();
        }
        break;
      }
      case 'export': {
        if (!argument)
          throw new AccountError('USAGE', 'Specify a new recovery filename outside Git projects.');
        const password = values['passphrase-stdin']
          ? (await secretStdin())[0]
          : await hiddenInput('New recovery passphrase (12+ characters, hidden): ');
        if (
          !values['passphrase-stdin'] &&
          password !== (await hiddenInput('Repeat passphrase (hidden): '))
        )
          throw new AccountError('RECOVERY_PASSWORD', 'Passphrases did not match.');
        const destination = await accounts.export(argument, password);
        console.log(
          json
            ? JSON.stringify({ recoveryFile: destination, format: 'NIP-49' })
            : `Encrypted recovery file: ${destination}\nKeep it and its passphrase separately.`,
        );
        break;
      }
      default:
        throw new AccountError('USAGE', 'Unknown account command. Use --help.');
    }
  } else throw new AccountError('USAGE', 'Unknown command. Use --help.');
} catch (error) {
  const safe =
    error instanceof ScaffoldInputError
      ? new AccountError('USAGE', error.message)
      : error instanceof AccountError
        ? error
        : new AccountError(
            'CLI_FAILED',
            'Could not finish this operation. Check the destination, template, permissions and prerequisites. Existing keys were not replaced.',
          );
  if (json)
    console.log(
      JSON.stringify({
        error: {
          code: safe.code,
          message: safe.message,
          ...(safe instanceof PublishError ? { stage: safe.stage, retryable: safe.retryable } : {}),
        },
        ...(createdProject ? { directory: createdProject } : {}),
      }),
    );
  else {
    console.error(`${safe.code}: ${safe.message}`);
    if (createdProject)
      console.error(
        `Preview project retained at ${createdProject}. Use setup/build for project tools or the account commands for creator setup.`,
      );
  }
  process.exitCode = 1;
}
