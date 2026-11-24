import { THRESHOLDS, type Bars } from '../model/classes';

/**
 * Map fills for the heat layer. One cobalt hue stepping in OKLCH lightness, calmer than the
 * brand cobalt so ink walls, labels and the router pin stay on top. Band edges are crisp
 * steps; inside a band the colour moves from `edge` (just above the band's threshold) to
 * `core` (the band's strongest), so signal visibly falls away from the router even when the
 * whole home is in one band.
 *
 *   band  edge (oklch)          core (oklch)          span
 *   4     0.73 0.120 268        0.56 0.190 266        30 dB above -67 dBm
 *   3     0.84 0.070 271        0.80 0.085 270         7 dB (-74 .. -67)
 *   2     0.905 0.042 272       0.885 0.050 272        5 dB (-79 .. -74)
 *   1     0.955 0.020 274       0.94 0.026 274         3 dB (-82 .. -79)
 *   0     dead tint, hatched with the alert vermilion
 */
export type RGB = [number, number, number];

export const HEAT_EDGE: Record<Bars, string> = {
  4: '#87a4f3',
  3: '#b9c9f9',
  2: '#d6dffc',
  1: '#ecf0fe',
  0: '#ffe4db',
};

export const HEAT_CORE: Record<Bars, string> = {
  4: '#3f69e2',
  3: '#a8bcf5',
  2: '#cdd8fb',
  1: '#e5eafd',
  0: '#ffe4db',
};

/** Swatch for the stacked share bar: the middle of each band's ramp. */
export const HEAT_SWATCH: Record<Bars, string> = {
  4: '#6387eb',
  3: '#b0c2f8',
  2: '#d1dbfc',
  1: '#e8edfd',
  0: '#ff4a1c',
};

export const HEAT_HATCH = '#ff4a1c';

/** dBm at the bottom of each band (index = bars) and the span the ramp covers above it. */
export const BAND_FLOOR: Record<Bars, number> = { 4: THRESHOLDS[0], 3: THRESHOLDS[1], 2: THRESHOLDS[2], 1: THRESHOLDS[3], 0: -200 };
export const BAND_SPAN: Record<Bars, number> = { 4: 30, 3: THRESHOLDS[0] - THRESHOLDS[1], 2: THRESHOLDS[1] - THRESHOLDS[2], 1: THRESHOLDS[2] - THRESHOLDS[3], 0: 1 };

export const hexRgb = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;

const BARS: Bars[] = [0, 1, 2, 3, 4];
const EDGE_RGB = BARS.map((b) => hexRgb(HEAT_EDGE[b]));
const CORE_RGB = BARS.map((b) => hexRgb(HEAT_CORE[b]));

/** 0..1 position inside the band (0 = at its threshold, 1 = at or past its core). */
export function bandT(bars: Bars, dbm: number): number {
  const t = (dbm - BAND_FLOOR[bars]) / BAND_SPAN[bars];
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Fill colour (0..255) for a level already classed as `bars`. */
export function heatRgb(bars: Bars, dbm: number, out: RGB = [0, 0, 0]): RGB {
  const t = bandT(bars, dbm);
  const a = EDGE_RGB[bars];
  const b = CORE_RGB[bars];
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

/** Flat arrays for the shader uniforms, colours 0..1. */
export function shaderPalette(): { edge: Float32Array; core: Float32Array; floor: Float32Array; span: Float32Array } {
  return {
    edge: new Float32Array(EDGE_RGB.flatMap((c) => c.map((v) => v / 255))),
    core: new Float32Array(CORE_RGB.flatMap((c) => c.map((v) => v / 255))),
    floor: new Float32Array(BARS.map((b) => BAND_FLOOR[b])),
    span: new Float32Array(BARS.map((b) => BAND_SPAN[b])),
  };
}
