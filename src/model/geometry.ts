import type { Point } from './types';

const EPS = 1e-9;

/**
 * Does the path from p to q cross the wall segment a-b?
 *
 * Conventions (tested in tests/geometry.test.ts):
 * - The path parameter t runs over (0, 1]: a point lying exactly on a wall is
 *   behind that wall, the router sitting on a wall is not.
 * - The wall parameter u runs over [0, 1): where two walls meet end to start,
 *   a path through the junction is counted once, not twice.
 * - Collinear overlap (path running along a wall) does not count as crossing.
 */
export function crosses(p: Point, q: Point, a: Point, b: Point): boolean {
  const rx = q.x - p.x;
  const ry = q.y - p.y;
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < EPS) return false; // parallel or collinear
  const qpx = a.x - p.x;
  const qpy = a.y - p.y;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  return t > EPS && t <= 1 + EPS && u >= -EPS && u < 1 - EPS;
}

export function distance(p: Point, q: Point): number {
  return Math.hypot(q.x - p.x, q.y - p.y);
}

/** Shortest distance from point p to segment a-b. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const len2 = sx * sx + sy * sy;
  if (len2 < EPS) return distance(p, a);
  let u = ((p.x - a.x) * sx + (p.y - a.y) * sy) / len2;
  u = Math.max(0, Math.min(1, u));
  return Math.hypot(p.x - (a.x + u * sx), p.y - (a.y + u * sy));
}
