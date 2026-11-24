// Records real footage of the running app for the Round 1 video, one clip per scene.
//
// How: the page runs on a stepped clock (performance.now, requestAnimationFrame, timers and
// CSS / Web Animations all advance exactly 1/60 s per step), so every frame of the app's own
// animations is captured, at 60 fps, however long a capture takes. Each frame is a
// device-pixel screenshot of a clip of the page (Page.captureScreenshot with clip + scale),
// so the "camera" (eased zoom-to-focus, framed from real getBoundingClientRect positions)
// is rendered sharp at every zoom level rather than upscaled. The cursor is a page overlay
// driven by the same eased paths that move the real mouse.
//
// Usage: node video/record.mjs [baseUrl] [scene ...]  ->  video/work/v2/clips/<scene>.mp4 + .json
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'http://localhost:5243/';
const only = process.argv.slice(3);
const WORK = fileURLToPath(new URL('./work/v2/', import.meta.url));
const OUT = `${WORK}clips/`;
mkdirSync(OUT, { recursive: true });
const VO = JSON.parse(readFileSync(`${WORK}vo/lengths.json`, 'utf8'));
const FPS = 60;
const OUT_W = 1920;
const OUT_H = 1080;

// Installed before the app's own scripts: a clock that only moves when the recorder steps it.
const CLOCK = `(() => {
  let now = performance.now();
  let seq = 0;
  let rafs = [];
  const timers = new Map();
  const starts = new WeakMap();
  performance.now = () => now;
  window.requestAnimationFrame = (cb) => { const id = ++seq; rafs.push([id, cb]); return id; };
  window.cancelAnimationFrame = (id) => { rafs = rafs.filter((r) => r[0] !== id); };
  const add = (fn, ms, args, every) => { const id = ++seq; timers.set(id, { due: now + Math.max(0, +ms || 0), fn, args, every }); return id; };
  window.setTimeout = (fn, ms, ...args) => add(fn, ms, args, 0);
  window.setInterval = (fn, ms, ...args) => add(fn, ms, args, Math.max(1, +ms || 1));
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);
  window.__step = (dt) => {
    now += dt;
    for (;;) {
      let next = null;
      for (const [id, t] of timers) if (t.due <= now && (!next || t.due < next[1].due)) next = [id, t];
      if (!next) break;
      const [id, t] = next;
      if (t.every) t.due += t.every; else timers.delete(id);
      try { typeof t.fn === 'function' ? t.fn(...t.args) : 0; } catch (e) { console.error(e); }
    }
    const due = rafs; rafs = [];
    for (const [, cb] of due) { try { cb(now); } catch (e) { console.error(e); } }
    for (const a of document.getAnimations()) {
      let s = starts.get(a);
      if (s === undefined) { s = now - dt; starts.set(a, s); }
      const end = a.effect ? a.effect.getComputedTiming().endTime : 0;
      const t = now - s;
      if (Number.isFinite(end) && t >= end) { try { a.finish(); } catch {} }
      else { a.pause(); a.currentTime = t; }
    }
    return now;
  };
  // the cursor overlay (pointer-events: none, never part of the app)
  const install = () => {
    if (document.getElementById('__cursor')) return;
    const c = document.createElement('div');
    c.id = '__cursor';
    c.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28" style="filter: drop-shadow(0 2px 3px rgb(0 0 0 / .28))"><path d="M5 3l16.5 9.6-7.3 1.7-3.6 6.9z" fill="#121417" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 2147483647, pointerEvents: 'none', transformOrigin: '5px 3px', opacity: '0' });
    const ring = document.createElement('div');
    ring.id = '__ring';
    Object.assign(ring.style, { position: 'fixed', left: '0', top: '0', width: '44px', height: '44px', margin: '-22px 0 0 -22px', borderRadius: '50%', background: 'rgb(11 59 245 / .22)', border: '2px solid rgb(11 59 245 / .9)', zIndex: 2147483646, pointerEvents: 'none', opacity: '0' });
    document.documentElement.append(ring, c);
  };
  window.__cursor = (x, y, s, show) => {
    install();
    const c = document.getElementById('__cursor');
    c.style.transform = 'translate(' + (x - 5) + 'px,' + (y - 3) + 'px) scale(' + s + ')';
    c.style.opacity = show ? '1' : '0';
  };
  window.__ripple = (x, y) => {
    install();
    const r = document.getElementById('__ring');
    r.style.left = x + 'px'; r.style.top = y + 'px';
    r.animate([{ opacity: 1, transform: 'scale(0.35)' }, { opacity: 0, transform: 'scale(1.25)' }], { duration: 520, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };
})();`;

