import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Composition,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  registerRoot,
  spring,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/dm-mono/latin-400.css';
import '@fontsource/fredoka/latin-600.css';

const C = {
  cream: '#f5eedb',
  muted: '#b8c4b4',
  coral: '#fa9279',
  sage: '#c9db9e',
  pine: '#162b26',
  mint: '#91d9be',
};
const mono: React.CSSProperties = { fontFamily: 'DM Mono', fontWeight: 400 };
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const mix = (f: number, start: number, end: number, a = 0, b = 1) =>
  interpolate(f, [start, end], [a, b], clamp);
const sceneFrames = 150;
const chapters = [
  {
    verb: 'REMIX',
    title: (
      <>
        What if it
        <br />
        had <em>portals?</em>
      </>
    ),
    description: 'Play something. Have an idea. Make it yours.',
    prompt: 'Add two portals. Keep the marble’s momentum. Propose the improvement.',
    command: 'soyli propose "Add momentum portals"',
    before: 'soyli remix <napplet-link> orbit-portals',
    result: 'Playable proposal ready',
    owner: 'Jules',
    role: 'PLAYER → CONTRIBUTOR',
    badge: 'YOUR IDEA, A NEW BRANCH',
  },
  {
    verb: 'REVIEW',
    title: (
      <>
        Don’t just
        <br />
        read it. <em>Play it.</em>
      </>
    ),
    description: 'The author gets a working version to try.',
    prompt: 'Let me try the portal version and compare it with the original.',
    command: 'soyli review',
    before: 'Open proposals · choose this revision',
    result: 'Original + proposed, side by side',
    owner: 'Mika',
    role: 'ORIGINAL CREATOR',
    badge: 'A PROPOSAL YOU CAN PLAY',
  },
  {
    verb: 'BRING IT BACK',
    title: (
      <>
        Their idea.
        <br />
        <em>Everyone’s game.</em>
      </>
    ),
    description: 'Accept the change. Publish the next little world.',
    prompt: 'I like it. Merge the reviewed version and publish the update.',
    command: 'soyli publish',
    before: 'Review → Merge locally',
    result: 'New release ready to play',
    owner: 'Mika',
    role: 'ORIGINAL CREATOR',
    badge: 'SAME ROOTS. MORE POSSIBILITIES.',
  },
];

