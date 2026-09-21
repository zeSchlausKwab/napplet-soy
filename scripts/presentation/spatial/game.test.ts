import { expect, test } from 'bun:test';
import { createGame, demoInput, Replay, stepGame } from './game';

test('replaying a version at arbitrary times is independent of seek order', () => {
  const a = new Replay('shotgun'),
    b = new Replay('shotgun');
  a.at(12);
  a.at(0);
  a.at(8.3);
  expect(a.at(3.75)).toEqual(b.at(3.75));
  const copy = a.at(3.75);
  copy.x = -100;
  expect(a.at(3.75).x).not.toBe(-100);
});
test('the same enemy encounter can be jumped in the original and shot in the remix', () => {
  const original = createGame('original'),
    remix = createGame('shotgun');
  for (let i = 0; i < 360; i++) {
    stepGame(original, demoInput(original));
    stepGame(remix, demoInput(remix));
  }
  expect(original.jumps).toBeGreaterThan(0);
  expect(original.shots).toBe(0);
  expect(original.kills).toBe(0);
  expect(remix.shots).toBeGreaterThan(0);
  expect(remix.kills).toBeGreaterThanOrEqual(2);
  expect(original.deaths).toBe(0);
  expect(remix.deaths).toBe(0);
});
test('manual input controls movement, jumping and remix-only shooting', () => {
  for (const variant of ['original', 'shotgun'] as const) {
    const g = createGame(variant);
    for (let i = 0; i < 60; i++) stepGame(g, { right: true, jump: i === 10, shoot: true });
    expect(g.x).toBeGreaterThan(115);
    expect(g.jumps).toBe(1);
    expect(g.shots > 0).toBe(variant === 'shotgun');
  }
});

test('both recorded routes reach the finish without resetting', () => {
  for (const variant of ['original', 'shotgun'] as const) {
    const g = new Replay(variant).at(18);
    expect(g.won).toBe(true);
    expect(g.deaths).toBe(0);
    expect(g.kills).toBe(variant === 'shotgun' ? 6 : 0);
  }
});
