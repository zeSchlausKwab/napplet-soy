import React from 'react';
import { AbsoluteFill, Composition, interpolate, registerRoot, useCurrentFrame } from 'remotion';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-mono/latin-400.css';
import { createCommand } from '../../apps/web/src/lib/creator-commands';
import { walkthrough } from '../../apps/web/src/lib/creator-walkthrough';

const ink = '#272921',
  paper = '#f8f6ee',
  coral = '#ec765d',
  sage = '#bacc9b';
const mono: React.CSSProperties = { fontFamily: 'DM Mono', fontSize: 23, lineHeight: 1.8 };
const FPS = 24,
  SCENE = 6 * FPS;
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

function Orbit({
  frame,
  color = '#cdd3fa',
  small = false,
}: {
  frame: number;
  color?: string;
  small?: boolean;
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: color,
        display: 'grid',
        placeItems: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <svg viewBox="0 0 500 360" style={{ width: small ? '100%' : '80%', height: '100%' }}>
        <g
          transform={`translate(250 180) rotate(${frame * 0.55})`}
          fill="none"
          stroke={ink}
          strokeWidth="1.2"
          opacity="0.68"
        >
          {Array.from({ length: 15 }, (_, i) => (
            <ellipse key={i} rx="145" ry="59" transform={`rotate(${i * 12})`} />
          ))}
          <circle cx="145" cy="0" r="13" fill={coral} stroke="none" opacity="1" />
        </g>
      </svg>
    </div>
  );
}

