import { describe, expect, it } from 'vitest';
import { crosses, distanceToSegment } from '../src/model/geometry';
import { BAND_GHZ, MATERIALS, defaultThickness, permittivity, slabLossDb, wallLossDb } from '../src/model/materials';
import { MIN_DISTANCE_M, fsplDb, pathLossDb, readingAt } from '../src/model/propagation';
import { barsFor } from '../src/model/classes';
import { computeField, coverageOf, makeGrid, scorePosition } from '../src/model/field';
import type { ModelSettings, Plan, Wall } from '../src/model/types';

const settings = (band: '2.4' | '5' = '2.4', exponent = 2): ModelSettings => ({
  band,
  eirpDbm: 20,
  exponent,
  thicknessM: defaultThickness(),
});

const wall = (id: string, x1: number, y1: number, x2: number, y2: number, material: Wall['material'] = 'brick'): Wall => ({
  id, a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, material,
});

describe('segment crossing', () => {
  const p = { x: 0, y: 0 };
  it('counts a wall straight across the path', () => {
    expect(crosses(p, { x: 4, y: 0 }, { x: 2, y: -1 }, { x: 2, y: 1 })).toBe(true);
  });
  it('ignores a wall beyond the end of the path', () => {
    expect(crosses(p, { x: 1.5, y: 0 }, { x: 2, y: -1 }, { x: 2, y: 1 })).toBe(false);
  });
  it('ignores a wall that stops short of the path', () => {
    expect(crosses(p, { x: 4, y: 0 }, { x: 2, y: 0.5 }, { x: 2, y: 2 })).toBe(false);
  });
  it('ignores a path running along a wall', () => {
    expect(crosses(p, { x: 4, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 })).toBe(false);
  });
  it('counts a point lying exactly on a wall as behind it, a router on a wall as not', () => {
    expect(crosses(p, { x: 2, y: 0 }, { x: 2, y: -1 }, { x: 2, y: 1 })).toBe(true);
    expect(crosses({ x: 2, y: 0 }, { x: 4, y: 0 }, { x: 2, y: -1 }, { x: 2, y: 1 })).toBe(false);
  });
  it('counts a path through the joint of two collinear walls once', () => {
    const a = [{ x: 2, y: -1 }, { x: 2, y: 0 }] as const;
    const b = [{ x: 2, y: 0 }, { x: 2, y: 1 }] as const;
    const q = { x: 4, y: 0 };
    const n = Number(crosses(p, q, a[0], a[1])) + Number(crosses(p, q, b[0], b[1]));
    expect(n).toBe(1);
  });
  it('passes through a door gap', () => {
    // wall with a gap between y = -0.4 and 0.4
    const n = Number(crosses(p, { x: 4, y: 0 }, { x: 2, y: -2 }, { x: 2, y: -0.4 }))
      + Number(crosses(p, { x: 4, y: 0 }, { x: 2, y: 0.4 }, { x: 2, y: 2 }));
    expect(n).toBe(0);
  });
  it('measures distance to a segment', () => {
    expect(distanceToSegment({ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(1);
    expect(distanceToSegment({ x: 3, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(2);
  });
});

describe('free-space and path loss', () => {
  it('matches hand-calculated FSPL at 1 m', () => {
    // 20 log10(2437) - 27.55 = 40.187 dB ; 20 log10(5180) - 27.55 = 46.737 dB
    expect(fsplDb(1, 2437)).toBeCloseTo(40.187, 2);
    expect(fsplDb(1, 5180)).toBeCloseTo(46.737, 2);
  });
  it('adds 6.02 dB per doubling of distance in free space', () => {
    expect(fsplDb(10, 2437) - fsplDb(5, 2437)).toBeCloseTo(6.0206, 3);
  });
  it('adds 10 n dB per decade with exponent n', () => {
    expect(pathLossDb(10, 2.437, 3) - pathLossDb(1, 2.437, 3)).toBeCloseTo(30, 6);
  });
  it('clamps distances inside the near field', () => {
    expect(pathLossDb(0, 2.437, 2)).toBeCloseTo(pathLossDb(MIN_DISTANCE_M, 2.437, 2), 9);
    expect(Number.isFinite(pathLossDb(0, 2.437, 2))).toBe(true);
  });
});

describe('ITU-R P.2040-4 slab loss', () => {
  it('computes permittivity from Table 3', () => {
    const e = permittivity(MATERIALS.concrete, 1);
    expect(e.re).toBeCloseTo(5.24);
    expect(e.im).toBeCloseTo(-17.98 * 0.0462, 6);
  });
  it('matches an independent complex-number implementation (reference values)', () => {
    // Reference values computed separately with Python cmath from the same equations.
    const ref: Record<string, [number, number]> = {
      concrete: [11.482, 19.345],
      brick: [3.745, 3.625],
      plasterboard: [2.174, 2.217],
      wood: [0.614, 1.338],
      glass: [1.943, 3.334],
    };
    for (const [id, [l24, l5]] of Object.entries(ref)) {
      expect(wallLossDb(id as Wall['material'], '2.4')).toBeCloseTo(l24, 2);
      expect(wallLossDb(id as Wall['material'], '5')).toBeCloseTo(l5, 2);
    }
  });
  it('is within 15% of 3GPP TR 38.901 concrete (23 cm reference)', () => {
    // 3GPP TR 38.901 V19.5.0 Table 7.4.3-1: L_concrete = 5 + 4 f (f in GHz)
    for (const f of [BAND_GHZ['2.4'], BAND_GHZ['5']]) {
      const itu = slabLossDb(MATERIALS.concrete, f, 0.23);
      const ref = 5 + 4 * f;
      expect(Math.abs(itu - ref) / ref).toBeLessThan(0.15);
    }
  });
  it('is zero for zero thickness and grows with thickness for a lossy wall', () => {
    expect(slabLossDb(MATERIALS.concrete, 2.437, 0)).toBe(0);
    expect(slabLossDb(MATERIALS.concrete, 2.437, 0.3)).toBeGreaterThan(slabLossDb(MATERIALS.concrete, 2.437, 0.15));
  });
});

describe('received level', () => {
  it('equals EIRP minus free space minus the walls crossed', () => {
    const walls = [wall('a', 2, -1, 2, 1, 'brick'), wall('b', 4, -1, 4, 1, 'concrete'), wall('c', 9, -1, 9, 1, 'concrete')];
    const r = readingAt({ x: 0, y: 0 }, { x: 6, y: 0 }, walls, settings('2.4', 2));
    const expected = 20 - fsplDb(6, 2437) - wallLossDb('brick', '2.4') - wallLossDb('concrete', '2.4');
    expect(r.walls.map((w) => w.id).sort()).toEqual(['a', 'b']);
    expect(r.dbm).toBeCloseTo(expected, 6);
  });
  it('maps levels to bars at the cited thresholds', () => {
    expect(barsFor(-60)).toBe(4);
    expect(barsFor(-67)).toBe(4);
    expect(barsFor(-67.01)).toBe(3);
    expect(barsFor(-74)).toBe(3);
    expect(barsFor(-79)).toBe(2);
    expect(barsFor(-82)).toBe(1);
    expect(barsFor(-82.01)).toBe(0);
  });
});

const box: Plan = {
  id: 't', name: 'test', width: 8, height: 4,
  rooms: [{ name: 'A', x: 0, y: 0, w: 4, h: 4 }, { name: 'B', x: 4, y: 0, w: 4, h: 4 }],
  walls: [wall('mid', 4, 0, 4, 4, 'concrete')],
  router: { x: 1, y: 2 },
};

describe('field and coverage', () => {
  it('only counts floor cells and the shares add to one', () => {
    const g = makeGrid(box, 0.5);
    expect(g.floorCells).toBe(16 * 8);
    const c = coverageOf(computeField(box, g, box.router, settings('5', 3)));
    expect(c.share.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
  it('agrees with the per-point reading', () => {
    const g = makeGrid(box, 0.5);
    const f = computeField(box, g, box.router, settings('5', 3));
    const idx = 3 * g.cols + 12; // cell centre (6.25, 1.75)
    const r = readingAt(box.router, { x: 6.25, y: 1.75 }, box.walls, settings('5', 3));
    expect(f.dbm[idx]).toBeCloseTo(r.dbm, 4);
    expect(f.wallsCrossed[idx]).toBe(1);
  });
  it('scorePosition matches computeField + coverageOf', () => {
    const g = makeGrid(box, 0.25);
    const s = settings('5', 3);
    const a = scorePosition(box, g, box.router, s);
    const b = coverageOf(computeField(box, g, box.router, s));
    expect(a.covered).toBeCloseTo(b.covered, 4);
    expect(a.meanDbm).toBeCloseTo(b.meanDbm, 3);
  });
});
