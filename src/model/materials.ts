import type { Band, MaterialId } from './types';

/**
 * Wall loss from published material properties.
 *
 * Source: Recommendation ITU-R P.2040-4 (09/2025), "Effects of building
 * materials and structures on radio-wave propagation".
 *  - Table 3: real relative permittivity  e' = a * f^b,
 *             conductivity               sigma = c * f^d   (f in GHz, sigma in S/m)
 *  - Eq. (59): imaginary part             e'' = 17.98 * sigma / f
 *  - Eqs. (43b), (44): transmission coefficient of a single-layer slab.
 * We evaluate the slab at normal incidence (theta = 0), where the TE and TM
 * cases coincide, and report the loss as -20 log10 |T|.
 */
export interface MaterialSpec {
  id: MaterialId;
  label: string;
  /** What a wall of this material is in the plan, in plain words. */
  example: string;
  /** ITU-R P.2040-4 Table 3 coefficients, valid range 1-100 GHz unless noted. */
  a: number;
  b: number;
  c: number;
  d: number;
  /** Default thickness of one layer, metres. */
  thicknessM: number;
  /** Number of identical layers (a stud partition has two boards). */
  layers: number;
}

export const MATERIALS: Record<MaterialId, MaterialSpec> = {
  concrete: {
    id: 'concrete',
    label: 'Concrete',
    example: 'Reinforced or block wall, 150 mm',
    a: 5.24, b: 0, c: 0.0462, d: 0.7822,
    thicknessM: 0.15,
    layers: 1,
  },
  brick: {
    id: 'brick',
    label: 'Brick',
    example: 'Half-brick wall, 115 mm',
    a: 3.91, b: 0, c: 0.0238, d: 0.16, // Table 3 range 1-40 GHz
    thicknessM: 0.115,
    layers: 1,
  },
  plasterboard: {
    id: 'plasterboard',
    label: 'Plasterboard',
    example: 'Stud partition, two 12.5 mm boards',
    a: 2.73, b: 0, c: 0.0085, d: 0.9395,
    thicknessM: 0.0125,
    layers: 2,
  },
  glass: {
    id: 'glass',
    label: 'Glass',
    example: 'Window or sliding door, 6 mm',
    a: 6.31, b: 0, c: 0.0036, d: 1.3394, // Table 3 range 0.1-100 GHz
    thicknessM: 0.006,
    layers: 1,
  },
  wood: {
    id: 'wood',
    label: 'Wood door',
    example: 'Solid door, 40 mm',
    a: 1.99, b: 0, c: 0.0047, d: 1.0718, // Table 3 range 0.001-100 GHz
    thicknessM: 0.04,
    layers: 1,
  },
};

export const MATERIAL_ORDER: MaterialId[] = ['concrete', 'brick', 'plasterboard', 'glass', 'wood'];

/** Centre frequency used for each band, GHz (channel 6 and channel 36). */
export const BAND_GHZ: Record<Band, number> = { '2.4': 2.437, '5': 5.18 };

const C0 = 299_792_458; // m/s

/** Complex relative permittivity e' - j e'' for a material at f GHz (ITU-R P.2040-4 eqs. 57-59). */
export function permittivity(m: Pick<MaterialSpec, 'a' | 'b' | 'c' | 'd'>, fGHz: number): { re: number; im: number } {
  const er = m.a * Math.pow(fGHz, m.b);
  const sigma = m.c * Math.pow(fGHz, m.d);
  return { re: er, im: -(17.98 * sigma) / fGHz };
}

// --- minimal complex arithmetic --------------------------------------------
type C = { re: number; im: number };
const c = (re: number, im = 0): C => ({ re, im });
const add = (x: C, y: C): C => c(x.re + y.re, x.im + y.im);
const sub = (x: C, y: C): C => c(x.re - y.re, x.im - y.im);
const mul = (x: C, y: C): C => c(x.re * y.re - x.im * y.im, x.re * y.im + x.im * y.re);
const div = (x: C, y: C): C => {
  const den = y.re * y.re + y.im * y.im;
  return c((x.re * y.re + x.im * y.im) / den, (x.im * y.re - x.re * y.im) / den);
};
const csqrt = (x: C): C => {
  const r = Math.hypot(x.re, x.im);
  const re = Math.sqrt((r + x.re) / 2);
  const im = Math.sign(x.im || 1) * Math.sqrt((r - x.re) / 2);
  return c(re, im);
};
/** exp(-j z) for complex z. */
const expMinusJ = (z: C): C => {
  // -j z = -j(re + j im) = im - j re
  const mag = Math.exp(z.im);
  return c(mag * Math.cos(-z.re), mag * Math.sin(-z.re));
};
const abs = (x: C): number => Math.hypot(x.re, x.im);

/**
 * Transmission loss in dB of one slab of thickness dM metres at normal incidence,
 * ITU-R P.2040-4 eqs. (43b) and (44) with theta = 0.
 */
export function slabLossDb(m: Pick<MaterialSpec, 'a' | 'b' | 'c' | 'd'>, fGHz: number, dM: number): number {
  if (dM <= 0) return 0;
  const eta = permittivity(m, fGHz);
  const root = csqrt(eta);
  // Fresnel reflection at normal incidence: R' = (1 - sqrt(eta)) / (1 + sqrt(eta))
  const r = div(sub(c(1), root), add(c(1), root));
  const lambda = C0 / (fGHz * 1e9);
  const q = mul(c((2 * Math.PI * dM) / lambda), root);
  const r2 = mul(r, r);
  const num = mul(sub(c(1), r2), expMinusJ(q));
  const den = sub(c(1), mul(r2, expMinusJ(mul(c(2), q))));
  const t = abs(div(num, den));
  return -20 * Math.log10(t);
}

/** Loss of one wall of this material in dB at the given band and thickness. */
export function wallLossDb(id: MaterialId, band: Band, thicknessM?: number): number {
  const m = MATERIALS[id];
  const d = thicknessM ?? m.thicknessM;
  return m.layers * slabLossDb(m, BAND_GHZ[band], d);
}

export function lossTable(band: Band, thickness: Record<MaterialId, number>): Record<MaterialId, number> {
  const out = {} as Record<MaterialId, number>;
  for (const id of MATERIAL_ORDER) out[id] = wallLossDb(id, band, thickness[id]);
  return out;
}

export function defaultThickness(): Record<MaterialId, number> {
  const out = {} as Record<MaterialId, number>;
  for (const id of MATERIAL_ORDER) out[id] = MATERIALS[id].thicknessM;
  return out;
}
