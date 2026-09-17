import { test, expect } from 'bun:test';
import { rtcConfiguration, validateProvider } from './client';

test('provider and ICE policy accepts public TURN ports and confines preview exceptions to literal loopback', () => {
  const provider = {
    pubkey: 'a'.repeat(64),
    relays: ['wss://relay.napplet.soy', 'wss://relay.napplet.soy/'],
  };
  expect(validateProvider(provider).relays).toEqual(['wss://relay.napplet.soy/']);
  expect(() => validateProvider({ ...provider, relays: ['ws://192.168.1.1'] })).toThrow();
  const ice = (url: string) => ({
    iceServers: [{ urls: [url], username: 'short-lived', credential: 'test' }],
  });
  expect(rtcConfiguration(ice('turn:napplet.soy:3478?transport=udp')).iceTransportPolicy).toBe(
    'all',
  );
  expect(
    rtcConfiguration({ ...ice('turns:napplet.soy:5349'), relayOnly: true }).iceTransportPolicy,
  ).toBe('relay');
  for (const url of [
    'turn:192.168.1.1:3478',
    'turn:127.0.0.1:3478',
    'turn:localhost:3478',
    'https://napplet.soy',
  ])
    expect(() => rtcConfiguration(ice(url))).toThrow();
  expect(rtcConfiguration(ice('turn:127.0.0.1:3478'), true).iceServers).toHaveLength(1);
  expect(() => rtcConfiguration(ice('turn:192.168.1.1:3478'), true)).toThrow();
});
