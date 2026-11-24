import type { MaterialId, Plan, Room, Wall } from '../model/types';

/**
 * Built-in floor plans. Illustrative layouts drawn for this app (not copies of
 * real buildings). Coordinates in metres, y grows downwards.
 */

let seq = 0;
const w = (x1: number, y1: number, x2: number, y2: number, material: MaterialId): Wall => ({
  id: `w${++seq}`,
  a: { x: x1, y: y1 },
  b: { x: x2, y: y2 },
  material,
});

/**
 * A horizontal or vertical wall with openings. `gaps` are [from, to, material | null]
 * along the wall's axis; null means an open doorway (no wall at all).
 */
function run(
  axis: 'h' | 'v', fixed: number, from: number, to: number, material: MaterialId,
  gaps: [number, number, MaterialId | null][] = [],
): Wall[] {
  const out: Wall[] = [];
  let cur = from;
  const seg = (s: number, e: number, m: MaterialId) => {
    if (e - s < 1e-6) return;
    out.push(axis === 'h' ? w(s, fixed, e, fixed, m) : w(fixed, s, fixed, e, m));
  };
  for (const [s, e, m] of [...gaps].sort((p, q) => p[0] - q[0])) {
    seg(cur, s, material);
    if (m) seg(s, e, m);
    cur = e;
  }
  seg(cur, to, material);
  return out;
}

const room = (name: string, x: number, y: number, w2: number, h: number): Room => ({ name, x, y, w: w2, h });

function flat(): Plan {
  // Two-bedroom condo unit, 11 m x 8 m. Reinforced concrete shell and party walls,
  // brick between rooms, plasterboard around the bathroom.
  const rooms = [
    room('Kitchen', 0.2, 0.2, 3.0, 3.4),
    room('Bath', 3.2, 0.2, 2.2, 2.2),
    room('Store', 5.4, 0.2, 0.8, 2.2),
    room('Hall', 3.2, 2.4, 3.0, 1.2),
    room('Living + dining', 0.2, 3.6, 6.0, 4.6),
    room('Bedroom 1', 6.2, 0.2, 5.0, 4.2),
    room('Bedroom 2', 6.2, 4.4, 5.0, 3.8),
  ];
  const walls: Wall[] = [
    // shell
    ...run('h', 0.2, 0.2, 11.2, 'concrete'),
    ...run('v', 11.2, 0.2, 8.2, 'concrete', [[1.2, 3.2, 'glass']]),
    ...run('h', 8.2, 0.2, 11.2, 'concrete', [[1.4, 4.6, 'glass'], [7.6, 9.8, 'glass']]),
    ...run('v', 0.2, 0.2, 8.2, 'concrete', [[6.4, 7.4, 'wood']]),
    // kitchen
    ...run('h', 3.6, 0.2, 3.2, 'brick', [[1.0, 2.2, null]]),
    ...run('v', 3.2, 0.2, 3.6, 'brick'),
    // bath + store
    ...run('h', 2.4, 3.2, 6.2, 'plasterboard', [[4.0, 4.8, 'wood'], [5.4, 6.2, 'wood']]),
    ...run('v', 5.4, 0.2, 2.4, 'plasterboard'),
    // bedrooms: concrete spine wall with doors, brick between the bedrooms
    ...run('v', 6.2, 0.2, 8.2, 'concrete', [[2.6, 3.4, 'wood'], [4.8, 5.6, 'wood']]),
    ...run('h', 4.4, 6.2, 11.2, 'brick'),
  ];
  return {
    id: 'flat',
    name: 'Two-bedroom flat',
    width: 11.4,
    height: 8.4,
    rooms,
    walls,
    router: { x: 0.7, y: 7.7 }, // where the fibre comes in: by the front door
  };
}

