// Keep all copyable entry points and the rendered walkthrough on the same installer.
export const INSTALL_COMMAND = 'curl -fsSL https://napplet.soy/install.sh | sh -s --';

function argument(value: string) {
  return /^[a-zA-Z0-9_-]+$/.test(value) ? value : "'" + value.replaceAll("'", "'\\''") + "'";
}

export function createCommand(template = 'boilerplate') {
  return `${INSTALL_COMMAND} new my-napplet${template === 'boilerplate' ? '' : ` --template ${argument(template)}`}`;
}

export function remixCommand(source: string, install = true) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(source).hostname);
  return `${install ? INSTALL_COMMAND : 'napplet-space'} remix ${argument(source)} my-remix${local ? ' --network local' : ''}`;
}