function Soybert({ frame, size = 78 }: { frame: number; size?: number }) {
  const n = Math.floor(frame / 7) % 9;
  return (
    <div
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${staticFile('soybert.png')})`,
        backgroundSize: '300% 300%',
        backgroundPosition: `${(n % 3) * 50}% ${Math.floor(n / 3) * 50}%`,
        flexShrink: 0,
      }}
    />
  );
}
function Spark({
  x,
  y,
  size = 15,
  color = C.sage,
  rotate = 0,
}: {
  x: number;
  y: number;
  size?: number;
  color?: string;
  rotate?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      style={{ position: 'absolute', left: x, top: y, transform: `rotate(${rotate}deg)` }}
    >
      <path d="M10 0 12 8 20 10 12 12 10 20 8 12 0 10 8 8Z" fill={color} />
    </svg>
  );
}
function Timeline({ frame }: { frame: number }) {
  const branch = mix(frame, 16, 90),
    proposal = mix(frame, 90, 120),
    merge = mix(frame, 315, 354),
    release = mix(frame, 364, 398);
  return (
    <div style={{ position: 'absolute', left: 90, top: 886, width: 1740, height: 146 }}>
      <div style={{ ...mono, fontSize: 14, letterSpacing: 2, color: C.muted, marginBottom: 7 }}>
        FOLLOW THE IDEA
      </div>
      <svg viewBox="0 0 1740 126" style={{ width: 1740, height: 126, overflow: 'visible' }}>
        <path d="M 104 43 H 1620" fill="none" stroke="#b8c4b431" strokeWidth="2" />
        <path d="M 104 43 H 440" fill="none" stroke={C.cream} strokeWidth="3" />
        <path
          d="M 350 43 C 450 43 423 86 528 86 H 690"
          pathLength="1"
          strokeDasharray="1"
          strokeDashoffset={1 - branch}
          fill="none"
          stroke={C.coral}
          strokeWidth="4"
        />
        <path
          d="M 690 86 H 1090"
          pathLength="1"
          strokeDasharray="1"
          strokeDashoffset={1 - proposal}
          fill="none"
          stroke={C.coral}
          strokeWidth="4"
        />
        <path
          d="M 1090 86 C 1210 86 1205 43 1335 43"
          pathLength="1"
          strokeDasharray="1"
          strokeDashoffset={1 - merge}
          fill="none"
          stroke={C.coral}
          strokeWidth="4"
        />
        <path
          d="M 1335 43 H 1620"
          pathLength="1"
          strokeDasharray="1"
          strokeDashoffset={1 - release}
          fill="none"
          stroke={C.sage}
          strokeWidth="4"
        />
        {[
          [104, 43, 'Original release', C.cream, 1],
          [690, 86, 'Your changes', C.coral, branch],
          [1090, 86, 'Playable proposal', C.coral, proposal],
          [1335, 43, 'Merged', C.coral, merge],
          [1620, 43, 'New release', C.sage, release],
        ].map(([x, y, label, color, opacity]) => (
          <g key={String(label)} opacity={Number(opacity)}>
            <circle
              cx={Number(x)}
              cy={Number(y)}
              r={label === 'New release' ? 14 : 10}
              fill={C.pine}
              stroke={String(color)}
              strokeWidth="3"
            />
            <circle cx={Number(x)} cy={Number(y)} r="4" fill={String(color)} />
            <text
              x={Number(x)}
              y={Number(y) + (Number(y) > 60 ? 33 : -24)}
              fill={String(color)}
              textAnchor="middle"
              style={{ fontFamily: 'DM Sans', fontSize: 19, fontWeight: 500 }}
            >
              {label}
            </text>
          </g>
        ))}
        {frame > 178 && frame < 320 && (
          <circle
            cx={1090}
            cy={86}
            r={16 + Math.sin(frame / 12) * 3}
            fill="none"
            stroke={C.coral}
            opacity={0.3}
          />
        )}
        <text x="104" y="81" fill={C.muted} textAnchor="middle" style={{ ...mono, fontSize: 14 }}>
          Mika
        </text>
        <text x="690" y="58" fill={C.muted} textAnchor="middle" style={{ ...mono, fontSize: 14 }}>
          Jules
        </text>
        <text
          x="1620"
          y="83"
          fill={C.muted}
          textAnchor="middle"
          opacity={release}
          style={{ ...mono, fontSize: 14 }}
        >
          Mika + Jules
        </text>
      </svg>
    </div>
  );
}

function Command({ frame, scene }: { frame: number; scene: number }) {
  const local = frame - scene * sceneFrames,
    chapter = chapters[scene];
  const typingStart = scene === 2 ? 55 : 14;
  const typingEnd = scene === 2 ? 78 : 58;
  const text = chapter.command.slice(
    0,
    Math.floor(mix(local, typingStart, typingEnd, 0, chapter.command.length)),
  );
  const complete =
    scene === 0 ? mix(local, 120, 135) : scene === 2 ? mix(local, 98, 112) : mix(local, 65, 83);
  return (
    <div
      style={{
        position: 'absolute',
        left: 92,
        top: 701,
        width: 637,
        borderRadius: 16,
        background: '#091512e8',
        border: '1px solid #b9c89b50',
        boxShadow: '0 16px 44px #0003',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: 40,
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #b9c89b25',
          ...mono,
          fontSize: 14,
          color: C.muted,
        }}
      >
        <span>⌘ &nbsp; napplet soyLI</span>
        <span>YOUR AGENT’S TOOLBOX</span>
      </div>
      <div style={{ padding: '15px 20px 17px' }}>
        <div style={{ ...mono, fontSize: 14, color: '#bccbb0', marginBottom: 9 }}>
          {chapter.before}
        </div>
        <div
          style={{ ...mono, fontSize: scene === 0 ? 21 : 26, whiteSpace: 'nowrap', color: C.cream }}
        >
          <span style={{ color: C.coral, marginRight: 12 }}>$</span>
          {text}
          <span style={{ opacity: local < typingEnd + 2 ? 1 : 0, color: C.sage }}>▌</span>
        </div>
        <div style={{ ...mono, fontSize: 15, marginTop: 10, color: C.sage, opacity: complete }}>
          ✓ {chapter.result}
        </div>
      </div>
    </div>
  );
}
function Prompt({ frame, scene }: { frame: number; scene: number }) {
  const local = frame - scene * sceneFrames;
  const lift = spring({ frame: local, fps: 30, config: { damping: 22, stiffness: 140 } });
  const chapter = chapters[scene];
  return (
    <div
      style={{
        position: 'absolute',
        left: 92,
        top: 506,
        width: 637,
        transform: `translateY(${(1 - lift) * 18}px)`,
        opacity: mix(local, 0, 7),
        background: C.cream,
        borderRadius: '5px 24px 24px 24px',
        color: C.pine,
        boxShadow: '0 20px 64px #0003',
        padding: '20px 26px 22px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 13 }}>
        <span
          style={{
            background: scene === 0 ? C.coral : C.sage,
            borderRadius: 50,
            width: 28,
            height: 28,
            display: 'grid',
            placeItems: 'center',
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          {scene === 0 ? 'J' : 'M'}
        </span>
        <span style={{ ...mono, fontSize: 14, letterSpacing: 1.5 }}>
          {chapter.owner.toUpperCase()}
        </span>
        <span style={{ ...mono, fontSize: 11, color: '#62705b', marginLeft: 'auto' }}>
          {chapter.role}
        </span>
      </div>
      <div style={{ fontSize: 27, lineHeight: 1.35, fontWeight: 500, letterSpacing: -0.5 }}>
        “{chapter.prompt}”
      </div>
    </div>
  );
}

function GameWindow({ frame, scene }: { frame: number; scene: number }) {
  const local = frame - scene * sceneFrames;
  const review = scene === 1;
  const tilt = interpolate(frame, [0, 150, 172, 300, 324, 450], [-1.6, -1.6, 0.4, 0.4, -0.7, -0.7]);
  const arrival = scene === 2 ? mix(local, 0, 30, 16, 0) : 0;
  return (
    <div
      style={{
        position: 'absolute',
        left: 825,
        top: 181 + arrival + Math.sin(frame / 40) * 4,
        width: 1000,
        transform: `perspective(1800px) rotateY(-3deg) rotateZ(${tilt}deg)`,
        transformOrigin: '50% 55%',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: '70px 60px -10px',
          background: scene === 2 ? '#9ecb6150' : '#f79a6340',
          filter: 'blur(70px)',
          borderRadius: '40%',
        }}
      />
      <div
        style={{
          position: 'relative',
          borderRadius: 24,
          overflow: 'hidden',
          border: `1px solid ${scene === 2 ? '#d1e5a2a0' : '#e2e7bc66'}`,
          boxShadow: '0 40px 100px #0009',
          background: '#0b1a1c',
        }}
      >
        <div
          style={{
            height: 63,
            background: '#f4eedc',
            color: C.pine,
            display: 'flex',
            alignItems: 'center',
            padding: '0 25px',
            gap: 13,
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 21 }}>Orbit Run</span>
          <span style={{ fontSize: 15, color: '#637157' }}>
            by{' '}
            {scene === 0
              ? 'Jules'
              : scene === 1
                ? 'Mika · reviewing Jules’s proposal'
                : 'Mika · with Jules’s portals'}
          </span>
          <span
            style={{
              marginLeft: 'auto',
              ...mono,
              fontSize: 12,
              background: scene === 2 ? '#d4e5b5' : '#e4dcc7',
              padding: '8px 12px',
              borderRadius: 7,
            }}
          >
            {scene === 0
              ? 'LOCAL REMIX'
              : scene === 1
                ? 'PROPOSED VERSION'
                : frame < 354
                  ? 'REVIEWED VERSION'
                  : frame < 398
                    ? 'MERGED LOCALLY'
                    : 'NEW RELEASE'}
          </span>
        </div>
        <div style={{ height: 625, position: 'relative', overflow: 'hidden' }}>
          <Sequence from={0} durationInFrames={150} layout="none">
            <OffthreadVideo
              src={staticFile('media/portals.mp4')}
              muted
              style={{ width: 1000, height: 625, display: 'block' }}
            />
          </Sequence>
          <Sequence from={150} durationInFrames={150} layout="none">
            <OffthreadVideo
              src={staticFile('media/portals.mp4')}
              muted
              style={{ width: 1000, height: 625, display: 'block' }}
            />
          </Sequence>
          <Sequence from={300} durationInFrames={150} layout="none">
            <OffthreadVideo
              src={staticFile('media/portals.mp4')}
              muted
              trimBefore={45}
              style={{ width: 1000, height: 625, display: 'block' }}
            />
          </Sequence>
          {review && (
            <div
              style={{
                position: 'absolute',
                left: 27,
                bottom: 55,
                width: 274,
                borderRadius: 12,
                overflow: 'hidden',
                border: '1px solid #eee4c4a0',
                boxShadow: '0 12px 40px #0008',
                opacity: mix(local, 5, 18),
                transform: `translateY(${mix(local, 5, 24, 12, 0)}px)`,
              }}
            >
              <div
                style={{
                  ...mono,
                  fontSize: 11,
                  padding: '9px 12px',
                  color: C.cream,
                  background: '#294035',
                }}
              >
                THE ORIGINAL · SAME START
              </div>
              <Sequence from={150} durationInFrames={150} layout="none">
                <OffthreadVideo
                  src={staticFile('media/original.mp4')}
                  muted
                  style={{ display: 'block', width: 274, height: 171.25 }}
                />
              </Sequence>
            </div>
          )}
          {scene === 2 && (
            <div
              style={{
                position: 'absolute',
                right: 30,
                bottom: 65,
                background: '#e1edbedf',
                color: '#24342a',
                padding: '12px 18px',
                borderRadius: 50,
                fontSize: 18,
                fontWeight: 600,
                opacity: mix(local, 98, 116),
                transform: `translateY(${mix(local, 98, 116, 12, 0)}px)`,
              }}
            >
              ↗ Ready for everyone’s next run
            </div>
          )}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          right: -12,
          top: -23,
          background: scene === 1 ? C.coral : C.sage,
          color: C.pine,
          padding: '12px 19px',
          ...mono,
          fontSize: 12,
          letterSpacing: 1,
          transform: 'rotate(4deg)',
          boxShadow: '3px 4px 0 #0a1716',
          border: '1px solid #102a20',
        }}
      >
        {chapters[scene].badge}
      </div>
    </div>
  );
}

function Film() {
  const frame = useCurrentFrame(),
    scene = Math.min(2, Math.floor(frame / sceneFrames)),
    local = frame % sceneFrames;
  const enter = mix(local, 0, 12);
  return (
    <AbsoluteFill
      style={{ background: '#132723', color: C.cream, fontFamily: 'DM Sans', overflow: 'hidden' }}
    >
      <Img
        src={staticFile('shared-sky.png')}
        style={{
          position: 'absolute',
          width: 2040,
          height: 1148,
          objectFit: 'cover',
          left: -40 - frame * 0.07,
          top: -35 + Math.sin(frame / 90) * 6,
          opacity: 0.92,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(90deg,rgba(9,23,20,.42),transparent 70%),linear-gradient(0deg,rgba(10,26,22,.94),transparent 29%)',
        }}
      />
      <Audio src={staticFile('score.wav')} volume={0.4} />
      <div
        style={{
          position: 'absolute',
          left: 83,
          top: 38,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Soybert frame={frame} size={72} />
        <div style={{ fontFamily: 'Fredoka', fontSize: 37, letterSpacing: -1 }}>napplet.soy</div>
        <div
          style={{
            marginLeft: 26,
            paddingLeft: 25,
            borderLeft: '1px solid #c1d5ae55',
            ...mono,
            fontSize: 13,
            color: C.muted,
            letterSpacing: 2,
          }}
        >
          SMALL CODE.
          <br />
          BIG WEIRD.
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          right: 90,
          top: 67,
          display: 'flex',
          gap: 29,
          ...mono,
          fontSize: 14,
        }}
      >
        {chapters.map((c, i) => (
          <div
            key={c.verb}
            style={{
              color: i === scene ? C.cream : '#b8c4b47a',
              display: 'flex',
              gap: 9,
              alignItems: 'center',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 5,
                background: i === scene ? C.coral : 'transparent',
              }}
            />
            {String(i + 1).padStart(2, '0')} {c.verb}
          </div>
        ))}
      </div>
      <Spark x={751} y={203} rotate={frame * 0.12} size={27} color={C.coral} />
      <Spark x={789} y={168} rotate={-frame * 0.1} size={12} />
      <div
        key={scene}
        style={{
          position: 'absolute',
          left: 91,
          top: 176,
          opacity: enter,
          transform: `translateY(${(1 - enter) * 14}px)`,
        }}
      >
        <div style={{ ...mono, fontSize: 15, letterSpacing: 2.3, color: C.sage, marginBottom: 26 }}>
          {scene === 0
            ? 'A PLAYER HAS AN IDEA.'
            : scene === 1
              ? 'AN IMPROVEMENT YOU CAN FEEL.'
              : 'GREAT IDEAS FIND THEIR WAY BACK.'}
        </div>
        <h1
          style={{
            fontSize: scene === 2 ? 82 : 91,
            fontWeight: 600,
            lineHeight: 1.03,
            letterSpacing: -4.5,
            margin: 0,
            width: 740,
          }}
        >
          {chapters[scene].title}
        </h1>
        <p
          style={{
            fontSize: 22,
            color: C.muted,
            margin: '25px 0 0',
            letterSpacing: -0.4,
            width: 650,
          }}
        >
          {chapters[scene].description}
        </p>
      </div>
      <style>{`em{font-family:Georgia,serif;font-weight:400;color:${C.coral};letter-spacing:-3px}`}</style>
      <Prompt frame={frame} scene={scene} />
      <Command frame={frame} scene={scene} />
      <GameWindow frame={frame} scene={scene} />
      <Timeline frame={frame} />
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: 91,
          right: 90,
          display: 'flex',
          justifyContent: 'space-between',
          ...mono,
          fontSize: 12,
          color: '#c7d0bc9c',
          letterSpacing: 0.6,
        }}
      >
        <span>NO WEBSITE ACCOUNT NEEDED · OPEN SOURCE BY DEFAULT</span>
        <span>LOCAL GAMEPLAY · ILLUSTRATED COLLABORATION · MOTION STUDY 01</span>
      </div>
      <div
        style={{
          position: 'absolute',
          height: 3,
          bottom: 0,
          left: 0,
          width: `${(frame / 449) * 100}%`,
          background: C.coral,
        }}
      />
    </AbsoluteFill>
  );
}
registerRoot(() => (
  <Composition
    id="CollaborationProof"
    component={Film}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={450}
  />
));
