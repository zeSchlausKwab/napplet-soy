export const DURATION = 24;
export const nodes = [
  {
    id: 'original',
    label: 'Original',
    title: 'A LITTLE WORLD.',
    owner: 'Mika',
    role: 'ORIGINAL CREATOR',
    color: '#d4deae',
    position: [-24, 3, -5],
    start: 1.4,
    reveal: 0,
    done: 4.3,
    variant: 'original',
    prompt: 'Make a little platformer starring Soybert. Jump, collect things, dodge the enemies.',
    before: 'An idea + your favourite AI',
    command: 'soyli publish',
    result: 'Original release · ready to play',
    status: '01 / ORIGINAL RELEASE',
  },
  {
    id: 'remix',
    label: 'Shotgun remix',
    title: 'A LITTLE CHAOS.',
    owner: 'Jules',
    role: 'PLAYER → CONTRIBUTOR',
    color: '#fa9b81',
    position: [-4, -2, 9],
    start: 7.7,
    reveal: 5.5,
    done: 12.4,
    variant: 'shotgun',
    prompt: 'Give Soybert a shotgun. Let me shoot the enemies. Propose it to the creator.',
    before: 'soyli remix <link> soybert-remix',
    command: 'soyli propose\n"Give Soybert a shotgun"',
    result: 'Playable proposal · sent to Mika',
    status: '02 / REMIX → PROPOSAL',
  },
  {
    id: 'merge',
    label: 'Accepted',
    title: 'AN IDEA COMES HOME.',
    owner: 'Mika',
    role: 'ORIGINAL CREATOR',
    color: '#f0c18b',
    position: [16, 3, -5],
    start: 14.5,
    reveal: 13,
    done: 17.5,
    variant: 'shotgun',
    prompt: 'Ridiculous. I love it. Let me try it, then merge the shotgun version.',
    before: 'Try the proposed version',
    command: 'soyli review',
    result: 'Merge locally ✓  ·  not published yet',
    status: '03 / REVIEW → MERGE',
  },
  {
    id: 'release',
    label: 'New release',
    title: 'EVERYONE GETS TO PLAY.',
    owner: 'Mika',
    role: 'WITH JULES’S CONTRIBUTION',
    color: '#9bdec3',
    position: [39, 3, -5],
    start: 19,
    reveal: 18.1,
    done: 21.6,
    variant: 'shotgun',
    prompt: 'Publish it. Let everyone play the new version.',
    before: 'Accepted changes → next release',
    command: 'soyli publish',
    result: 'New release · built together',
    status: '04 / PUBLISH',
  },
] as const;
export const smooth = (value: number) => {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
};
/** Shared visual/audio milestones; the proposal must acquire its change before firing. */
export const beats = {
  deliveryStart: 8.65,
  equipped: 9.65,
  mergeStart: 16.15,
  merged: 17.5,
};
export function typingAt(index: number, time: number, complete = false) {
  const node = nodes[index];
  const promptDuration = Math.min(1.55, Math.max(0.95, node.prompt.length / 48));
  const elapsed = time - node.start;
  const progress = (value: number) => Math.max(0, Math.min(1, value));
  return {
    prompt: complete ? 1 : progress(elapsed / promptDuration),
    command: complete ? 1 : progress((elapsed - promptDuration - 0.12) / 0.8),
  };
}
export function focusPose(index: number) {
  const p = nodes[index].position;
  return { eye: [p[0] + 1.1, p[1] + 2.3, p[2] + 19.5], target: [p[0], p[1] + 0.35, p[2]] };
}
export const overviewPose = { eye: [9, 18, 72], target: [8, -0.5, 0] };
const keys = [
  { t: 0, eye: [-13, 14, 29], target: [-23, 1, -5] },
  { t: 1.5, ...focusPose(0) },
  { t: 5.1, ...focusPose(0) },
  { t: 6.4, eye: [-15, 11, 38], target: [-14, -1, 1] },
  { t: 7.9, ...focusPose(1) },
  { t: 12.6, ...focusPose(1) },
  { t: 13.8, eye: [3, 12, 38], target: [6, 0, 4] },
  { t: 15, ...focusPose(2) },
  { t: 17.8, ...focusPose(2) },
  { t: 18.8, eye: [25, 9, 27], target: [28, 2, -5] },
  { t: 19.7, ...focusPose(3) },
  { t: 22.1, ...focusPose(3) },
  { t: 24, ...overviewPose },
];
export function cameraAt(time: number) {
  const t = Math.max(0, Math.min(DURATION, time));
  let b = keys.findIndex((k) => k.t >= t);
  if (b < 1) b = 1;
  const a = keys[b - 1],
    next = keys[b],
    amount = smooth((t - a.t) / (next.t - a.t));
  return {
    eye: a.eye.map((x, i) => x + (next.eye[i] - x) * amount),
    target: a.target.map((x, i) => x + (next.target[i] - x) * amount),
  };
}
export function chapterAt(time: number) {
  return time < 5.5 ? 0 : time < 13 ? 1 : time < 18.1 ? 2 : 3;
}
