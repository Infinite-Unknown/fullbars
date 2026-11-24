export interface Point {
  x: number; // metres
  y: number; // metres
}

export type MaterialId = 'concrete' | 'brick' | 'plasterboard' | 'glass' | 'wood';

export interface Wall {
  id: string;
  a: Point;
  b: Point;
  material: MaterialId;
}

export interface Room {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Plan {
  id: string;
  name: string;
  width: number; // metres, drawing extent
  height: number;
  rooms: Room[]; // union of rooms = floor area that counts for coverage
  walls: Wall[];
  router: Point;
}

export type Band = '2.4' | '5';

export interface ModelSettings {
  band: Band;
  eirpDbm: number; // transmit power + antenna gain, dBm
  exponent: number; // distance power exponent n (2 = free space)
  thicknessM: Record<MaterialId, number>; // per-material thickness used in the slab model
}
