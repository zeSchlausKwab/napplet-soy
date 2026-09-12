import { test, expect } from 'bun:test';
import records from '../../backend/data/catalog.json';
import { Matchmaking } from './matchmaking';
const args = { napplet: records[0].naddr, artifact: records[0].artifactHash };
const a = 'a'.repeat(64),
  b = 'b'.repeat(64),
  c = 'c'.repeat(64);
test('matchmaking is idempotent, authorizes tickets, and closes matches when a peer leaves', () => {
  const m = new Matchmaking();
  const first = m.join(a, args);
  expect(m.join(a, args).ticket).toBe(first.ticket);
  expect(m.join(b, args).state).toBe('matched');
  expect(m.status(a, { ticket: first.ticket }).peers).toEqual([a, b]);
  expect(() => m.status(c, { ticket: first.ticket })).toThrow('unavailable');
  const second = m.join(b, args);
  m.leave(a, { ticket: first.ticket });
  expect(m.status(b, { ticket: second.ticket }).state).toBe('closed');
});
test('queues separate versions and expire absent players', () => {
  let now = 1_000_000;
  const m = new Matchmaking(() => now);
  const first = m.join(a, args);
  expect(m.join(b, { ...args, artifact: 'f'.repeat(64) }).state).toBe('waiting');
  now += 61_000;
  expect(() => m.status(a, { ticket: first.ticket })).toThrow();
  expect(m.join(c, args).state).toBe('waiting');
});
test('state is bounded and invalid actors cannot create tickets', () => {
  const m = new Matchmaking(Date.now, 1);
  expect(() => m.join('not-authenticated', args)).toThrow();
  m.join(a, args);
  expect(() => m.join(b, args)).toThrow('full');
});
