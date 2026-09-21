import { CubicBezierCurve3, CurvePath, LineCurve3, Vector3 } from 'three';

/** Straight history lanes, with tangent-continuous quarter-circle Bézier elbows. */
export function roundedPath(points: Vector3[], radius = 2.4) {
  const path = new CurvePath<Vector3>();
  let previous = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const corner = points[i];
    const incoming = corner.clone().sub(points[i - 1]);
    const outgoing = points[i + 1].clone().sub(corner);
    const r = Math.min(radius, incoming.length() / 2, outgoing.length() / 2);
    incoming.normalize();
    outgoing.normalize();
    const entry = corner.clone().addScaledVector(incoming, -r);
    const exit = corner.clone().addScaledVector(outgoing, r);
    path.add(new LineCurve3(previous, entry));
    const handle = r * (4 / 3) * Math.tan(Math.PI / 8);
    path.add(
      new CubicBezierCurve3(
        entry,
        entry.clone().addScaledVector(incoming, handle),
        exit.clone().addScaledVector(outgoing, -handle),
        exit,
      ),
    );
    previous = exit;
  }
  path.add(new LineCurve3(previous, points.at(-1)!));
  return path;
}

export function historyLane(from: Vector3, to: Vector3) {
  if (from.y === to.y && from.z === to.z) return [from, to];
  const elbowX = (from.x + to.x) / 2;
  return [from, new Vector3(elbowX, from.y, from.z), new Vector3(elbowX, to.y, to.z), to];
}
