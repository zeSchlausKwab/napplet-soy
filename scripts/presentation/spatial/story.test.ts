import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { historyLane, roundedPath } from './paths';
import { nodes, typingAt } from './story';

test('each prompt finishes before its command and both finish before the outcome', () => {
  nodes.forEach((node, index) => {
    expect(typingAt(index, node.start - 1)).toEqual({ prompt: 0, command: 0 });
    const during = typingAt(index, node.start + 0.5);
    expect(during.prompt).toBeGreaterThan(0);
    expect(during.prompt).toBeLessThan(1);
    expect(during.command).toBe(0);
    expect(typingAt(index, node.done)).toEqual({ prompt: 1, command: 1 });
    expect(typingAt(index, 0, true)).toEqual({ prompt: 1, command: 1 });
  });
});

test('history curves join straight lanes without gaps or abrupt tangent changes', () => {
  for (const [from, to] of [
    [0, 2],
    [0, 1],
    [1, 2],
    [2, 3],
  ]) {
    const a = new Vector3(...nodes[from].position),
      b = new Vector3(...nodes[to].position);
    const path = roundedPath(historyLane(a, b));
    expect(path.getPoint(0).distanceTo(a)).toBeLessThan(1e-8);
    expect(path.getPoint(1).distanceTo(b)).toBeLessThan(1e-8);
    for (let i = 1; i < path.curves.length; i++) {
      const previous = path.curves[i - 1],
        next = path.curves[i];
      expect(previous.getPoint(1).distanceTo(next.getPoint(0))).toBeLessThan(1e-8);
      expect(previous.getTangent(1).dot(next.getTangent(0))).toBeGreaterThan(0.999);
    }
  }
});
