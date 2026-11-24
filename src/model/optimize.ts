import { distanceToSegment } from './geometry';
import { insideFloor, makeGrid, modelContext, scorePosition, type Coverage, type Grid } from './field';
import type { ModelSettings, Plan, Point } from './types';

export interface SearchOptions {
  /** Spacing of the coarse candidate lattice, metres. */
  coarseStep: number;
  /** Spacing of the local refinement lattice, metres. */
  fineStep: number;
  /** Half-width of the refinement window around the best coarse spot, metres. */
  refineRadius: number;
  /** Cell size of the grid the coverage is scored on, metres. */
  evalCell: number;
  /** Keep candidates at least this far from any wall (a router does not sit inside a wall). */
  wallClearance: number;
}

export const DEFAULT_SEARCH: SearchOptions = {
  coarseStep: 0.5,
  fineStep: 0.1,
  refineRadius: 0.4,
  evalCell: 0.25,
  wallClearance: 0.3,
};

export interface Candidate {
  p: Point;
  score: Coverage;
}

export interface SearchResult {
  start: Candidate;
  best: Candidate;
  evaluated: number;
}

/** Larger is better: covered share first, then strong share, then mean level. */
export function better(a: Coverage, b: Coverage): boolean {
  const e = 1e-9;
  if (a.covered > b.covered + e) return true;
  if (a.covered < b.covered - e) return false;
  if (a.share[4] > b.share[4] + e) return true;
  if (a.share[4] < b.share[4] - e) return false;
  return a.meanDbm > b.meanDbm + e;
}

export function isPlaceable(plan: Plan, p: Point, clearance: number): boolean {
  if (!insideFloor(plan, p)) return false;
  return plan.walls.every((w) => distanceToSegment(p, w.a, w.b) >= clearance);
}

export function lattice(plan: Plan, step: number, clearance: number, around?: { c: Point; r: number }): Point[] {
  const pts: Point[] = [];
  const x0 = around ? around.c.x - around.r : step / 2;
  const x1 = around ? around.c.x + around.r + 1e-9 : plan.width;
  const y0 = around ? around.c.y - around.r : step / 2;
  const y1 = around ? around.c.y + around.r + 1e-9 : plan.height;
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      const p = { x: +x.toFixed(4), y: +y.toFixed(4) };
      if (isPlaceable(plan, p, clearance)) pts.push(p);
    }
  }
  return pts;
}

/**
 * Coarse-to-fine search for the router position with the most floor area at 3 bars or more.
 * A generator so the UI can run it in slices and draw progress; each yield reports
 * the candidates scored so far.
 */
export function* searchSteps(
  plan: Plan,
  s: ModelSettings,
  opts: SearchOptions = DEFAULT_SEARCH,
  sliceSize = 24,
): Generator<{ scored: Candidate[]; best: Candidate }, SearchResult> {
  const grid: Grid = makeGrid(plan, opts.evalCell);
  const ctx = modelContext(plan, s);
  const start: Candidate = { p: { ...plan.router }, score: scorePosition(plan, grid, plan.router, s, ctx) };
  let best = start;
  let evaluated = 1;

  const run = function* (pts: Point[]) {
    for (let i = 0; i < pts.length; i += sliceSize) {
      const scored: Candidate[] = [];
      for (const p of pts.slice(i, i + sliceSize)) {
        const score = scorePosition(plan, grid, p, s, ctx);
        evaluated++;
        const cand = { p, score };
        scored.push(cand);
        if (better(score, best.score)) best = cand;
      }
      yield { scored, best };
    }
  };

  yield* run(lattice(plan, opts.coarseStep, opts.wallClearance));
  yield* run(lattice(plan, opts.fineStep, opts.wallClearance, { c: best.p, r: opts.refineRadius }));
  return { start, best, evaluated };
}

export function findBestSpot(plan: Plan, s: ModelSettings, opts: SearchOptions = DEFAULT_SEARCH): SearchResult {
  const it = searchSteps(plan, s, opts, 1_000_000);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

/** Exhaustive search on one lattice. Used by the tests as ground truth. */
export function bruteForce(plan: Plan, s: ModelSettings, step: number, opts: SearchOptions = DEFAULT_SEARCH): Candidate {
  const grid = makeGrid(plan, opts.evalCell);
  const ctx = modelContext(plan, s);
  let best: Candidate | null = null;
  for (const p of lattice(plan, step, opts.wallClearance)) {
    const score = scorePosition(plan, grid, p, s, ctx);
    if (!best || better(score, best.score)) best = { p, score };
  }
  if (!best) throw new Error('no placeable position');
  return best;
}