// Callouts, drawn in the page so they follow the camera exactly: a spotlight (the rest of the
// page dimmed to 60 %, soft edge), a ring that draws on in the brand cobalt, an optional arrow
// and label for small things, and a pulse + underline for numbers being read out.
const OVERLAY = `(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const C = '#0B3BF5';
  let root = null;
  let cur = null;
  let seq = 0;
  const mk = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const set = (e, attrs) => { for (const k in attrs) e.setAttribute(k, attrs[k]); };
  const draw = (e, ms, delay) => e.animate([{ strokeDashoffset: '100px' }, { strokeDashoffset: '0px' }], { duration: ms, delay: delay || 0, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'both' });
  const ensure = () => {
    if (root) return;
    root = document.createElement('div');
    root.id = '__callouts';
    Object.assign(root.style, { position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh', zIndex: 2147483600, pointerEvents: 'none' });
    document.documentElement.appendChild(root);
  };
  const geom = (c, o) => {
    const s = c.s;
    const pad = (o.pad != null ? o.pad : 10) * s;
    const x = o.x - pad, y = o.y - pad, w = o.w + pad * 2, h = o.h + pad * 2;
    const r = Math.min(16 * s, w / 2, h / 2);
    const box = { x, y, width: w, height: h, rx: r };
    set(c.hole, box); set(c.halo, box); set(c.ring, box);
    if (c.pulse) set(c.pulse, box);
    if (c.under) { const uy = o.y + o.h + 7 * s; set(c.under, { x1: o.x, y1: uy, x2: o.x + o.w, y2: uy }); }
    if (c.label) {
      const lw = c.label.offsetWidth, lh = c.label.offsetHeight, gap = 92 * s;
      let lx, ly, sx, sy, tx, ty;
      if (c.side === 'left') { lx = x - gap - lw; ly = y + h / 2 - lh / 2; sx = lx + lw; sy = ly + lh / 2; tx = x - 5 * s; ty = sy; }
      else if (c.side === 'top') { lx = x + w / 2 - lw / 2; ly = y - gap - lh; sx = x + w / 2; sy = ly + lh; tx = sx; ty = y - 5 * s; }
      else if (c.side === 'bottom') { lx = x + w / 2 - lw / 2; ly = y + h + gap; sx = x + w / 2; sy = ly; tx = sx; ty = y + h + 5 * s; }
      else { lx = x + w + gap; ly = y + h / 2 - lh / 2; sx = lx; sy = ly + lh / 2; tx = x + w + 5 * s; ty = sy; }
      c.label.style.left = lx + 'px'; c.label.style.top = ly + 'px';
      const a = Math.atan2(ty - sy, tx - sx), hl = 13 * s, hw = 0.5;
      set(c.arrow, { x1: sx, y1: sy, x2: tx - Math.cos(a) * hl * 0.6, y2: ty - Math.sin(a) * hl * 0.6 });
      set(c.arrowHalo, { x1: sx, y1: sy, x2: tx - Math.cos(a) * hl * 0.6, y2: ty - Math.sin(a) * hl * 0.6 });
      const p = [tx, ty, tx - Math.cos(a - hw) * hl, ty - Math.sin(a - hw) * hl, tx - Math.cos(a + hw) * hl, ty - Math.sin(a + hw) * hl];
      set(c.head, { d: 'M' + p[0] + ' ' + p[1] + 'L' + p[2] + ' ' + p[3] + 'L' + p[4] + ' ' + p[5] + 'Z' });
    }
  };
  window.__calloutClear = (ms) => {
    if (!cur) return;
    const c = cur; cur = null;
    const a = c.wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms || 240, easing: 'ease-out', fill: 'forwards' });
    a.onfinish = () => c.wrap.remove();
  };
  window.__callout = (o) => {
    ensure();
    window.__calloutClear(200);
    const W = innerWidth, H = innerHeight, s = o.unit, id = 'co' + (++seq);
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { position: 'absolute', left: '0', top: '0', width: W + 'px', height: H + 'px' });
    root.appendChild(wrap);
    const svg = mk('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, style: 'position:absolute;left:0;top:0;overflow:visible' }, wrap);
    const defs = mk('defs', {}, svg);
    const f = mk('filter', { id: id + 'b', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
    mk('feGaussianBlur', { stdDeviation: 9 * s }, f);
    const m = mk('mask', { id: id + 'm', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: W, height: H }, defs);
    mk('rect', { x: 0, y: 0, width: W, height: H, fill: 'white' }, m);
    const c = { wrap, s, side: o.side || 'right' };
    c.hole = mk('rect', { fill: 'black', filter: 'url(#' + id + 'b)' }, m);
    const dim = mk('rect', { x: 0, y: 0, width: W, height: H, fill: '#121417', 'fill-opacity': o.dim != null ? o.dim : 0.6, mask: 'url(#' + id + 'm)' }, svg);
    dim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'both' });
    const ringAttrs = { fill: 'none', pathLength: 100, 'stroke-dasharray': '100 100', 'stroke-linecap': 'round' };
    c.halo = mk('rect', Object.assign({ stroke: 'white', 'stroke-width': 10 * s, 'stroke-opacity': 0.9 }, ringAttrs), svg);
    c.ring = mk('rect', Object.assign({ stroke: C, 'stroke-width': 5 * s }, ringAttrs), svg);
    draw(c.halo, 380, 60); draw(c.ring, 380, 60);
    if (o.pulse) {
      c.pulse = mk('rect', { fill: 'none', stroke: C, 'stroke-width': 4 * s, style: 'transform-box: fill-box; transform-origin: center' }, svg);
      c.pulse.animate([{ transform: 'scale(1)', opacity: 0.95 }, { transform: 'scale(1.16)', opacity: 0 }], { duration: 760, delay: 380, iterations: 2, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'both' });
    }
    if (o.underline) {
      c.under = mk('line', { stroke: C, 'stroke-width': 6 * s, 'stroke-linecap': 'round', pathLength: 100, 'stroke-dasharray': '100 100' }, svg);
      draw(c.under, 420, 380);
    }
    if (o.label) {
      c.arrowHalo = mk('line', { stroke: 'white', 'stroke-width': 8 * s, 'stroke-linecap': 'round', 'stroke-opacity': 0.9, pathLength: 100, 'stroke-dasharray': '100 100' }, svg);
      c.arrow = mk('line', { stroke: C, 'stroke-width': 4 * s, 'stroke-linecap': 'round', pathLength: 100, 'stroke-dasharray': '100 100' }, svg);
      c.head = mk('path', { fill: C, stroke: 'white', 'stroke-width': 2 * s, 'stroke-linejoin': 'round' }, svg);
      draw(c.arrowHalo, 300, 300); draw(c.arrow, 300, 300);
      c.head.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: 520, fill: 'both' });
      const fs = 32 * s;
      const lab = document.createElement('div');
      lab.textContent = o.label;
      Object.assign(lab.style, { position: 'absolute', font: '650 ' + fs + 'px "Archivo Variable", Archivo, system-ui, sans-serif', fontStretch: '108%', color: '#fff', background: C, padding: (0.42 * fs) + 'px ' + (0.72 * fs) + 'px', borderRadius: (0.45 * fs) + 'px', whiteSpace: 'nowrap', boxShadow: '0 0 0 ' + (2.5 * s) + 'px #fff, 0 ' + (8 * s) + 'px ' + (22 * s) + 'px rgb(0 0 0 / 0.3)', letterSpacing: '-0.005em', lineHeight: '1.1' });
      wrap.appendChild(lab);
      c.label = lab;
      lab.animate([{ opacity: 0, transform: 'translateY(' + (10 * s) + 'px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 380, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'both' });
    }
    geom(c, o);
    cur = c;
  };
  window.__calloutMove = (o) => { if (cur) geom(cur, o); };
})();`;

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // cubic in-out
const easeQuint = (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2);

