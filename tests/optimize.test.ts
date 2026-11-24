import { describe, expect, it } from 'vitest';
import { bruteForce, findBestSpot, isPlaceable } from '../src/model/optimize';
import { defaultThickness } from '../src/model/materials';
import { TEMPLATES, makeTemplate } from '../src/plans/templates';
import type { ModelSettings, Plan } from '../src/model/types';

const s = (band: '2.4' | '5'): ModelSettings => ({ band, eirpDbm: 20, exponent: 3, thicknessM: defaultThickness() });

describe('find the best spot', () => {
  for (const t of TEMPLATES) {
    for (const band of ['2.4', '5'] as const) {
      it(`${t.name} at ${band} GHz is never worse than the starting spot`, () => {
        const plan = makeTemplate(t.id);
        const r = findBestSpot(plan, s(band));
        expect(r.best.score.covered).toBeGreaterThanOrEqual(r.start.score.covered);
        expect(isPlaceable(plan, r.best.p, 0.15) || r.best === r.start).toBe(true);
      });
    }
  }

  it('matches an exhaustive search on a small plan', () => {
    // 6 m x 4 m, two rooms split by a concrete wall with a door, router in a corner.
    const plan: Plan = {
      id: 'small', name: 'small', width: 6, height: 4,
      rooms: [{ name: 'A', x: 0, y: 0, w: 3, h: 4 }, { name: 'B', x: 3, y: 0, w: 3, h: 4 }],
      walls: [
        { id: 'w1', a: { x: 3, y: 0 }, b: { x: 3, y: 1.6 }, material: 'concrete' },
        { id: 'w2', a: { x: 3, y: 1.6 }, b: { x: 3, y: 2.4 }, material: 'wood' },
        { id: 'w3', a: { x: 3, y: 2.4 }, b: { x: 3, y: 4 }, material: 'concrete' },
      ],
      router: { x: 0.3, y: 0.3 },
    };
    // Weak transmitter so the choice matters.
    const settings = { ...s('5'), eirpDbm: -5 };
    const fast = findBestSpot(plan, settings);
    const exhaustive = bruteForce(plan, settings, 0.1);
    expect(fast.best.score.covered).toBeGreaterThanOrEqual(exhaustive.score.covered - 0.01);
    expect(fast.best.score.covered).toBeGreaterThan(fast.start.score.covered);
  });

  it('a placeable spot is inside a room and clear of walls', () => {
    const plan = makeTemplate('flat');
    expect(isPlaceable(plan, { x: 6.2, y: 1 }, 0.15)).toBe(false); // on the spine wall
    expect(isPlaceable(plan, { x: -1, y: 1 }, 0.15)).toBe(false); // outside
    expect(isPlaceable(plan, { x: 3, y: 5.5 }, 0.15)).toBe(true); // living room
  });
});