function hostel(): Plan {
  // One hostel wing: six study rooms off a corridor, concrete block between rooms.
  const rooms: Room[] = [];
  const walls: Wall[] = [];
  const roomW = 2.8;
  const n = 6;
  const x0 = 0.2;
  const len = n * roomW;
  for (let k = 0; k < n; k++) {
    rooms.push(room(`Room ${String.fromCharCode(65 + k)}`, x0 + k * roomW, 0.2, roomW, 3.6));
  }
  rooms.push(room('Corridor', x0, 3.8, len, 1.8));
  walls.push(
    ...run('h', 0.2, x0, x0 + len, 'concrete',
      Array.from({ length: n }, (_, k) => [x0 + k * roomW + 0.7, x0 + k * roomW + 2.1, 'glass'] as [number, number, MaterialId])),
    ...run('h', 5.6, x0, x0 + len, 'concrete'),
    ...run('v', x0, 0.2, 5.6, 'concrete', [[3.9, 5.5, 'glass']]),
    ...run('v', x0 + len, 0.2, 5.6, 'concrete', [[3.9, 5.5, 'glass']]),
    // room fronts onto the corridor: block wall with a wooden door
    ...run('h', 3.8, x0, x0 + len, 'concrete',
      Array.from({ length: n }, (_, k) => [x0 + k * roomW + 1.6, x0 + k * roomW + 2.5, 'wood'] as [number, number, MaterialId])),
  );
  for (let k = 1; k < n; k++) walls.push(...run('v', x0 + k * roomW, 0.2, 3.8, 'concrete'));
  return {
    id: 'hostel',
    name: 'Hostel wing',
    width: len + 0.4,
    height: 5.8,
    rooms,
    walls,
    router: { x: 0.7, y: 4.7 }, // access point at the stairwell end
  };
}

function terrace(): Plan {
  // Single-storey terrace (link) house, 6.4 m wide and 14.4 m deep, drawn sideways:
  // the front door is on the left, the kitchen at the back on the right.
  const rooms = [
    room('Living', 0.2, 0.2, 5.4, 6.4),
    room('Bedroom 1', 5.6, 0.2, 4.0, 3.4),
    room('Bedroom 2', 5.6, 3.6, 4.0, 3.0),
    room('Bath', 9.6, 0.2, 1.8, 2.4),
    room('Dining', 9.6, 2.6, 2.6, 4.0),
    room('Kitchen', 12.2, 0.2, 2.4, 6.4),
  ];
  const walls: Wall[] = [
    // party walls brick; front and back walls brick with glass and a door
    ...run('h', 0.2, 0.2, 14.6, 'brick'),
    ...run('h', 6.6, 0.2, 14.6, 'brick'),
    ...run('v', 0.2, 0.2, 6.6, 'brick', [[1.2, 2.2, 'wood'], [3.2, 5.6, 'glass']]),
    ...run('v', 14.6, 0.2, 6.6, 'brick', [[1.6, 3.2, 'glass'], [4.4, 5.4, 'wood']]),
    // living / bedrooms
    ...run('v', 5.6, 0.2, 6.6, 'brick', [[2.6, 3.4, 'wood'], [3.8, 4.6, 'wood']]),
    ...run('h', 3.6, 5.6, 9.6, 'brick'),
    // bedrooms / back of house, open to the dining area
    ...run('v', 9.6, 0.2, 6.6, 'brick', [[3.6, 5.6, null]]),
    // bathroom: plasterboard wet wall
    ...run('h', 2.6, 9.6, 11.4, 'plasterboard', [[10.0, 10.8, 'wood']]),
    ...run('v', 11.4, 0.2, 2.6, 'plasterboard'),
    // wet kitchen: concrete wall with an opening
    ...run('v', 12.2, 0.2, 6.6, 'concrete', [[2.6, 4.4, null]]),
  ];
  return {
    id: 'terrace',
    name: 'Terrace house',
    width: 14.8,
    height: 6.8,
    rooms,
    walls,
    router: { x: 0.6, y: 0.6 }, // TV corner by the front wall
  };
}

export const TEMPLATES: { id: string; name: string; make: () => Plan }[] = [
  { id: 'flat', name: 'Two-bedroom flat', make: flat },
  { id: 'hostel', name: 'Hostel wing', make: hostel },
  { id: 'terrace', name: 'Terrace house', make: terrace },
];

export function makeTemplate(id: string): Plan {
  const t = TEMPLATES.find((x) => x.id === id) ?? TEMPLATES[0];
  return structuredClone(t.make());
}