class Recorder {
  constructor(page, cdp, name, view) {
    Object.assign(this, { page, cdp, name, view });
    this.f = 0;
    this.capturing = false;
    this.cam = { cx: view.width / 2, cy: view.height / 2, z: 1 };
    this.camMove = null;
    this.mouse = { x: view.width - 8, y: view.height - 8 };
    this.cursorOn = false;
    this.down = false;
    this.marks = {};
    this.notes = {};
  }

  start() {
    this.ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '10', '-pix_fmt', 'yuv420p', '-r', String(FPS), `${OUT}${this.name}.mp4`], { stdio: ['pipe', 'inherit', 'inherit'] });
    this.done = new Promise((r) => this.ff.on('close', r));
    this.capturing = true;
    this.f = 0; // marks and timings count captured frames only
    this.camMove = null;
  }

  async finish() {
    this.ff.stdin.end();
    await this.done;
    writeFileSync(`${OUT}${this.name}.json`, JSON.stringify({ frames: this.f, fps: FPS, marks: this.marks, notes: this.notes }, null, 1));
    console.log(`${this.name}: ${this.f} frames, ${(this.f / FPS).toFixed(2)} s`, this.marks, this.notes);
  }

  mark(id) { this.marks[id] = this.f; }
  get t() { return this.f / FPS; }

  // --- camera -----------------------------------------------------------------
  camAt() {
    const m = this.camMove;
    if (!m) return this.cam;
    const k = m.curve(Math.min(1, (this.f - m.f0) / m.n));
    const z = Math.exp(Math.log(m.from.z) + (Math.log(m.to.z) - Math.log(m.from.z)) * k);
    const cam = { cx: m.from.cx + (m.to.cx - m.from.cx) * k, cy: m.from.cy + (m.to.cy - m.from.cy) * k, z };
    if (k >= 1) { this.cam = { ...m.to }; this.camMove = null; }
    return cam;
  }
  // move the camera to a target over `sec` (does not wait)
  camTo(target, sec = 1.0, curve = ease) {
    const from = this.camMove ? this.camAt() : this.cam;
    this.cam = from;
    this.camMove = { from, to: target, f0: this.f, n: Math.max(1, Math.round(sec * FPS)), curve };
  }
  wide(sec = 1.0) { this.camTo({ cx: this.view.width / 2, cy: this.view.height / 2, z: 1 }, sec); }
  // frame a rect (page CSS px) with padding; zoom capped at 2.2
  focus(rect, sec = 1.0, { pad = 48, maxZ = 2.2, minZ = 1, dx = 0, dy = 0 } = {}) {
    const z = Math.max(minZ, Math.min(maxZ, this.view.width / (rect.width + pad * 2), this.view.height / (rect.height + pad * 2)));
    this.camTo({ cx: rect.x + rect.width / 2 + dx, cy: rect.y + rect.height / 2 + dy, z }, sec);
  }
  clip(cam) {
    const w = this.view.width / cam.z;
    const h = this.view.height / cam.z;
    const x = Math.min(this.view.width - w, Math.max(0, cam.cx - w / 2));
    const y = Math.min(this.view.height - h, Math.max(0, cam.cy - h / 2));
    return { x, y, width: w, height: h, scale: OUT_W / w };
  }

  // --- one frame ----------------------------------------------------------------
  async frame() {
    const cam = this.camAt();
    if (this.trackFn) { const r = await this.trackFn(); await this.page.evaluate((o) => window.__calloutMove(o), { ...this.calloutOpts, x: r.x, y: r.y, w: r.width, h: r.height }); }
    const s = 1.1 / Math.pow(cam.z, 0.45);
    await this.page.evaluate(([x, y, s, on]) => { window.__cursor(x, y, s, on); return window.__step(1000 / 60); }, [this.mouse.x, this.mouse.y, s, this.cursorOn]);
    if (this.capturing) {
      const r = await this.cdp.send('Page.captureScreenshot', { format: 'png', clip: this.clip(cam), optimizeForSpeed: true });
      const buf = Buffer.from(r.data, 'base64');
      if (!this.ff.stdin.write(buf)) await new Promise((res) => this.ff.stdin.once('drain', res));
    }
    this.f++;
  }
  async hold(sec) { const n = Math.round(sec * FPS); for (let i = 0; i < n; i++) await this.frame(); }
  async until(fn, maxSec = 20) {
    for (let i = 0; i < maxSec * FPS; i++) { if (await this.page.evaluate(fn)) return; await this.frame(); }
    throw new Error('until: timed out');
  }
  idle() { return this.until(() => window.fullbars && !window.fullbars.busy); }
  // wait until a voice-over line (marked at `id`) has finished, plus a pause
  async afterVo(id, pad = 0.4) {
    const end = this.marks[`vo:${id}`] + Math.round((VO[id] + pad) * FPS);
    while (this.f < end) await this.frame();
  }
  vo(id) { this.mark(`vo:${id}`); }

  // --- cursor -------------------------------------------------------------------
  async moveTo(p, sec = 0.8, arc = 0.08) {
    const from = { ...this.mouse };
    const n = Math.max(2, Math.round(sec * FPS));
    const dx = p.x - from.x, dy = p.y - from.y;
    for (let i = 1; i <= n; i++) {
      const k = ease(i / n);
      const bow = Math.sin(Math.PI * k) * arc;
      this.mouse = { x: from.x + dx * k - dy * bow, y: from.y + dy * k + dx * bow };
      await this.page.mouse.move(this.mouse.x, this.mouse.y);
      await this.frame();
    }
  }
  async click(holdSec = 0.08) {
    await this.page.evaluate(([x, y]) => window.__ripple(x, y), [this.mouse.x, this.mouse.y]);
    await this.page.mouse.down();
    await this.hold(holdSec);
    await this.page.mouse.up();
  }
  async press() { await this.page.evaluate(([x, y]) => window.__ripple(x, y), [this.mouse.x, this.mouse.y]); await this.page.mouse.down(); }
  async release() { await this.page.mouse.up(); }
  showCursor(on = true) { this.cursorOn = on; }
  jump(p) { this.mouse = { ...p }; return this.page.mouse.move(p.x, p.y); }

  // --- callouts ----------------------------------------------------------------
  // the zoom the camera is heading to (callout sizes are set for it)
  targetZ() { return this.camMove ? this.camMove.to.z : this.cam.z; }
  unitFor(z) { return 1 / ((OUT_W / this.view.width) * z); }
  // frame `rect` plus room for its label, then return the zoom used
  frameFor(rect, { label, side = 'right', pad = 70, maxZ = 2.2, minZ = 1, sec = 0.8, dx = 0, dy = 0, cam = true } = {}) {
    if (!cam) return this.targetZ();
    const fit = (r) => Math.max(minZ, Math.min(maxZ, this.view.width / (r.width + pad * 2), this.view.height / (r.height + pad * 2)));
    let r = rect;
    if (label) {
      const u = this.unitFor(fit(rect));
      const lw = (label.length * 18.5 + 52) * u, lh = 60 * u, gap = 100 * u;
      const lr = side === 'left' ? { x: rect.x - gap - lw, y: rect.y + rect.height / 2 - lh / 2, width: lw, height: lh }
        : side === 'top' ? { x: rect.x + rect.width / 2 - lw / 2, y: rect.y - gap - lh, width: lw, height: lh }
        : side === 'bottom' ? { x: rect.x + rect.width / 2 - lw / 2, y: rect.y + rect.height + gap, width: lw, height: lh }
        : { x: rect.x + rect.width + gap, y: rect.y + rect.height / 2 - lh / 2, width: lw, height: lh };
      r = this.union(rect, lr);
    }
    const z = fit(r);
    this.camTo({ cx: r.x + r.width / 2 + dx, cy: r.y + r.height / 2 + dy, z }, sec);
    return z;
  }
  async callout(rect, o = {}) {
    const z = this.frameFor(rect, o);
    this.calloutOpts = { unit: this.unitFor(z), label: o.label, side: o.side, pulse: o.pulse, underline: o.underline, pad: o.ringPad, dim: o.dim };
    await this.page.evaluate((o) => window.__callout(o), { ...this.calloutOpts, x: rect.x, y: rect.y, w: rect.width, h: rect.height });
  }
  // keep the callout on a moving thing (fn returns its rect each frame)
  track(fn) { this.trackFn = fn; }
  async clear() { this.trackFn = null; await this.page.evaluate(() => window.__calloutClear(240)); }
  // one narration beat: mark the voice, show the callout on what it names
  async beat(id, rect, o = {}) {
    this.vo(id);
    if (rect) await this.callout(rect, o);
  }
  async endBeat(id, gap = 0.2, clear = true) {
    await this.afterVo(id, gap);
    if (clear) await this.clear();
  }

  // --- page geometry ------------------------------------------------------------
  rect(sel) {
    return this.page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }, sel);
  }
  async centre(sel) { const r = await this.rect(sel); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
  // a plan point in metres -> page px
  plan(x, y) {
    return this.page.evaluate(([x, y]) => { const b = document.querySelector('#plan').getBoundingClientRect(); const p = window.fullbars.toPx(x, y); return { x: b.x + p.x, y: b.y + p.y }; }, [x, y]);
  }
  async planRect(x0, y0, x1, y1) {
    const a = await this.plan(x0, y0);
    const b = await this.plan(x1, y1);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
  }
  union(...rs) {
    const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
    const x1 = Math.max(...rs.map((r) => r.x + r.width)), y1 = Math.max(...rs.map((r) => r.y + r.height));
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
  text(sel) { return this.page.evaluate((sel) => document.querySelector(sel)?.innerText.replace(/\s+/g, ' ').trim(), sel); }
}

const APP_VIEW = { width: 1600, height: 900 };

// Open the app on the stepped clock; returns once the page is loaded (clock still at the start).
async function open(page, rec, query) {
  await page.goto(BASE + query);
  await page.evaluate(() => document.fonts.ready);
  await rec.jump(rec.mouse);
}

// Router marker, a box around the router pin.
async function routerRect(rec) {
  const p = await rec.page.evaluate(() => { const b = document.querySelector('#plan').getBoundingClientRect(); const r = window.fullbars.routerPx(); return { x: b.x + r.x, y: b.y + r.y }; });
  return { x: p.x - 22, y: p.y - 22, width: 44, height: 44 };
}
// The big coverage number (digits + %), not the whole row.
function scoreRect(rec) {
  return rec.page.evaluate(() => {
    const rs = [...document.querySelectorAll('.score-num > *')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    const x0 = Math.min(...rs.map((r) => r.left)), y0 = Math.min(...rs.map((r) => r.top)), x1 = Math.max(...rs.map((r) => r.right)), y1 = Math.max(...rs.map((r) => r.bottom));
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  });
}
// A wall segment (metres) as a thin box.
async function wallRect(rec, x0, y0, x1, y1) {
  const r = await rec.planRect(x0, y0, x1, y1);
  const t = 6;
  return { x: r.x - t, y: r.y - t, width: r.width + t * 2, height: r.height + t * 2 };
}
// The bounding box of an element found by its text.
function textRect(rec, sel, re) {
  return rec.page.evaluate(([sel, src]) => {
    const re = new RegExp(src);
    const area = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height; };
    const el = [...document.querySelectorAll(sel)].filter((e) => re.test(e.textContent)).sort((a, b) => area(a) - area(b))[0];
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, [sel, re.source]);
}

const scenes = {
  // Hook: the app opens, the predicted signal spreads out from the router by the front door.
  async hook(rec, page) {
    await open(page, rec, '?fresh');
    await rec.hold(0.22); // uncaptured: let the sheet fade in before the first frame
    const r = await rec.plan(0.7, 7.7);
    const b2 = await rec.plan(7.0, 6.0);
    rec.start();
    rec.cam = { cx: (r.x + b2.x) / 2, cy: (r.y + b2.y) / 2 - 20, z: 1.7 };
    rec.vo('hook_a');
    await rec.hold(0.3);
    rec.camTo({ cx: (r.x + b2.x) / 2 + 60, cy: (r.y + b2.y) / 2 - 40, z: 1.45 }, 1.6, easeQuint);
    await rec.afterVo('hook_a', 0.15);
    await rec.beat('hook_b', await routerRect(rec), { label: 'Your router', side: 'right', maxZ: 2.0, sec: 0.9 });
    await rec.endBeat('hook_b', 0.5, false);
  },

  // The flat as it opens: router, concrete wall, coverage, legend.
  async setup(rec, page) {
    await open(page, rec, '?fresh');
    await rec.idle();
    await rec.hold(0.1);
    rec.start();
    await rec.beat('setup_a', await rec.planRect(0.2, 0.2, 11.2, 8.2), { ringPad: 14, pad: 30, maxZ: 1.3, sec: 0.7 });
    await rec.endBeat('setup_a', 0.15);
    await rec.beat('setup_b', await routerRect(rec), { label: 'Router, by the front door', side: 'right', maxZ: 2.0 });
    await rec.endBeat('setup_b', 0.1);
    await rec.beat('setup_c', await wallRect(rec, 6.2, 0.2, 6.2, 8.2), { label: 'Concrete wall', side: 'right', pad: 40, maxZ: 1.6 });
    await rec.endBeat('setup_c', 0.2);
    await rec.beat('setup_d', await scoreRect(rec), { label: 'Coverage at 3 bars or more', side: 'left', pulse: true, underline: true, maxZ: 2.0 });
    await rec.endBeat('setup_d', 0.2);
    await rec.beat('setup_e', await rec.rect('#legend'), { ringPad: 8, pad: 40, maxZ: 1.9 });
    await rec.endBeat('setup_e', 0.4);
  },

  // Hover readout: bedroom 1 behind the concrete wall.
  async probe(rec, page) {
    await open(page, rec, '?fresh');
    await rec.idle();
    await rec.jump({ x: 1330, y: 720 });
    await rec.hold(0.1);
    rec.showCursor(true);
    rec.start();
    const b1 = await rec.plan(8.5, 2.5);
    await rec.beat('probe_a', await rec.planRect(6.2, 0.2, 11.2, 4.4), { label: 'Bedroom 1', side: 'bottom', pad: 30, maxZ: 1.8, sec: 0.9 });
    await rec.moveTo({ x: b1.x, y: b1.y }, 1.4, 0.06);
    await rec.endBeat('probe_a', 0.15);
    rec.notes.probe = await rec.text('#probe');
    await rec.beat('probe_b', await rec.rect('.probe-dbm'), { label: 'Predicted level', side: 'right', pulse: true, underline: true, ringPad: 8, maxZ: 2.2, dy: 40 });
    await rec.endBeat('probe_b', 0.2);
    // the concrete segment the line crosses (spine wall, between the two doors)
    await rec.beat('probe_c', await wallRect(rec, 6.2, 3.4, 6.2, 4.8), { label: 'Concrete: −19.3 dB', side: 'left', pad: 60, maxZ: 2.0 });
    await rec.endBeat('probe_c', 0.4);
  },

  // The wow: Find the best spot, 78% -> 100%.
  async find(rec, page) {
    await open(page, rec, '?fresh');
    await rec.idle();
    await rec.jump({ x: 1390, y: 860 });
    await rec.hold(0.1);
    rec.showCursor(true);
    rec.start();
    const btn = await rec.rect('#find');
    await rec.beat('find_a', btn, { ringPad: 8, pad: 60, maxZ: 2.0, sec: 0.9 });
    await rec.moveTo({ x: btn.x + btn.width / 2, y: btn.y + btn.height / 2 }, 1.2);
    await rec.afterVo('find_a', 0.0);
    rec.mark('click');
    await rec.click();
    await rec.clear();
    rec.wide(0.9);
    await rec.beat('find_b', await routerRect(rec), { label: 'Router', side: 'top', cam: false, dim: 0.35 });
    rec.track(() => routerRect(rec));
    await rec.until(() => !document.querySelector('#result').hidden, 20);
    await rec.idle();
    rec.notes.result = await rec.text('#result');
    await rec.moveTo({ x: 1585, y: 860 }, 0.8);
    await rec.endBeat('find_b', 0.2);
    await rec.beat('find_c', await rec.rect('#r-before'), { label: 'Before', side: 'left', pulse: true, underline: true, ringPad: 10, maxZ: 2.2 });
    await rec.endBeat('find_c', 0.1);
    await rec.beat('find_d', await rec.rect('#r-after'), { label: 'Best spot', side: 'bottom', pulse: true, underline: true, ringPad: 10, maxZ: 2.2 });
    await rec.endBeat('find_d', 0.15);
    await rec.beat('find_e', await rec.rect('#r-note'), { underline: true, ringPad: 8, maxZ: 2.2, pad: 90 });
    await rec.endBeat('find_e', 0.5);
  },

  // Pick a plan: the signal spreads out and stalls at every wall.
  async plans(rec, page) {
    await open(page, rec, '?fresh');
    await rec.idle();
    await rec.jump({ x: 1360, y: 600 });
    await rec.hold(0.1);
    rec.showCursor(true);
    rec.start();
    await rec.beat('plans_a', await rec.rect('#templates'), { ringPad: 8, pad: 70, maxZ: 2.0, sec: 0.8 });
    const t = await rec.centre('.template[data-id="terrace"]');
    await rec.moveTo(t, 1.3);
    await rec.afterVo('plans_a', 0.0);
    await rec.click();
    await rec.clear();
    await rec.beat('plans_b', await rec.rect('#plan'), { ringPad: 4, pad: 10, maxZ: 1.25, sec: 0.8, dim: 0.45 });
    await rec.endBeat('plans_b', 0.4);
  },

  // Band switch on the hostel wing, then Find the best spot there.
  async hostel(rec, page) {
    await open(page, rec, '?fresh&plan=hostel&band=5');
    await rec.idle();
    await rec.jump({ x: 1300, y: 330 });
    await rec.hold(0.1);
    rec.showCursor(true);
    rec.start();
    await rec.beat('hostel_a', await rec.rect('#band'), { label: '2.4 / 5 GHz', side: 'left', ringPad: 8, pad: 60, maxZ: 2.2 });
    await rec.moveTo(await rec.centre('#band button[data-band="2.4"]'), 1.3);
    await rec.afterVo('hostel_a', 0.0);
    await rec.click();
    await rec.clear();
    await rec.hold(0.2);
    await rec.beat('hostel_b', await rec.planRect(8.6, 0.2, 17.0, 3.8), { label: 'Dead zones', side: 'bottom', ringPad: 6, pad: 50, maxZ: 1.6 });
    await rec.idle();
    await rec.endBeat('hostel_b', 0.15);
    const btn = await rec.rect('#find');
    await rec.beat('hostel_c', btn, { ringPad: 8, pad: 60, maxZ: 2.0, sec: 0.8 });
    await rec.moveTo({ x: btn.x + btn.width / 2, y: btn.y + btn.height / 2 }, 1.1);
    await rec.afterVo('hostel_c', 0.0);
    await rec.click();
    await rec.clear();
    rec.wide(0.8);
    await rec.until(() => !document.querySelector('#result').hidden, 20);
    await rec.idle();
    rec.notes.result = await rec.text('#result');
    await rec.moveTo({ x: 1585, y: 860 }, 0.6);
    await rec.beat('hostel_d', await rec.rect('#result'), { label: '70% → 96%', side: 'left', pulse: true, ringPad: 8, maxZ: 2.0 });
    await rec.endBeat('hostel_d', 0.6);
  },

  // Change a wall's material: the bedroom behind it gets more signal.
  async swap(rec, page) {
    await open(page, rec, '?fresh');
    await rec.idle();
    await rec.jump({ x: 1300, y: 760 });
    await rec.hold(0.1);
    rec.showCursor(true);
    rec.start();
    const w = await rec.plan(6.2, 7.0);
    await rec.beat('swap_a', await wallRect(rec, 6.2, 5.6, 6.2, 8.2), { label: 'Concrete wall', side: 'left', pad: 60, maxZ: 1.8 });
    await rec.moveTo(w, 1.3);
    await rec.afterVo('swap_a', 0.0);
    await rec.click();
    await rec.clear();
    await rec.hold(0.2);
    rec.notes.selected = await rec.text('#materials');
    await rec.beat('swap_b', await rec.rect('#materials'), { ringPad: 6, pad: 50, maxZ: 2.0 });
    await rec.moveTo(await rec.centre('.chip[data-mat="plasterboard"]'), 1.0);
    await rec.afterVo('swap_b', 0.0);
    await rec.click();
    await rec.clear();
    await rec.beat('swap_c', await rec.planRect(6.2, 4.4, 11.2, 8.2), { label: 'Bedroom 2', side: 'top', ringPad: 6, pad: 50, maxZ: 1.7 });
    await rec.moveTo({ x: w.x + 160, y: w.y + 60 }, 1.0);
    rec.notes.after = await rec.text('.score-label');
    await rec.endBeat('swap_c', 0.5);
  },

  // Draw a concrete wall, then drag the router: the map follows live.
  async edit(rec, page) {
    await open(page, rec, '?fresh');
    await rec.idle();
    await rec.jump({ x: 1300, y: 330 });
    await rec.hold(0.1);
    rec.showCursor(true);
    rec.start();
    await rec.beat('edit_a', await rec.rect('.tool[data-tool="wall"]'), { label: 'Draw wall', side: 'bottom', ringPad: 6, pad: 60, maxZ: 2.0 });
    await rec.moveTo(await rec.centre('.tool[data-tool="wall"]'), 1.0);
    await rec.click();
    await rec.afterVo('edit_a', 0.0);
    await rec.clear();
    await rec.beat('edit_b', await rec.rect('#materials'), { ringPad: 6, pad: 50, maxZ: 2.0 });
    await rec.moveTo(await rec.centre('.chip[data-mat="concrete"]'), 1.0);
    await rec.click();
    await rec.afterVo('edit_b', 0.0);
    await rec.clear();
    const a = await rec.plan(2.4, 4.9);
    const b = await rec.plan(2.4, 7.5);
    rec.focus(await rec.planRect(0, 3.2, 11.2, 8.4), 0.8, { pad: 20, maxZ: 1.5 });
    rec.vo('edit_c');
    await rec.moveTo(a, 0.6);
    await rec.press();
    await rec.moveTo(b, 0.8, 0);
    await rec.release();
    await rec.callout(await wallRect(rec, 2.4, 4.9, 2.4, 7.5), { label: 'New concrete wall', side: 'right', pad: 60, maxZ: 1.5, cam: false });
    await rec.endBeat('edit_c', 0.2);
    // drag
    await rec.moveTo(await rec.centre('.tool[data-tool="move"]'), 0.7);
    await rec.click();
    const r0 = await rec.plan(0.7, 7.7);
    await rec.moveTo(r0, 0.8);
    rec.focus(await rec.rect('#plan'), 0.8, { pad: 10, maxZ: 1.2 });
    await rec.beat('edit_d', await routerRect(rec), { label: 'Router', side: 'top', cam: false, dim: 0.35 });
    rec.track(() => routerRect(rec));
    await rec.press();
    for (const [x, y] of [[1.4, 6.0], [2.0, 4.2], [3.6, 3.7], [4.9, 4.6], [5.4, 6.4], [4.2, 7.2], [3.4, 5.6]]) await rec.moveTo(await rec.plan(x, y), 0.75, 0.05);
    await rec.release();
    await rec.endBeat('edit_d', 0.5);
  },

  // Predicted, not measured; the formula and the sources.
  async honest(rec, page) {
    await open(page, rec, '?fresh');
    await rec.idle();
    await rec.jump({ x: 1250, y: 760 });
    await rec.hold(0.1);
    rec.showCursor(true);
    rec.start();
    await rec.beat('honest_a', await textRect(rec, '.sheet *', /Predicted signal, not measured/), { underline: true, ringPad: 8, pad: 120, maxZ: 2.2, sec: 0.9 });
    await rec.endBeat('honest_a', 0.15);
    await rec.beat('honest_b', await rec.rect('#open-model'), { ringPad: 6, pad: 80, maxZ: 2.2 });
    await rec.moveTo(await rec.centre('#open-model'), 1.0);
    await rec.afterVo('honest_b', 0.0);
    await rec.click();
    await rec.clear();
    await rec.hold(0.45);
    const formula = await rec.page.evaluate(() => {
      const b = [...document.querySelectorAll('#drawer-body b')].find((e) => /Received level/.test(e.textContent));
      const r = b.parentElement.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    await rec.beat('honest_c', formula, { ringPad: 8, pad: 40, maxZ: 2.0 });
    await rec.moveTo({ x: formula.x + formula.width * 0.6, y: formula.y + formula.height + 160 }, 0.8);
    await rec.endBeat('honest_c', 0.1);
    // scroll the sheet to the sources, then call them out
    for (let i = 0; i < 40; i++) { await page.evaluate(() => { const d = document.querySelector('#drawer'); const sc = [d, ...d.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== 'visible'); const h = [...d.querySelectorAll('h3')].find((e) => /Sources/.test(e.textContent)); const target = h.getBoundingClientRect().top - 90; sc.scrollTop += Math.max(0, target) * 0.16; }); await rec.frame(); }
    const sources = await rec.page.evaluate(() => {
      const h = [...document.querySelectorAll('#drawer h3')].find((e) => /Sources/.test(e.textContent));
      const a = h.getBoundingClientRect(), b = h.nextElementSibling.getBoundingClientRect();
      const y1 = Math.min(b.bottom, innerHeight - 10);
      return { x: Math.min(a.x, b.x), y: a.y, width: Math.max(a.right, b.right) - Math.min(a.x, b.x), height: y1 - a.y };
    });
    await rec.beat('honest_d', sources, { ringPad: 8, pad: 30, maxZ: 1.8 });
    await rec.endBeat('honest_d', 0.8, false);
  },
};

// Title cards (video/cards.html), on the same stepped clock, no cursor.
const CARD_LEN = { logo: 3.4, why: 5.6, close: 4.6 };
for (const [card, sec] of Object.entries(CARD_LEN)) {
  scenes[`card-${card}`] = async (rec, page) => {
    await page.goto(BASE + `video/cards.html?card=${card}`);
    await page.evaluate(() => document.fonts.ready);
    rec.start();
    await rec.hold(sec);
  };
}

// Captions: transparent 1920x1080 PNGs drawn by cards.html in the app's type.
async function captions(browser) {
  const { CAPTIONS } = await import('./script.mjs');
  mkdirSync(`${WORK}cap`, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const [id, cap] of Object.entries(CAPTIONS)) {
    await page.goto(`${BASE}video/cards.html?card=cap&cap=${encodeURIComponent(cap)}`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${WORK}cap/${id}.png`, omitBackground: true });
  }
  await page.close();
}

const browser = await chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
if (!only.length || only.includes('captions')) await captions(browser);
for (const [name, fn] of Object.entries(scenes)) {
  if (only.length && !only.includes(name)) continue;
  const card = name.startsWith('card-');
  const view = card ? { width: 1920, height: 1080 } : APP_VIEW;
  const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: card ? 1 : 2, reducedMotion: 'no-preference' });
  await ctx.addInitScript(CLOCK);
  await ctx.addInitScript(OVERLAY);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(name, 'page error:', e.message));
  const cdp = await ctx.newCDPSession(page);
  const rec = new Recorder(page, cdp, name, view);
  await fn(rec, page);
  await rec.finish();
  await ctx.close();
}
await browser.close();
