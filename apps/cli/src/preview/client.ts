import shim from '@napplet/shim/prelude.global?raw';
import { loadArtifact, PLAYER_SANDBOX } from '../../../../packages/runtime/src';
import { nappletPrelude } from '../../../../packages/runtime/src/prelude';
import { missingDomains } from '../../../../packages/runtime/src/capabilities';
import { attachNappletHost, type HostPrompt } from '../../../../packages/runtime/src/host';
import type { ExportFile } from '../../../../packages/runtime/src/filesystem';
import type { PreviewRevision } from './server';
import { setupListing } from './listing-client';

const stage = document.querySelector<HTMLElement>('#stage')!;
const status = document.querySelector<HTMLElement>('#status')!;
const dialog = document.querySelector<HTMLDialogElement>('#prompt')!;
const detail = document.querySelector<HTMLElement>('#prompt-detail')!;
const confirm = document.querySelector<HTMLButtonElement>('#confirm')!;
const cancel = document.querySelector<HTMLButtonElement>('#cancel')!;
const link = document.querySelector<HTMLAnchorElement>('#open-link')!;
const exports = document.querySelector<HTMLElement>('#files')!;
const prelude = nappletPrelude(shim);
let host: ReturnType<typeof attachNappletHost> | undefined;
let frame: HTMLIFrameElement | undefined;
let choice: HostPrompt | null = null;
let urls: string[] = [];
let loaded = '';
let pubkey: string | null = null;
const lifetime = new AbortController();
setupListing(lifetime.signal);

function showPrompt(prompt: HostPrompt | null) {
  choice = prompt;
  if (frame) frame.inert = prompt !== null;
  if (!prompt) {
    dialog.close();
    return;
  }
  detail.textContent =
    prompt.kind === 'save'
      ? `Save ${prompt.value}? It will appear below for download.`
      : prompt.value;
  confirm.hidden = prompt.kind !== 'save';
  link.hidden = prompt.kind !== 'link';
  if (prompt.kind === 'link') link.href = prompt.value;
  if (!dialog.open) dialog.showModal();
  cancel.focus();
}
confirm.onclick = () => choice?.answer(true);
cancel.onclick = () => choice?.answer(false);
link.onclick = () => choice?.answer(true);
dialog.oncancel = (event) => {
  event.preventDefault();
  choice?.answer(false);
};

function showFiles(files: ExportFile[]) {
  urls.forEach((url) => URL.revokeObjectURL(url));
  urls = [];
  exports.replaceChildren(
    ...files.map((file) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file.blob);
      urls.push(a.href);
      a.download = file.name.split('/').pop()!;
      a.textContent = `${file.name} ↓`;
      return a;
    }),
  );
}
const connect = document.querySelector<HTMLButtonElement>('#connect')!;
connect.onclick = async () => {
  connect.disabled = true;
  try {
    if (pubkey) pubkey = null;
    else {
      const { ExtensionSigner } = await import('applesauce-signers');
      const key = await new ExtensionSigner().getPublicKey();
      if (!/^[a-f0-9]{64}$/.test(key))
        throw new Error('The extension returned an invalid public key.');
      pubkey = key;
    }
    host?.updateIdentity(pubkey);
    connect.textContent = pubkey ? 'Disconnect' : 'Connect browser extension';
    status.textContent = pubkey ? 'Connected' : 'Guest preview';
  } catch {
    status.textContent = 'Could not connect. Unlock a Nostr browser extension and try again.';
  } finally {
    connect.disabled = false;
  }
};
document.querySelector<HTMLButtonElement>('#reload')!.onclick = () => {
  loaded = '';
};
async function refresh() {
  try {
    const response = await fetch('/revision', { cache: 'no-store', signal: lifetime.signal });
    const info: PreviewRevision & { error?: string } = await response.json();
    if (!response.ok) throw new Error(info.error ?? 'Could not read local source.');
    if (info.id === loaded) return;
    host?.close();
    host = undefined;
    stage.replaceChildren();
    frame = undefined;
    loaded = info.id;
    status.textContent = 'Verifying preview…';
    const missing = missingDomains(info.requires);
    if (missing.length) throw new Error(`Unsupported required capabilities: ${missing.join(', ')}`);
    const doc = await loadArtifact(info.artifactHash, lifetime.signal, prelude);
    frame = document.createElement('iframe');
    frame.title = 'Your napplet';
    frame.sandbox.value = PLAYER_SANDBOX;
    frame.allow = 'fullscreen';
    frame.referrerPolicy = 'no-referrer';
    frame.srcdoc = doc;
    // Attach before the child's bootstrap can post shell.ready.
    stage.replaceChildren(frame);
    host = attachNappletHost({
      frame,
      identity: info.hostIdentity,
      manifestId: info.id,
      relays: info.relays,
      pubkey,
      prompt: showPrompt,
      files: showFiles,
    });
    status.textContent = 'Local preview · saved changes reload automatically';
  } catch (error) {
    host?.close();
    host = undefined;
    stage.replaceChildren();
    frame = undefined;
    // Retrying is safe and lets transient errors recover without another source edit.
    loaded = '';
    status.textContent = error instanceof Error ? error.message : 'Preview unavailable.';
  } finally {
    if (!lifetime.signal.aborted) setTimeout(() => void refresh(), 700);
  }
}
window.addEventListener('pagehide', () => {
  lifetime.abort();
  host?.close();
  showFiles([]);
});
void refresh();
