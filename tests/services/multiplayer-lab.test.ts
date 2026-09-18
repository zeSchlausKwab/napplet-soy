import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { browserEngine } from '../../apps/cli/src/browser';
import { installNetworkLab } from '../../apps/cli/src/network-lab';
import { testMultiplayer } from '../../apps/cli/src/multiplayer';
import { encodeAddress } from '../../packages/protocol/src';
import release from '../../apps/cli/distribution/version.json';

test('network simulation retains ordering, bounds backlog and cancels closed-channel delivery', async () => {
  const browser = await (await browserEngine()).chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.evaluate(() => {
      (window as any).delivered = [];
      class Channel extends EventTarget {
        readyState = 'open';
        bufferedAmount = 0;
        send(value: string) {
          (window as any).delivered.push(value);
        }
      }
      (window as any).RTCDataChannel = Channel;
    });
    await page.evaluate(installNetworkLab, { latencyMs: 80, jitterMs: 70, seed: 42 });
    const result = await page.evaluate(async () => {
      const w = window as any,
        channel = new w.RTCDataChannel();
      for (let i = 0; i < 50; i++) channel.send(String(i));
      // Turning delay off must not allow newer messages to overtake queued messages.
      w.soyliNetworkLab.set({ latencyMs: 0, jitterMs: 0, seed: 42 });
      channel.send('50');
      await new Promise((resolve) => setTimeout(resolve, 200));
      const ordered = [...w.delivered];
      w.soyliNetworkLab.set({ latencyMs: 500, jitterMs: 0, seed: 42 });
      let bounded = false;
      try {
        channel.send('x'.repeat(262145));
      } catch {
        bounded = true;
      }
      channel.send('cancelled');
      channel.readyState = 'closed';
      channel.dispatchEvent(new Event('close'));
      await new Promise((resolve) => setTimeout(resolve, 550));
      return { ordered, bounded, after: w.delivered, diagnostics: w.soyliNetworkLab.read() };
    });
    expect(result.ordered).toEqual(Array.from({ length: 51 }, (_, i) => String(i)));
    expect(result.after).toEqual(result.ordered);
    expect(result.bounded).toBe(true);
    expect(result.diagnostics.queuedBytes).toBe(0);
  } finally {
    await browser.close();
  }
});

