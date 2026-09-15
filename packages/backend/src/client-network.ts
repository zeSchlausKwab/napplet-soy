import discoveryRelays from '../../nostr/discovery-relays.json';

/** Deployment hints are browser-facing addresses; index reads may use VPS loopback. */
export function browserRelayDefaults(indexRelays: string[], publicHints = '') {
  const hints = publicHints
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const relays = hints.length ? hints : indexRelays;
  return [
    ...new Set(relays.length ? relays : ['wss://relay.napplet.soy', ...discoveryRelays]),
  ].slice(0, 8);
}
