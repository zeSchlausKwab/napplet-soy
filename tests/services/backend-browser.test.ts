import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { backendProject, localBackend } from '../../apps/cli/src/backend';
import { startPreviewServer } from '../../apps/cli/src/preview/server';
import { previewAssets } from '../../apps/cli/src/preview/assets';
import { browserEngine } from '../../apps/cli/src/browser';

test(`separate guest browsers use the real shim, encrypted CVM, shared scores and ${process.env.SPACE_TEST_TURN_BINARY ? 'forced TURN' : 'direct WebRTC'} payloads`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soy-backend-browser-'));
  await Bun.write(
    join(directory, 'napplet.json'),
    JSON.stringify({
      schema: 'space-local-project/v1',
      name: 'Backend fixture',
      description: '',
      entry: 'index.html',
      previewId: crypto.randomUUID(),
      license: 'MIT',
      requires: ['cvm', 'webrtc'],
      backend: {
        boards: [{ board: 'test', title: 'Scores', order: 'highest', minimum: 0, maximum: 1000 }],
      },
    }),
  );
  await Bun.write(join(directory, 'index.html'), '<!doctype html><body>Protocol fixture</body>');
  let turn: Bun.Subprocess | undefined;
  let connectivity = {};
  if (process.env.SPACE_TEST_TURN_BINARY) {
    const reserved = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
    const port = reserved.port!;
    reserved.stop(true);
    const config = join(directory, 'turn.conf'),
      secret = 'local-fixture-secret';
    await Bun.write(
      config,
      `listening-ip=127.0.0.1\nrelay-ip=127.0.0.1\nlistening-port=${port}\nrealm=fixture\nuse-auth-secret\nstatic-auth-secret=${secret}\nno-tls\nno-dtls\nno-cli\nallow-loopback-peers\ncli-password=fixture\nno-multicast-peers\nlog-file=stdout\npidfile=${directory}/turn.pid\n`,
    );
    turn = Bun.spawn([process.env.SPACE_TEST_TURN_BINARY, '-c', config], {
      stdout: Bun.file(join(directory, 'turn.log')),
      stderr: 'inherit',
    });
    await Bun.sleep(500);
    connectivity = {
      turnUrls: [`turn:127.0.0.1:${port}?transport=udp`],
      turnSecret: secret,
      relayOnly: true,
    };
  }
  const context = await backendProject(directory),
    backend = await localBackend(directory, connectivity);
  const server = startPreviewServer(
    pathToFileURL(directory + '/'),
    0,
    false,
    await previewAssets(),
    { network: 'local', backend: backend!.provider },
  );
  // Keep the direct fixture independent of VPN interface routing on the test machine.
  const browser = await (
    await browserEngine()
  ).chromium.launch({
    headless: true,
    args: ['--allow-loopback-in-peer-connection', '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  try {
    const a = await browser.newPage(),
      b = await browser.newPage();
    const errors: string[] = [];
    for (const page of [a, b]) page.on('pageerror', (e) => errors.push(e.message));
    for (const page of [a, b])
      await page.addInitScript(() => {
        const Native = RTCPeerConnection;
        (window as any).connections = [];
        window.RTCPeerConnection = class extends Native {
          constructor(config?: RTCConfiguration) {
            super(config);
            (window as any).connections.push(this);
          }
        };
      });
    await Promise.all([a.goto(server.url.href), b.goto(server.url.href)]);
    const frame = async (page: typeof a) => {
      await page.locator('iframe').waitFor();
      const frame = page.frames().find((f) => f.parentFrame())!;
      await frame.waitForFunction(() => !!(window as any).napplet?.cvm);
      return frame;
    };
    const fa = await frame(a),
      fb = await frame(b);
    const actor = (f: typeof fa) =>
      f.evaluate(async () => {
        const result = await (window as any).napplet.cvm.registry.call(
          'soy.rooms.v1',
          'soy_session',
          {},
        );
        if (result.isError) throw new Error(JSON.stringify(result));
        return result.structuredContent.actor as string;
      });
    const [actorA, actorB] = await Promise.all([actor(fa), actor(fb)]);
    expect(actorA).not.toBe(actorB);
    const score = { napplet: context!.napplet, board: 'test', score: 42, name: 'Guest A' };
    const submitted = await fa.evaluate(
      async (args) =>
        (window as any).napplet.cvm.registry.call('soy.boards.v1', 'soy_board_submit', args),
      score,
    );
    expect(submitted.isError).not.toBe(true);
    const read = await fb.evaluate(
      async (args) =>
        (window as any).napplet.cvm.registry.call('soy.boards.v1', 'soy_board_read', args),
      { napplet: context!.napplet, board: 'test' },
    );
    expect(read.structuredContent.rows[0]).toMatchObject({ score: 42, name: 'Guest A' });
    const queue = { napplet: context!.napplet, protocol: 'test-v1', queue: 'fixture', players: 2 };
    const first = await fa.evaluate(
      async (args) =>
        (window as any).napplet.cvm.registry.call('soy.matchmaking.v1', 'soy_match_join', args),
      queue,
    );
    const second = await fb.evaluate(
      async (args) =>
        (window as any).napplet.cvm.registry.call('soy.matchmaking.v1', 'soy_match_join', args),
      queue,
    );
    const matched = await fa.evaluate(
      async (ticket) =>
        (window as any).napplet.cvm.registry.call('soy.matchmaking.v1', 'soy_match_status', {
          ticket,
        }),
      first.structuredContent.ticket,
    );
    expect(matched.structuredContent.room).toBe(second.structuredContent.room);
    expect(matched.structuredContent.peers).toContain(actorB);
    const open = (f: typeof fa) =>
      f.evaluate(async (match) => {
        const n = (window as any).napplet;
        (window as any).rtcEvents = [];
        n.webrtc.onEvent((event: unknown) => (window as any).rtcEvents.push(event));
        const result = await n.webrtc.open({
          scope: { type: 'room', room: match.room, peers: match.peers },
          channel: 'game',
          protocol: 'test-v1',
        });
        (window as any).session = result.session.id;
        return result;
      }, matched.structuredContent);
    const pendingA = open(fa),
      pendingB = open(fb);
    await Promise.all([a.locator('#confirm').click(), b.locator('#confirm').click()]);
    await Promise.all([pendingA, pendingB]);
    try {
      await Promise.all([
        fa.waitForFunction(
          () =>
            (window as any).rtcEvents.some((e: any) => e.type === 'peer' && e.state === 'joined'),
          undefined,
          { timeout: 30000 },
        ),
        fb.waitForFunction(
          () =>
            (window as any).rtcEvents.some((e: any) => e.type === 'peer' && e.state === 'joined'),
          undefined,
          { timeout: 30000 },
        ),
      ]);
    } catch (error) {
      for (const page of [a, b])
        console.error(
          await page.evaluate(() =>
            (window as any).connections.map((p: RTCPeerConnection) => ({
              state: p.connectionState,
              signal: p.signalingState,
              ice: p.iceConnectionState,
              gathering: p.iceGatheringState,
            })),
          ),
        );
      console.error(
        'RTC events',
        await fa.evaluate(() => (window as any).rtcEvents),
        await fb.evaluate(() => (window as any).rtcEvents),
        errors,
      );
      throw error;
    }
    await fa.evaluate(async () =>
      (window as any).napplet.webrtc.send((window as any).session, { input: 'left', tick: 7 }),
    );
    await fb.waitForFunction(() =>
      (window as any).rtcEvents.some((e: any) => e.type === 'message' && e.payload.tick === 7),
    );
    const received = await fb.evaluate(() =>
      (window as any).rtcEvents.find((e: any) => e.type === 'message'),
    );
    expect(received).toMatchObject({ from: actorA, payload: { input: 'left', tick: 7 } });
    const route = await a.evaluate(async () => {
      const connection = (window as any).connections.find(
        (p: RTCPeerConnection) => p.connectionState === 'connected',
      ) as RTCPeerConnection;
      const stats = await connection.getStats();
      const transport = [...stats.values()].find(
        (s) => s.type === 'transport' && s.selectedCandidatePairId,
      );
      const pair = stats.get(transport.selectedCandidatePairId);
      return stats.get(pair.localCandidateId).candidateType;
    });
    if (turn) expect(route).toBe('relay');
    else expect(route).not.toBe('relay');
    await expect(
      fa.evaluate(async () =>
        (window as any).napplet.webrtc.send((window as any).session, 'x'.repeat(17000)),
      ),
    ).rejects.toThrow('16 KiB');
    await fa.evaluate(async () => {
      for (let frame = 0; frame < 650; frame++) {
        await (window as any).napplet.webrtc.send((window as any).session, { frame });
        await new Promise((resolve) => setTimeout(resolve, 17));
      }
    });
    await fb.waitForFunction(() =>
      (window as any).rtcEvents.some((e: any) => e.type === 'message' && e.payload.frame === 649),
    );
    await fa.evaluate(async () => (window as any).napplet.webrtc.close((window as any).session));
    await fb.waitForFunction(() =>
      (window as any).rtcEvents.some((e: any) => e.type === 'peer' && e.state === 'left'),
    );
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.stop(true);
    await backend!.close();
    turn?.kill();
    if (turn) await turn.exited;
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