test.skipIf(!process.env.SPACE_TEST_TURN_BINARY)(
  'scenario runner detects round-trip input delay and accepts immediate local feedback through real CVM/TURN',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'soy-lab-regression-'));
    try {
      const napplet = encodeAddress({
        kind: 35129,
        pubkey: 'a'.repeat(64),
        identifier: 'latency-test',
      });
      const config = {
        schema: 'space-local-project/v1',
        name: 'Latency fixture',
        description: '',
        previewId: crypto.randomUUID(),
        entry: 'index.html',
        license: 'MIT',
        requires: ['cvm', 'webrtc'],
        backend: { boards: [] },
      };
      await Bun.write(join(root, 'napplet.json'), JSON.stringify(config));
      const artifact = (
        predicted: boolean,
      ) => `<!doctype html><body><button id="start">Start</button><button id="move" data-position="0">Move</button><output id="ready"></output><script>
      let session, actor, host, position = 0;
      const n = window.napplet;
      const call = async (tool,args={}) => (await n.cvm.registry.call('soy.rooms.v1',tool,args)).structuredContent;
      n.webrtc.onEvent(async e => {
        if(e.sessionId!==session) return;
        if(e.type==='peer'&&e.state==='joined') document.querySelector('#ready').textContent='ready';
        if(e.type==='message'&&e.payload.type==='move') {
          if(host) await n.webrtc.send(session,{type:'state',position:++position});
        }
        if(e.type==='message'&&e.payload.type==='state') document.querySelector('#move').dataset.position=String(e.payload.position);
      });
      document.querySelector('#start').onclick=async()=>{
        actor=(await call('soy_session')).actor;
        const listed=await call('soy_room_list',{napplet:${JSON.stringify(napplet)},protocol:'latency-test'});
        host=!listed.rooms.length;
        const room=host?await call('soy_room_create',{napplet:${JSON.stringify(napplet)},protocol:'latency-test',name:'Latency fixture',capacity:2,listed:true}):await call('soy_room_join',{room:listed.rooms[0].room});
        session=(await n.webrtc.open({scope:{type:'room',room:room.room},channel:'game',protocol:'latency-test'})).session.id;
        document.body.dataset.started='yes';
      };
      document.querySelector('#move').onkeydown=e=>{
        if(e.code!=='KeyD')return;
        ${predicted ? "document.querySelector('#move').dataset.position=String(++position);" : ''}
        void n.webrtc.send(session,{type:'move'});
      };
      </script>`;
      await Bun.write(
        join(root, 'latency.mjs'),
        `export default async ({players,check,measure,diagnostics})=>{
        for(const player of players){await player.frame.locator('#start').click();await player.frame.waitForFunction(()=>document.body.dataset.started==='yes');}
        await Promise.all(players.map(p=>p.frame.waitForFunction(()=>document.querySelector('#ready').textContent==='ready')));
        const peers=await diagnostics();check('real relay connections',peers.every(rows=>rows.length===1&&rows[0].route==='relay'));
        const ms=await players[1].frame.evaluate(async()=>{
          const el=document.querySelector('#move'),before=el.dataset.position,start=performance.now();
          el.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD',bubbles:true}));
          await new Promise(resolve=>{const poll=()=>el.dataset.position!==before?resolve():requestAnimationFrame(poll);poll();});
          return performance.now()-start;
        });measure('guest local feedback',ms,50);
      };`,
      );
      const options = {
        latencyMs: 60,
        jitterMs: 10,
        turnBinary: process.env.SPACE_TEST_TURN_BINARY,
        timeoutMs: 40000,
      };
      await Bun.write(join(root, 'index.html'), artifact(false));
      const failed = await testMultiplayer(root, 'latency.mjs', options);
      expect(failed.status, JSON.stringify(failed)).toBe('failed');
      expect(failed.checks[1]).toMatchObject({ name: 'guest local feedback', passed: false });
      expect(failed.checks[1].milliseconds!).toBeGreaterThan(100);
      await Bun.write(join(root, 'index.html'), artifact(true));
      const passed = await testMultiplayer(root, 'latency.mjs', options);
      expect(passed.status, JSON.stringify(passed)).toBe('passed');
      expect(passed.checks[1].milliseconds!).toBeLessThan(50);
      expect(await Bun.file(join(root, 'napplet.json')).json()).toEqual(config);
      expect(await Bun.file(join(root, '.napplet-space/backend/identity')).exists()).toBe(false);
      const saved = await Bun.file(passed.reportPath).text();
      expect(saved).not.toContain('candidate-pair');
      expect(saved).not.toContain('turnSecret');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  100000,
);

test('scenario runner rejects assertion-free scenarios and cleans up a timed-out scenario', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-lab-empty-'));
  try {
    await Bun.write(
      join(root, 'napplet.json'),
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Empty fixture',
        description: '',
        previewId: crypto.randomUUID(),
        entry: 'index.html',
        license: 'MIT',
        requires: ['cvm'],
        backend: { boards: [] },
      }),
    );
    await Bun.write(join(root, 'index.html'), '<!doctype html><body>Idle');
    await Bun.write(join(root, 'empty.mjs'), 'export default async () => {};');
    const empty = await testMultiplayer(root, 'empty.mjs');
    expect(empty.status).toBe('failed');
    expect(empty.failure).toContain('No assertions');
    await Bun.write(
      join(root, 'caught.mjs'),
      'export default async ({check}) => { try { check("must fail",false); } catch {} };',
    );
    const caught = await testMultiplayer(root, 'caught.mjs');
    expect(caught.status).toBe('failed');
    expect(caught.failure).toContain('recorded assertion');
    await Bun.write(
      join(root, 'diagnostics.mjs'),
      `export default async ({players,check}) => {
        await players[0].page.evaluate(()=>{window.soyliPreview.diagnostics=()=>new Promise(()=>{});});
        check('scenario completed',true);
      };`,
    );
    const incomplete = await testMultiplayer(root, 'diagnostics.mjs', { timeoutMs: 2500 });
    expect(incomplete.status).toBe('passed');
    expect(incomplete.warnings).toHaveLength(1);
    expect(incomplete.durationMs).toBeLessThan(7000);
    await Bun.write(join(root, 'timeout.mjs'), 'export default async () => new Promise(() => {});');
    const timeout = await testMultiplayer(root, 'timeout.mjs', { timeoutMs: 2500 });
    expect(timeout.status).toBe('failed');
    expect(timeout.failure).toContain('timed out');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

