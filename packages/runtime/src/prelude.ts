/** NAP-SHELL supplements the pinned upstream domain shim, which does not yet provide it. */
export const SHELL_PRELUDE = `
(() => {
  let environment;
  const listeners = new Set();
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.type !== 'shell.init' || environment) return;
    environment = Object.freeze(event.data);
    resolveReady(environment);
    for (const listener of listeners) { try { listener(environment); } catch {} }
    listeners.clear();
  });
  window.napplet.shell = Object.freeze({
    ready: () => ready,
    supports: domain => !!environment?.capabilities?.domains?.includes(domain),
    get services() { return environment?.services || []; },
    onReady: handler => {
      if (environment) queueMicrotask(() => handler(environment));
      else listeners.add(handler);
      return { close: () => listeners.delete(handler) };
    },
  });
  window.parent.postMessage({type: 'shell.ready'}, '*');
})();`;
