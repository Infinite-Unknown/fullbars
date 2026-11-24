import { barsFor } from '../model/classes';
import type { Field } from '../model/field';
import type { MaterialId, ModelSettings, Plan, Point, Wall } from '../model/types';
import { GlHeat } from './glHeat';
import { SPREAD } from './spread';

const INK = '#121417';
const INK2 = '#4a5058';
const INK3 = '#6b717a';
const COBALT = '#0b3bf5';
const VERMILION = '#ff4a1c';

// class colours as RGB, index = bars
const RGB: [number, number, number][] = [
  [255, 228, 219], // 0 bars: dead tint (hatched with vermilion)
  [214, 222, 255],
  [157, 177, 255],
  [79, 116, 255],
  [11, 59, 245],
];
const HATCH: [number, number, number] = [255, 74, 28];

export { SPREAD };

export interface Layout {
  cssW: number;
  cssH: number;
  scale: number; // px per metre
  ox: number;
  oy: number;
}

export interface Overlay {
  selectedWallId: string | null;
  hoverWallId: string | null;
  hoverTone: 'select' | 'erase';
  probe: { p: Point; crossed: Set<string> } | null;
  draft: { a: Point; b: Point } | null;
  ghost: Point | null;
  searchDots: Point[];
  searchBest: Point | null;
  routerActive: boolean;
}