test.skipIf(!process.env.SPACE_TEST_CLI)(
  'packaged soyLI runs a local scenario and reports failures without Bun or Node on PATH',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'soy-lab-compiled-'));
    const binary = process.env.SPACE_TEST_CLI!;
    const run = async (args: string[]) => {
      const child = Bun.spawn([binary, ...args, '--json'], {
        cwd: root,
        env: { ...process.env, PATH: '/usr/bin:/bin', SPACE_ACCOUNT_HOME: join(root, 'accounts') },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const timer = setTimeout(() => child.kill(), 30000);
      try {
        const [code, output, errors] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        let data;
        try {
          data = JSON.parse(output);
        } catch {
          throw new Error(output + errors);
        }
        return { code, data };
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      await Bun.write(
        join(root, 'napplet.json'),
        JSON.stringify({
          schema: 'space-local-project/v1',
          name: 'Compiled fixture',
          description: '',
          previewId: crypto.randomUUID(),
          entry: 'index.html',
          license: 'MIT',
          requires: ['cvm'],
          backend: { boards: [] },
        }),
      );
      await Bun.write(join(root, 'index.html'), '<!doctype html><body>Ready');
      await Bun.write(
        join(root, 'scenario.mjs'),
        `export default async ({players,check,network,diagnostics}) => {
        check('two isolated players',players.length===2);
        await players[0].page.evaluate(()=>localStorage.setItem('isolation-check','one'));
        check('separate storage',await players[1].page.evaluate(()=>localStorage.getItem('isolation-check'))===null);
        await network({latencyMs:70,jitterMs:10});
        check('network helper survives compilation',await players[0].page.evaluate(()=>window.soyliNetworkLab.read().latencyMs)===70);
        check('host diagnostics survive compilation',(await diagnostics()).length===2);
        await players[0].page.locator('#connection-details > summary').click();
        await players[0].page.waitForFunction(()=>document.querySelector('#connection-diagnostics').textContent.includes('Start or join'));
        check('preview diagnostics are visible',await players[0].page.locator('#connection-diagnostics').isVisible());
      };`,
      );
      const passed = await run(['multiplayer', 'scenario.mjs', '--latency', '50']);
      expect(passed.code, JSON.stringify(passed.data)).toBe(0);
      expect(passed.data.status).toBe('passed');
      expect(passed.data.checks).toHaveLength(5);
      expect(passed.data.cliVersion).toBe(release.version);
      expect(passed.data.artifactHash).toMatch(/^[a-f0-9]{64}$/);
      await Bun.write(
        join(root, 'fail.mjs'),
        'export default ({measure}) => measure("guest feedback",150,50);',
      );
      const failed = await run(['multiplayer', 'fail.mjs']);
      expect(failed.code).toBe(1);
      expect(failed.data.checks[0]).toMatchObject({ passed: false, milliseconds: 150 });
      const update = await run(['skills', 'update']);
      expect(update.code).toBe(0);
      expect(await Bun.file(join(root, 'docs/examples/multiplayer-sync.ts')).text()).toContain(
        'reconcile',
      );
      expect(await Bun.file(join(root, 'docs/examples/multiplayer-scenario.mjs')).text()).toContain(
        'measure(',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  80000,
);
