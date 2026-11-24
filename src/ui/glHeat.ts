import { THRESHOLDS } from '../model/classes';
import { BAND_GHZ, lossTable } from '../model/materials';
import { MIN_DISTANCE_M, fsplDb } from '../model/propagation';
import type { ModelSettings, Plan } from '../model/types';
import { HEAT_HATCH, shaderPalette } from './heatPalette';
import { SPREAD } from './spread';

/**
 * Per-pixel heat map on the GPU. The fragment shader runs the same model as
 * src/model/field.ts (same crossing rules, same formula) for every pixel, so
 * band edges and door "beams" are exact instead of interpolated from a grid.
 * The CPU field is still what the coverage numbers are computed from.
 */

const MAX_WALLS = 256;
const MAX_ROOMS = 32;

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uWalls;   // row 0: ax, ay, bx, by ; row 1: loss
uniform int uWallN;
uniform vec4 uRooms[${MAX_ROOMS}];
uniform int uRoomN;
uniform vec2 uPlan;         // metres
uniform vec2 uRouter;       // metres
uniform float uEirp;
uniform float uFspl1;
uniform float uTenN;
uniform float uMinD;
uniform vec4 uThr;          // -67, -74, -79, -82
uniform float uRevealT;     // seconds, < 0 = fully shown
uniform vec3 uSpread;       // secPerM, secPerWall, edge
uniform vec3 uEdge[5];     // band colour at its threshold
uniform vec3 uCore[5];     // band colour at its strongest
uniform float uFloor[5];   // dBm at the bottom of each band
uniform float uSpan[5];    // dB the ramp covers above the floor
uniform vec3 uHatch;
uniform float uHatchPx;

const float EPS = 1e-9;

void main() {
  // y grows downwards in plan space
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uPlan;

  bool inside = false;
  for (int r = 0; r < ${MAX_ROOMS}; r++) {
    if (r >= uRoomN) break;
    vec4 rm = uRooms[r];
    if (p.x >= rm.x && p.x <= rm.x + rm.z && p.y >= rm.y && p.y <= rm.y + rm.w) { inside = true; break; }
  }
  if (!inside) { outColor = vec4(0.0); return; }

  vec2 d = p - uRouter;
  float wl = 0.0;
  float count = 0.0;
  for (int k = 0; k < ${MAX_WALLS}; k++) {
    if (k >= uWallN) break;
    vec4 w = texelFetch(uWalls, ivec2(k, 0), 0);
    vec2 s = w.zw - w.xy;
    float denom = d.x * s.y - d.y * s.x;
    if (abs(denom) < EPS) continue;
    vec2 qp = w.xy - uRouter;
    float t = (qp.x * s.y - qp.y * s.x) / denom;
    if (t <= 1e-6 || t > 1.0 + 1e-6) continue;
    float u = (qp.x * d.y - qp.y * d.x) / denom;
    if (u < -1e-6 || u >= 1.0 - 1e-6) continue;
    wl += texelFetch(uWalls, ivec2(k, 1), 0).r;
    count += 1.0;
  }
  float dist = max(length(d), uMinD);
  float dbm = uEirp - uFspl1 - uTenN * log(dist) / log(10.0) - wl;

  int bars = dbm >= uThr.x ? 4 : dbm >= uThr.y ? 3 : dbm >= uThr.z ? 2 : dbm >= uThr.w ? 1 : 0;
  float tb = clamp((dbm - uFloor[bars]) / uSpan[bars], 0.0, 1.0);
  vec3 col = mix(uEdge[bars], uCore[bars], tb);
  if (bars == 0) {
    float diag = mod(gl_FragCoord.x + gl_FragCoord.y, uHatchPx * 5.0);
    if (diag < uHatchPx) col = uHatch;
  }

  float a = 1.0;
  if (uRevealT >= 0.0) {
    float tau = length(d) * uSpread.x + count * uSpread.y;
    a = clamp((uRevealT - tau) / uSpread.z, 0.0, 1.0);
  }
  outColor = vec4(col * a, a); // premultiplied
}`;

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

export class GlHeat {
  readonly canvas = document.createElement('canvas');
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private tex: WebGLTexture;
  private loc: Record<string, WebGLUniformLocation | null> = {};

  static create(): GlHeat | null {
    try {
      return new GlHeat();
    } catch {
      return null;
    }
  }

  private constructor() {
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('no webgl2');
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    this.prog = prog;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uWalls', 'uWallN', 'uRooms', 'uRoomN', 'uPlan', 'uRouter', 'uEirp', 'uFspl1', 'uTenN', 'uMinD', 'uThr', 'uRevealT', 'uSpread', 'uEdge', 'uCore', 'uFloor', 'uSpan', 'uHatch', 'uHatchPx']) {
      this.loc[n] = gl.getUniformLocation(prog, n);
    }
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.uniform1i(this.loc.uWalls, 0);
    gl.uniform4f(this.loc.uThr, THRESHOLDS[0], THRESHOLDS[1], THRESHOLDS[2], THRESHOLDS[3]);
    gl.uniform3f(this.loc.uSpread, SPREAD.secPerM, SPREAD.secPerWall, SPREAD.edge);
    const pal = shaderPalette();
    gl.uniform3fv(this.loc.uEdge, pal.edge);
    gl.uniform3fv(this.loc.uCore, pal.core);
    gl.uniform1fv(this.loc.uFloor, pal.floor);
    gl.uniform1fv(this.loc.uSpan, pal.span);
    gl.uniform3f(this.loc.uHatch, ...hex(HEAT_HATCH));
  }

  /** Returns false when the plan is too large for the shader limits (caller falls back to CPU). */
  render(plan: Plan, s: ModelSettings, w: number, h: number, revealT: number, pxPerCssPx: number): boolean {
    if (plan.walls.length > MAX_WALLS || plan.rooms.length > MAX_ROOMS) return false;
    const gl = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);

    const n = Math.max(1, plan.walls.length);
    const losses = lossTable(s.band, s.thicknessM);
    const data = new Float32Array(n * 2 * 4);
    plan.walls.forEach((wl, k) => {
      data.set([wl.a.x, wl.a.y, wl.b.x, wl.b.y], k * 4);
      data[(n + k) * 4] = losses[wl.material];
    });
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n, 2, 0, gl.RGBA, gl.FLOAT, data);
    gl.uniform1i(this.loc.uWallN, plan.walls.length);

    const rooms = new Float32Array(MAX_ROOMS * 4);
    plan.rooms.forEach((r, i) => rooms.set([r.x, r.y, r.w, r.h], i * 4));
    gl.uniform4fv(this.loc.uRooms, rooms);
    gl.uniform1i(this.loc.uRoomN, plan.rooms.length);
    gl.uniform2f(this.loc.uPlan, plan.width, plan.height);
    gl.uniform2f(this.loc.uRouter, plan.router.x, plan.router.y);
    gl.uniform1f(this.loc.uEirp, s.eirpDbm);
    gl.uniform1f(this.loc.uFspl1, fsplDb(1, BAND_GHZ[s.band] * 1000));
    gl.uniform1f(this.loc.uTenN, 10 * s.exponent);
    gl.uniform1f(this.loc.uMinD, MIN_DISTANCE_M);
    gl.uniform1f(this.loc.uRevealT, Number.isFinite(revealT) ? revealT : -1);
    gl.uniform1f(this.loc.uHatchPx, 2 * pxPerCssPx);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }
}
