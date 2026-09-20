import { expect, test } from 'bun:test';
import { browserRelayDefaults } from './client-network';
import discoveryRelays from '../../nostr/discovery-relays.json';

test('browser defaults use public relay hints rather than the indexer loopback address', () => {
  expect(
    browserRelayDefaults(
      ['ws://127.0.0.1:19347/relay', 'wss://discovery.example'],
      'wss://relay.napplet.soy,wss://discovery.example',
    ),
  ).toEqual(['wss://relay.napplet.soy', 'wss://discovery.example']);
  expect(
    browserRelayDefaults(['ws://127.0.0.1:19347/relay'], 'wss://custom.example:8443/nostr'),
  ).toEqual(['wss://custom.example:8443/nostr']);
});

test('development can keep its configured local relay and an unconfigured client has public defaults', () => {
  expect(browserRelayDefaults(['ws://127.0.0.1:19347/relay'])).toEqual([
    'ws://127.0.0.1:19347/relay',
  ]);
  expect(browserRelayDefaults([])).toEqual(['wss://relay.napplet.soy', ...discoveryRelays]);
  expect(new Set(browserRelayDefaults([])).size).toBe(browserRelayDefaults([]).length);
});
