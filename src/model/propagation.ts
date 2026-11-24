import { crosses, distance } from './geometry';
import { BAND_GHZ, lossTable } from './materials';
import type { MaterialId, ModelSettings, Point, Wall } from './types';

/**
 * Indoor multi-wall path loss (the COST 231 multi-wall form, Motley-Keenan):
 *
 *   L(d) = FSPL(1 m, f) + 10 n log10(d / 1 m) + sum of losses of the walls
 *          crossed by the straight line from router to point
 *
 * With n = 2 the distance term is exactly free-space loss.
 * Received level = EIRP - L(d).
 */

/** Free-space path loss in dB, d in metres, f in MHz (Friis, far field). */
export function fsplDb(dM: number, fMHz: number): number {
  return 20 * Math.log10(dM) + 20 * Math.log10(fMHz) - 27.55;
}

/** Below this distance the model is not meaningful (near field); we clamp to it. */
export const MIN_DISTANCE_M = 0.5;

export function pathLossDb(dM: number, fGHz: number, exponent: number): number {
  const d = Math.max(dM, MIN_DISTANCE_M);
  return fsplDb(1, fGHz * 1000) + 10 * exponent * Math.log10(d);
}

export interface PointReading {
  dbm: number;
  distanceM: number;
  walls: Wall[]; // walls crossed, in no particular order
  wallLossDb: number;
}

export function readingAt(router: Point, p: Point, walls: Wall[], s: ModelSettings): PointReading {
  const losses = lossTable(s.band, s.thicknessM);
  const crossed: Wall[] = [];
  let wl = 0;
  for (const w of walls) {
    if (crosses(router, p, w.a, w.b)) {
      crossed.push(w);
      wl += losses[w.material];
    }
  }
  const d = distance(router, p);
  const dbm = s.eirpDbm - pathLossDb(d, BAND_GHZ[s.band], s.exponent) - wl;
  return { dbm, distanceM: d, walls: crossed, wallLossDb: wl };
}

/** Prepared walls for the hot loop: flat arrays, losses resolved. */
export interface PreparedWalls {
  n: number;
  ax: Float64Array;
  ay: Float64Array;
  sx: Float64Array;
  sy: Float64Array;
  loss: Float64Array;
}

export function prepareWalls(walls: Wall[], losses: Record<MaterialId, number>): PreparedWalls {
  const n = walls.length;
  const pw: PreparedWalls = {
    n,
    ax: new Float64Array(n),
    ay: new Float64Array(n),
    sx: new Float64Array(n),
    sy: new Float64Array(n),
    loss: new Float64Array(n),
  };
  walls.forEach((w, i) => {
    pw.ax[i] = w.a.x;
    pw.ay[i] = w.a.y;
    pw.sx[i] = w.b.x - w.a.x;
    pw.sy[i] = w.b.y - w.a.y;
    pw.loss[i] = losses[w.material];
  });
  return pw;
}
