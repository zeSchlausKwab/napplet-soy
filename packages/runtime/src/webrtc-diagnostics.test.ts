import { expect, test } from 'bun:test';
import { peerDiagnostics } from './webrtc-diagnostics';

test('diagnostics expose aggregate data and chosen route without candidate addresses or credentials', async () => {
  const stats = new Map([
    ['transport', { type: 'transport', selectedCandidatePairId: 'chosen' }],
    [
      'chosen',
      {
        type: 'candidate-pair',
        localCandidateId: 'local',
        remoteCandidateId: 'remote',
        currentRoundTripTime: 0.043,
      },
    ],
    [
      'local',
      {
        type: 'local-candidate',
        candidateType: 'host',
        address: '10.0.0.8',
        usernameFragment: 'private',
      },
    ],
    ['remote', { type: 'remote-candidate', candidateType: 'relay', address: '203.0.113.6' }],
    [
      'channel',
      {
        type: 'data-channel',
        bytesSent: 1300,
        bytesReceived: 700,
        messagesSent: 20,
        messagesReceived: 10,
      },
    ],
  ]);
  const pc = {
    connectionState: 'connected',
    getStats: async () => stats,
  } as unknown as RTCPeerConnection;
  const report = await peerDiagnostics('session', 'public-key', pc, {
    bufferedAmount: 32,
  } as RTCDataChannel);
  expect(report).toEqual({
    session: 'session',
    peer: 'public-key',
    state: 'connected',
    route: 'relay',
    rttMs: 43,
    bufferedBytes: 32,
    bytesSent: 1300,
    bytesReceived: 700,
    messagesSent: 20,
    messagesReceived: 10,
  });
  expect(JSON.stringify(report)).not.toContain('203.0.113.6');
  expect(JSON.stringify(report)).not.toContain('private');
});

test('closed or not-yet-selected connections have unknown route and no invented RTT', async () => {
  const pc = {
    connectionState: 'closed',
    getStats: async () => {
      throw new Error('closed');
    },
  } as unknown as RTCPeerConnection;
  expect(await peerDiagnostics('s', 'p', pc)).toMatchObject({
    state: 'closed',
    route: 'unknown',
    rttMs: null,
  });
});