export class PlanRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  layout: Layout = { cssW: 0, cssH: 0, scale: 1, ox: 0, oy: 0 };

  private heat = document.createElement('canvas');
  private heatCtx = this.heat.getContext('2d')!;
  private heatImg: ImageData | null = null;
  private pxW = 0;
  private pxH = 0;
  private pxGX = new Float32Array(0); // grid-space x for each heat pixel
  private pxGY = new Float32Array(0);
  private pxFloor = new Uint8Array(0);
  private planKey = '';
  private gl = GlHeat.create();
  private heatSource: CanvasImageSource = this.heat;
  private glW = 0;
  private glH = 0;
  private glScale = 1;
  /** Which path painted the last frame: 'gpu' or 'cpu'. */
  heatPath: 'gpu' | 'cpu' = 'cpu';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  /** Fit the plan into the canvas; rebuild per-pixel lookup tables when size or plan changes. */
  resize(plan: Plan, cell: number, padding = { top: 72, right: 28, bottom: 44, left: 28 }): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));
    const pad = cssW < 560 ? { top: 56, right: 12, bottom: 34, left: 12 } : padding;
    const scale = Math.min((cssW - pad.left - pad.right) / plan.width, (cssH - pad.top - pad.bottom) / plan.height);
    const ox = Math.round(pad.left + (cssW - pad.left - pad.right - plan.width * scale) / 2);
    const oy = Math.round(pad.top + (cssH - pad.top - pad.bottom - plan.height * scale) / 2);
    const key = `${plan.id}|${plan.width}|${plan.height}|${JSON.stringify(plan.rooms)}|${cssW}x${cssH}|${dpr}|${cell}`;
    this.layout = { cssW, cssH, scale, ox, oy };
    if (this.canvas.width !== cssW * dpr || this.canvas.height !== cssH * dpr) {
      this.canvas.width = cssW * dpr;
      this.canvas.height = cssH * dpr;
    }
    this.dpr = dpr;
    this.glScale = dpr;
    this.glW = Math.max(1, Math.round(plan.width * scale * dpr));
    this.glH = Math.max(1, Math.round(plan.height * scale * dpr));
    if (key === this.planKey) return;
    this.planKey = key;

    // Heat image at device resolution (capped) for crisp band edges.
    const hs = Math.min(dpr, 1.5);
    this.pxW = Math.max(1, Math.round(plan.width * scale * hs));
    this.pxH = Math.max(1, Math.round(plan.height * scale * hs));
    this.heat.width = this.pxW;
    this.heat.height = this.pxH;
    this.heatImg = this.heatCtx.createImageData(this.pxW, this.pxH);
    const n = this.pxW * this.pxH;
    this.pxGX = new Float32Array(n);
    this.pxGY = new Float32Array(n);
    this.pxFloor = new Uint8Array(n);
    const mPerPx = plan.width / this.pxW;
    const mPerPy = plan.height / this.pxH;
    for (let y = 0; y < this.pxH; y++) {
      const my = (y + 0.5) * mPerPy;
      for (let x = 0; x < this.pxW; x++) {
        const mx = (x + 0.5) * mPerPx;
        const k = y * this.pxW + x;
        this.pxGX[k] = mx / cell - 0.5;
        this.pxGY[k] = my / cell - 0.5;
        for (const r of plan.rooms) {
          if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
            this.pxFloor[k] = 1;
            break;
          }
        }
      }
    }
  }

  toMetres(cx: number, cy: number): Point {
    const { scale, ox, oy } = this.layout;
    return { x: (cx - ox) / scale, y: (cy - oy) / scale };
  }

  toPx(p: Point): [number, number] {
    const { scale, ox, oy } = this.layout;
    return [ox + p.x * scale, oy + p.y * scale];
  }

  /**
   * Paint the heat layer. `revealT` is seconds since the spread started (Infinity = fully shown).
   * Each cell is revealed at (distance / speed) + (walls crossed x pause), so the colour visibly
   * stalls at every wall before it pushes through.
   */
  paintHeat(field: Field, router: Point, revealT: number, plan: Plan, settings: ModelSettings): void {
    if (this.gl && this.gl.render(plan, settings, this.glW, this.glH, revealT, this.glScale)) {
      this.heatSource = this.gl.canvas;
      this.heatPath = 'gpu';
      return;
    }
    this.heatSource = this.heat;
    this.heatPath = 'cpu';
    const img = this.heatImg;
    if (!img) return;
    const data = img.data;
    const { cols, rows, cell } = field.grid;
    const dbm = field.dbm;
    const wc = field.wallsCrossed;
    const reveal = Number.isFinite(revealT);
    const rgx = router.x / cell - 0.5;
    const rgy = router.y / cell - 0.5;
    const n = this.pxW * this.pxH;
    for (let k = 0; k < n; k++) {
      const o = k * 4;
      if (!this.pxFloor[k]) {
        data[o + 3] = 0;
        continue;
      }
      let gx = this.pxGX[k];
      let gy = this.pxGY[k];
      if (gx < 0) gx = 0;
      if (gy < 0) gy = 0;
      if (gx > cols - 1) gx = cols - 1;
      if (gy > rows - 1) gy = rows - 1;
      const i0 = gx | 0;
      const j0 = gy | 0;
      const i1 = i0 + 1 < cols ? i0 + 1 : i0;
      const j1 = j0 + 1 < rows ? j0 + 1 : j0;
      const tx = gx - i0;
      const ty = gy - j0;
      const a = dbm[j0 * cols + i0];
      const b = dbm[j0 * cols + i1];
      const c = dbm[j1 * cols + i0];
      const d = dbm[j1 * cols + i1];
      const v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      const bars = barsFor(v);
      let col = RGB[bars];
      if (bars === 0) {
        const px = k % this.pxW;
        const py = (k / this.pxW) | 0;
        if ((px + py) % 10 < 2) col = HATCH;
      }
      let alpha = 1;
      if (reveal) {
        const dist = Math.hypot(this.pxGX[k] - rgx, this.pxGY[k] - rgy) * cell;
        const ni = tx < 0.5 ? i0 : i1;
        const nj = ty < 0.5 ? j0 : j1;
        const walls = wc[nj * cols + ni];
        const tau = dist * SPREAD.secPerM + walls * SPREAD.secPerWall;
        alpha = (revealT - tau) / SPREAD.edge;
        if (alpha <= 0) {
          data[o + 3] = 0;
          continue;
        }
        if (alpha > 1) alpha = 1;
      }
      data[o] = col[0];
      data[o + 1] = col[1];
      data[o + 2] = col[2];
      data[o + 3] = (alpha * 255) | 0;
    }
    this.heatCtx.putImageData(img, 0, 0);
  }

  /** Time in seconds until every cell of this field is revealed. */
  spreadDuration(field: Field, router: Point): number {
    const { cols, rows, cell, mask } = field.grid;
    let max = 0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        if (!mask[k]) continue;
        const dist = Math.hypot((i + 0.5) * cell - router.x, (j + 0.5) * cell - router.y);
        const t = dist * SPREAD.secPerM + field.wallsCrossed[k] * SPREAD.secPerWall;
        if (t > max) max = t;
      }
    }
    return max + SPREAD.edge;
  }

  draw(plan: Plan, router: Point, ov: Overlay, time: number): void {
    const ctx = this.ctx;
    const { cssW, cssH, scale, ox, oy } = this.layout;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // 1 m dot grid over the drawing extent
    ctx.fillStyle = 'rgba(107,113,122,0.28)';
    for (let x = 0; x <= plan.width + 1e-6; x += 1) {
      for (let y = 0; y <= plan.height + 1e-6; y += 1) {
        ctx.fillRect(ox + x * scale - 1, oy + y * scale - 1, 2, 2);
      }
    }

    // heat
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.heatSource, ox, oy, plan.width * scale, plan.height * scale);

    // probe path under the walls
    if (ov.probe) {
      const [x1, y1] = this.toPx(router);
      const [x2, y2] = this.toPx(ov.probe.p);
      ctx.save();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    }

    this.drawWalls(plan.walls, ov);
    this.drawRoomLabels(plan);

    if (ov.probe) {
      const [x2, y2] = this.toPx(ov.probe.p);
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x2, y2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    if (ov.draft) this.drawDraft(ov.draft);

    // search candidates
    if (ov.searchDots.length) {
      ctx.fillStyle = 'rgba(18,20,23,0.55)';
      for (const p of ov.searchDots) {
        const [x, y] = this.toPx(p);
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }
    if (ov.searchBest) {
      const [x, y] = this.toPx(ov.searchBest);
      ctx.save();
      ctx.strokeStyle = COBALT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (ov.ghost) this.drawGhost(ov.ghost);
    this.drawRouter(router, ov.routerActive, time);
  }

  private wallStyle(m: MaterialId): { w: number; color: string } {
    switch (m) {
      case 'concrete':
        return { w: 7, color: INK };
      case 'brick':
        return { w: 5, color: INK };
      case 'plasterboard':
        return { w: 3, color: INK2 };
      case 'glass':
        return { w: 6, color: INK3 };
      case 'wood':
        return { w: 2.5, color: INK };
    }
  }

  private drawWalls(walls: Wall[], ov: Overlay): void {
    const ctx = this.ctx;
    // highlights first
    for (const w of walls) {
      let hl: string | null = null;
      if (ov.probe?.crossed.has(w.id)) hl = 'rgba(255,74,28,0.55)';
      if (w.id === ov.hoverWallId) hl = ov.hoverTone === 'erase' ? 'rgba(255,74,28,0.5)' : 'rgba(11,59,245,0.3)';
      if (w.id === ov.selectedWallId) hl = 'rgba(11,59,245,0.45)';
      if (!hl) continue;
      const [x1, y1] = this.toPx(w.a);
      const [x2, y2] = this.toPx(w.b);
      ctx.save();
      ctx.strokeStyle = hl;
      ctx.lineCap = 'round';
      ctx.lineWidth = this.wallStyle(w.material).w + 10;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    }
    // solid walls
    for (const w of walls) {
      const [x1, y1] = this.toPx(w.a);
      const [x2, y2] = this.toPx(w.b);
      const st = this.wallStyle(w.material);
      ctx.save();
      if (w.material === 'glass') {
        // window symbol: two thin lines and a centre line
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const nx = (-(y2 - y1) / len) * 3;
        const ny = ((x2 - x1) / len) * 3;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(x1 + nx, y1 + ny);
        ctx.lineTo(x2 + nx, y2 + ny);
        ctx.lineTo(x2 - nx, y2 - ny);
        ctx.lineTo(x1 - nx, y1 - ny);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = INK2;
        ctx.lineWidth = 1;
        for (const s of [1, 0, -1]) {
          ctx.beginPath();
          ctx.moveTo(x1 + nx * s, y1 + ny * s);
          ctx.lineTo(x2 + nx * s, y2 + ny * s);
          ctx.stroke();
        }
      } else if (w.material === 'wood') {
        // closed door: leaf line, end ticks and a hairline swing arc
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const ang = Math.atan2(y2 - y1, x2 - x1);
        ctx.strokeStyle = 'rgba(18,20,23,0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.arc(x1, y1, len, ang, ang + Math.PI / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = st.color;
        ctx.lineWidth = st.w;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        const tx = -Math.sin(ang) * 4;
        const ty = Math.cos(ang) * 4;
        ctx.lineWidth = 1.5;
        for (const [x, y] of [[x1, y1], [x2, y2]]) {
          ctx.beginPath();
          ctx.moveTo(x - tx, y - ty);
          ctx.lineTo(x + tx, y + ty);
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = st.color;
        ctx.lineWidth = st.w;
        ctx.lineCap = 'square';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawRoomLabels(plan: Plan): void {
    const ctx = this.ctx;
    const { scale } = this.layout;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const r of plan.rooms) {
      const wpx = r.w * scale;
      const hpx = r.h * scale;
      if (wpx < 46 || hpx < 30) continue;
      const [cx, cy] = this.toPx({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
      const small = wpx < 90;
      const name = r.name;
      const dims = `${r.w.toFixed(1)} × ${r.h.toFixed(1)} m`;
      ctx.font = `650 ${small ? 11 : 12}px "Archivo Variable", system-ui, sans-serif`;
      const w1 = ctx.measureText(name).width;
      ctx.font = `450 ${small ? 10 : 11}px "Archivo Variable", system-ui, sans-serif`;
      const w2 = ctx.measureText(dims).width;
      const bw = Math.max(w1, w2) + 14;
      const bh = 34;
      ctx.fillStyle = 'rgba(255,255,255,0.86)';
      roundRect(ctx, cx - bw / 2, cy - bh / 2, bw, bh, 5);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.font = `650 ${small ? 11 : 12}px "Archivo Variable", system-ui, sans-serif`;
      ctx.fillText(name, cx, cy - 7);
      ctx.fillStyle = INK2;
      ctx.font = `450 ${small ? 10 : 11}px "Archivo Variable", system-ui, sans-serif`;
      ctx.fillText(dims, cx, cy + 8);
    }
    ctx.restore();
  }

  private drawDraft(d: { a: Point; b: Point }): void {
    const ctx = this.ctx;
    const [x1, y1] = this.toPx(d.a);
    const [x2, y2] = this.toPx(d.b);
    ctx.save();
    ctx.strokeStyle = COBALT;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
    const len = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
    const label = `${len.toFixed(1)} m`;
    ctx.font = '700 12px "Archivo Variable", system-ui, sans-serif';
    const tw = ctx.measureText(label).width + 12;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2 - 16;
    ctx.fillStyle = COBALT;
    roundRect(ctx, mx - tw / 2, my - 10, tw, 20, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, mx, my + 0.5);
    ctx.restore();
  }

  private drawGhost(p: Point): void {
    const ctx = this.ctx;
    const [x, y] = this.toPx(p);
    ctx.save();
    ctx.strokeStyle = VERMILION;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '700 11px "Archivo Variable", system-ui, sans-serif';
    const label = 'Before';
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = VERMILION;
    roundRect(ctx, x - tw / 2, y + 19, tw, 18, 9);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + 28.5);
    ctx.restore();
  }

  private drawRouter(p: Point, active: boolean, _time: number): void {
    const ctx = this.ctx;
    const [x, y] = this.toPx(p);
    const r = active ? 17 : 15;
    ctx.save();
    ctx.shadowColor = 'rgba(18,20,23,0.35)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    // four bars inside the pin
    const bw = 2.6;
    const gap = 1.6;
    const total = 4 * bw + 3 * gap;
    for (let i = 0; i < 4; i++) {
      const h = 4 + i * 2.6;
      ctx.fillStyle = i === 3 ? '#7f98ff' : '#fff';
      ctx.fillRect(x - total / 2 + i * (bw + gap), y + 6 - h, bw, h);
    }
    ctx.restore();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