function Window({
  title,
  children,
  dark = false,
  style,
}: {
  title: string;
  children: React.ReactNode;
  dark?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        border: `2px solid ${ink}`,
        borderRadius: 16,
        overflow: 'hidden',
        background: dark ? '#2c3328' : '#fffdf6',
        color: dark ? paper : ink,
        boxShadow: '8px 8px 0 #27292115',
        ...style,
      }}
    >
      <div
        style={{
          height: 50,
          display: 'flex',
          alignItems: 'center',
          padding: '0 22px',
          borderBottom: '1px solid #88887355',
          gap: 9,
        }}
      >
        {[coral, '#f1d684', sage].map((color) => (
          <span key={color} style={{ width: 9, height: 9, borderRadius: 99, background: color }} />
        ))}
        <span style={{ ...mono, fontSize: 16, marginLeft: 13, opacity: 0.75 }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Film() {
  const frame = useCurrentFrame();
  const scene = Math.min(4, Math.floor(frame / SCENE));
  const local = frame % SCENE;
  const enter = interpolate(local, [0, 13], [18, 0], clamp);
  const appear = interpolate(local, [0, 10], [0, 1], clamp);
  const headlines = [
    'An idea is enough.',
    'Follow the happy accident.',
    'Give your little world a home.',
    'Small code. Big weird.',
    'Now make it your kind of weird.',
  ];
  const command = createCommand();
  return (
    <AbsoluteFill
      style={{ background: paper, color: ink, fontFamily: 'DM Sans', padding: '36px 60px' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: 24,
          borderBottom: '1px solid #dcdcd1',
        }}
      >
        <span style={{ fontSize: 28, fontWeight: 600 }}>
          <span style={{ color: coral }}>✳</span> napplet.soy
        </span>
        <span style={{ ...mono, fontSize: 16 }}>AN IDEA → A LITTLE WORLD</span>
      </div>
      <div style={{ display: 'flex', gap: 24, marginTop: 24 }}>
        {walkthrough.scenes.map(({ title }, index) => (
          <div
            key={title}
            style={{
              ...mono,
              fontSize: 19,
              color: index === scene ? ink : '#929482',
              display: 'flex',
              gap: 9,
              alignItems: 'center',
            }}
          >
            <span
              style={{
                background: index === scene ? coral : '#e9e8de',
                borderRadius: 50,
                width: 30,
                height: 30,
                display: 'grid',
                placeItems: 'center',
                fontSize: 14,
              }}
            >
              {index + 1}
            </span>
            {title}
          </div>
        ))}
      </div>
      <div style={{ opacity: appear, transform: `translateY(${enter}px)` }}>
        <h1 style={{ fontSize: 51, fontWeight: 600, letterSpacing: -1.8, margin: '21px 0 22px' }}>
          {headlines[scene]}
        </h1>
        {scene === 0 && (
          <Window title="your terminal" dark style={{ height: 350 }}>
            <div style={{ padding: '22px 30px' }}>
              <div style={{ ...mono, fontSize: 23, overflowWrap: 'anywhere', minHeight: 96 }}>
                <span style={{ color: sage }}>$ </span>
                {command.slice(
                  0,
                  Math.floor(interpolate(local, [8, 68], [0, command.length], clamp)),
                )}
              </div>
              <div
                style={{
                  opacity: interpolate(local, [74, 85], [0, 1], clamp),
                  borderTop: '1px solid #ffffff22',
                  paddingTop: 18,
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ ...mono, fontSize: 21, color: sage }}>
                  my-napplet/
                  <br />
                  <span style={{ color: paper, fontSize: 17 }}>
                    code + skills + publishing config
                  </span>
                </div>
                <div
                  style={{
                    background: sage,
                    color: ink,
                    padding: '10px 20px',
                    borderRadius: 8,
                    fontSize: 23,
                    alignSelf: 'center',
                    transform: 'rotate(-3deg)',
                  }}
                >
                  No website account needed.
                </div>
              </div>
              <div style={{ ...mono, fontSize: 16, color: '#bac7aa', marginTop: 15 }}>
                macOS / Linux · Git required · Follow the PATH instruction if shown
              </div>
            </div>
          </Window>
        )}
        {scene === 1 && (
          <Window title="my-napplet / your coding tool" style={{ height: 350 }}>
            <div style={{ display: 'flex', height: 298 }}>
              <div style={{ width: '53%', padding: '22px 27px', background: '#eeece3' }}>
                <div style={{ ...mono, fontSize: 19, color: '#5e795e' }}>
                  $ cd my-napplet
                  <br />$ napplet-space dev
                </div>
                <div
                  style={{
                    borderLeft: `3px solid ${coral}`,
                    paddingLeft: 17,
                    fontSize: 26,
                    lineHeight: 1.35,
                    marginTop: 20,
                  }}
                >
                  “Make an orbit toy.
                  <br />
                  Let it follow my curiosity.”
                </div>
                <div style={{ ...mono, fontSize: 16, marginTop: 14 }}>
                  your agent · your idea · live preview
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <Orbit frame={frame} />
              </div>
            </div>
          </Window>
        )}
        {scene === 2 && (
          <div style={{ display: 'flex', gap: 24, height: 350 }}>
            <Window title="terminal / my-napplet" dark style={{ flex: 1 }}>
              <div style={{ padding: 23, ...mono, fontSize: 20 }}>
                <div>$ napplet-space build</div>
                <div style={{ color: sage, margin: '15px 0', fontSize: 18 }}>
                  Review your posting preview ✓
                </div>
                <div style={{ opacity: interpolate(local, [35, 48], [0, 1], clamp) }}>
                  $ napplet-space publish
                </div>
                <div
                  style={{
                    opacity: interpolate(local, [65, 80], [0, 1], clamp),
                    color: sage,
                    marginTop: 20,
                    fontSize: 18,
                  }}
                >
                  Signed with your Nostr identity.
                  <br />
                  Your share link is ready.
                </div>
              </div>
            </Window>
            <Window title="posting preview" style={{ width: 400 }}>
              <div style={{ display: 'flex', height: 111, padding: 15, gap: 18 }}>
                <div style={{ width: 110, flexShrink: 0, overflow: 'hidden', borderRadius: 6 }}>
                  <Orbit frame={frame} small />
                </div>
                <div style={{ fontSize: 25, paddingTop: 4 }}>
                  Little orbit
                  <div style={{ fontSize: 16, color: '#647b59', lineHeight: 1.5 }}>
                    Title · description ✓<br />
                    Screenshot ✓
                  </div>
                </div>
              </div>
              <div
                style={{
                  margin: '5px 20px',
                  borderTop: '1px solid #dcdcd1',
                  paddingTop: 15,
                  ...mono,
                  fontSize: 16,
                }}
              >
                relay.napplet.soy
                <br />
                blossom.napplet.soy
                <br />
                git.napplet.soy
                <br />
                <span style={{ color: '#647b59' }}>Your destinations. Configurable.</span>
              </div>
            </Window>
          </div>
        )}
        {scene === 3 && (
          <Window
            title="your napplet / play it, pass it around"
            style={{ height: 350, position: 'relative' }}
          >
            <div style={{ height: 298 }}>
              <Orbit frame={frame} />
            </div>
            <div
              style={{
                position: 'absolute',
                right: 28,
                bottom: 24,
                border: `1px solid ${ink}`,
                borderRadius: 9,
                background: paper,
                padding: '12px 22px',
                fontSize: 24,
                transform: `rotate(${Math.sin(local / 24) * 3}deg)`,
              }}
            >
              ↗ Share a little joy
            </div>
          </Window>
        )}
        {scene === 4 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 22, height: 350 }}>
            <Window title="little orbit" style={{ width: 420 }}>
              <div style={{ height: 210 }}>
                <Orbit frame={frame} />
              </div>
            </Window>
            <div style={{ width: 260, textAlign: 'center' }}>
              <div
                style={{
                  background: ink,
                  color: paper,
                  borderRadius: 10,
                  padding: '13px 8px',
                  fontSize: 24,
                }}
              >
                ⑂ Remix this
              </div>
              <div style={{ ...mono, fontSize: 17, marginTop: 15 }}>
                Install and remix
                <br />
                <span style={{ color: '#647b59' }}>copy → paste → create</span>
              </div>
              <div style={{ fontSize: 47, marginTop: 4 }}>→</div>
            </div>
            <Window title="your remix" style={{ width: 420, transform: 'rotate(2deg)' }}>
              <div style={{ height: 210 }}>
                <Orbit frame={frame * -1.2} color="#f6b494" />
              </div>
            </Window>
          </div>
        )}
      </div>
      <div style={{ marginTop: 23, fontSize: 24, lineHeight: 1.4, textAlign: 'center' }}>
        {walkthrough.scenes[scene].caption}
      </div>
      <div
        style={{
          marginTop: 'auto',
          display: 'flex',
          justifyContent: 'space-between',
          ...mono,
          fontSize: 14,
          color: '#747968',
        }}
      >
        <span>ILLUSTRATED FLOW · YOUR TOOLS, YOUR PACE</span>
        <span>OPEN SOURCE. OPEN SEASON.</span>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          height: 5,
          width: `${(frame / (walkthrough.seconds * FPS - 1)) * 100}%`,
          background: coral,
        }}
      />
    </AbsoluteFill>
  );
}

registerRoot(() => (
  <Composition
    id="CreatorJourney"
    component={Film}
    width={1280}
    height={800}
    fps={FPS}
    durationInFrames={walkthrough.seconds * FPS}
  />
));
