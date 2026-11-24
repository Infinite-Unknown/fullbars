import { barsFor, COVERED_MIN_BARS, THRESHOLDS, type Bars } from './classes';
import { BAND_GHZ, lossTable } from './materials';
import { MIN_DISTANCE_M, fsplDb, prepareWalls, type PreparedWalls } from './propagation';
import type { ModelSettings, Plan, Point } from './types';

const EPS = 1e-9;

export interface Grid {
  cell: number; // metres per cell
  cols: number;
  rows: number;
  /** 1 where the cell centre is inside a room (counts for coverage). */
  mask: Uint8Array;
  floorCells: number;
}

export function makeGrid(plan: Plan, cell: number): Grid {
  const cols = Math.max(1, Math.round(plan.width / cell));
  const rows = Math.max(1, Math.round(plan.height / cell));
  const mask = new Uint8Array(cols * rows);
  let floorCells = 0;
  for (let j = 0; j < rows; j++) {
    const y = (j + 0.5) * cell;
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) * cell;
      for (const r of plan.rooms) {
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          mask[j * cols + i] = 1;
          floorCells++;
          break;
        }
      }
    }
  }
  return { cell, cols, rows, mask, floorCells };
}

export function insideFloor(plan: Plan, p: Point): boolean {
  return plan.rooms.some((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
}

export interface Field {
  grid: Grid;
  dbm: Float32Array;
  wallsCrossed: Uint8Array;
}

export interface Coverage {
  /** Share of floor area per bar count, 0..1, index = bars. */
  share: [number, number, number, number, number];
  /** Share of floor area with >= 3 bars. */
  covered: number;
  meanDbm: number;
}

/** Received level from one router at one point, using prepared walls. Returns [dbm, wallsCrossed]. */
function levelAt(
  rx: number, ry: number, px: number, py: number,
  pw: PreparedWalls, eirp: number, fspl1: number, tenN: number,
): [number, number] {
  const dx = px - rx;
  const dy = py - ry;
  let wl = 0;
  let count = 0;
  for (let k = 0; k < pw.n; k++) {
    const sx = pw.sx[k];
    const sy = pw.sy[k];
    const denom = dx * sy - dy * sx;
    if (denom > -EPS && denom < EPS) continue;
    const qpx = pw.ax[k] - rx;
    const qpy = pw.ay[k] - ry;
    const t = (qpx * sy - qpy * sx) / denom;
    if (t <= EPS || t > 1 + EPS) continue;
    const u = (qpx * dy - qpy * dx) / denom;
    if (u < -EPS || u >= 1 - EPS) continue;
    wl += pw.loss[k];
    count++;
  }
  const d = Math.max(Math.sqrt(dx * dx + dy * dy), MIN_DISTANCE_M);
  return [eirp - fspl1 - tenN * Math.log10(d) - wl, count];
}

interface Ctx {
  pw: PreparedWalls;
  eirp: number;
  fspl1: number;
  tenN: number;
}

function context(plan: Plan, s: ModelSettings): Ctx {
  const pw = prepareWalls(plan.walls, lossTable(s.band, s.thicknessM));
  return { pw, eirp: s.eirpDbm, fspl1: fsplDb(1, BAND_GHZ[s.band] * 1000), tenN: 10 * s.exponent };
}

export function computeField(plan: Plan, grid: Grid, router: Point, s: ModelSettings, out?: Field): Field {
  const n = grid.cols * grid.rows;
  const f: Field = out ?? { grid, dbm: new Float32Array(n), wallsCrossed: new Uint8Array(n) };
  const ctx = context(plan, s);
  const h = grid.cell;
  for (let j = 0; j < grid.rows; j++) {
    const y = (j + 0.5) * h;
    for (let i = 0; i < grid.cols; i++) {
      const x = (i + 0.5) * h;
      const [v, c] = levelAt(router.x, router.y, x, y, ctx.pw, ctx.eirp, ctx.fspl1, ctx.tenN);
      const idx = j * grid.cols + i;
      f.dbm[idx] = v;
      f.wallsCrossed[idx] = c > 255 ? 255 : c;
    }
  }
  return f;
}

export function coverageOf(field: Field): Coverage {
  const { grid, dbm } = field;
  const counts = [0, 0, 0, 0, 0];
  let sum = 0;
  for (let k = 0; k < dbm.length; k++) {
    if (!grid.mask[k]) continue;
    counts[barsFor(dbm[k])]++;
    sum += dbm[k];
  }
  const total = grid.floorCells || 1;
  const share = counts.map((c) => c / total) as Coverage['share'];
  const covered = share[3] + share[4];
  return { share, covered, meanDbm: sum / total };
}

/**
 * Coverage score of a router position, evaluated on the grid's floor cells only.
 * Faster than computeField + coverageOf because it skips storing the field.
 */
export function scorePosition(plan: Plan, grid: Grid, router: Point, s: ModelSettings, ctx?: Ctx): Coverage {
  const c = ctx ?? context(plan, s);
  const counts = [0, 0, 0, 0, 0];
  let sum = 0;
  const h = grid.cell;
  for (let j = 0; j < grid.rows; j++) {
    const y = (j + 0.5) * h;
    for (let i = 0; i < grid.cols; i++) {
      if (!grid.mask[j * grid.cols + i]) continue;
      const x = (i + 0.5) * h;
      const [v] = levelAt(router.x, router.y, x, y, c.pw, c.eirp, c.fspl1, c.tenN);
      counts[barsFor(v)]++;
      sum += v;
    }
  }
  const total = grid.floorCells || 1;
  const share = counts.map((k) => k / total) as Coverage['share'];
  return { share, covered: share[3] + share[4], meanDbm: sum / total };
}

export { context as modelContext };
export type { Ctx as ModelContext, Bars };
export const COVERED_THRESHOLD_DBM = THRESHOLDS[4 - COVERED_MIN_BARS];
