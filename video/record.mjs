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

const scenes = {
  // Hook: the app opens, the predicted signal spreads out from the router by the front door.
  async hook(rec, page) {
    await open(page, rec, '?fresh');
    await rec.hold(0.22); // uncaptured: let the sheet fade in before the first frame
    const r = await rec.plan(0.7, 7.7);
    const b2 = await rec.plan(7.0, 6.0);
    rec.start();
    rec.cam = { cx: (r.x + b2.x) / 2, cy: (r.y + b2.y) / 2 - 20, z: 1.7 };
    rec.vo('hook');
    await rec.hold(0.35);
    rec.camTo({ cx: 800, cy: 450, z: 1.0 }, 2.6, easeQuint);
    await rec.hold(2.6);
    await rec.afterVo('hook', 0.5);
  },

  // Setup: the flat as it opens, router by the front door, 78%.
  async setup(rec, page) {
    await open(page, rec, '?fresh');
    await rec.idle();
    await rec.hold(0.1);
    rec.start();
    rec.vo('setup');
    await rec.hold(0.4);
    const r = await rec.plan(0.7, 7.7);
    rec.focus({ x: r.x - 60, y: r.y - 190, width: 420, height: 250 }, 1.3, { maxZ: 2.0 });
    await rec.hold(3.0);
    rec.focus(await rec.rect('.score'), 1.2, { pad: 40, maxZ: 2.2 });
    await rec.afterVo('setup', 0.6);
  },

  // Hover readout: bedroom 1 behind the concrete wall.
  async probe(rec, page) {
    await open(page, rec, '?fresh');
    await rec.idle();
    await rec.jump({ x: 1330, y: 720 });
    await rec.hold(0.1);
    rec.showCursor(true);
    rec.start();
    rec.vo('probe');
    await rec.hold(0.4);
    const b1 = await rec.plan(8.5, 2.5);
    const area = await rec.planRect(5.4, 0.2, 11.2, 5.0);
    rec.focus(area, 1.2, { pad: 30, dx: 40 });
    await rec.moveTo({ x: b1.x - 160, y: b1.y + 140 }, 1.3);
    await rec.hold(0.3);
    await rec.moveTo({ x: b1.x, y: b1.y }, 1.0, 0.04);
    rec.mark('probe');
    await rec.hold(0.2);
    rec.notes.probe = await rec.text('#probe');
    const probeR = await rec.rect('#probe');
    rec.focus(rec.union(probeR, { x: b1.x - 120, y: b1.y - 200, width: 240, height: 260 }), 1.0, { pad: 40, maxZ: 2.1, dy: 75 });
    await rec.afterVo('probe', 0.3);
    rec.mark('probe-end');
    rec.wide(1.1);
    await rec.moveTo({ x: 1330, y: 720 }, 1.1);
    await rec.hold(0.2);
  },

  // The wow: Find the best spot, 78% -> 100%.
  async find(rec, page) {
    await open(page, rec, '?fresh');
    await rec.idle();
    await rec.jump({ x: 1390, y: 860 });
    await rec.hold(0.1);
    rec.showCursor(true);
    rec.start();
    rec.vo('find');
    await rec.hold(0.7);
    const btn = await rec.rect('#find');
    const score = await rec.rect('.score');
    rec.focus(rec.union(btn, score), 1.1, { pad: 36 });
    await rec.moveTo({ x: btn.x + btn.width / 2, y: btn.y + btn.height / 2 }, 1.3);
    await rec.hold(0.45);
    rec.mark('click');
    await rec.click();
    rec.wide(0.9);
    await rec.until(() => !document.querySelector('#result').hidden, 20);
    await rec.idle();
    rec.mark('landed');
    rec.notes.result = await rec.text('#result');
    await rec.hold(0.5);
    await rec.moveTo({ x: 1585, y: 850 }, 1.0);
    await rec.afterVo('find', 0.9);
    // result: the before/after card, then the big number
    const res = await rec.rect('#result');
    rec.focus(rec.union(res, btn), 1.0, { pad: 40 });
    rec.vo('result');
    await rec.hold(2.9);
    rec.focus(score, 0.9, { pad: 40 });
    await rec.afterVo('result', 0.9);
  },

  // Pick a plan: the signal spreads out and stalls at every wall.
  async plans(rec, page) {
    await open(page, rec, '?fresh');
    await rec.idle();
    await rec.jump({ x: 1360, y: 600 });
    await rec.hold(0.1);
    rec.showCursor(true);
    rec.start();
    rec.vo('plans');
    await rec.hold(0.3);
    const t = await rec.centre('.template[data-id="terrace"]');
    await rec.moveTo(t, 1.0);
    await rec.hold(0.15);
    await rec.click();
    const sheet = await rec.rect('#plan');
    rec.focus(sheet, 0.9, { pad: 10, maxZ: 1.25 });
    await rec.hold(2.4);
    rec.wide(0.8);
    const h = await rec.centre('.template[data-id="hostel"]');
    await rec.moveTo(h, 0.9);
    await rec.hold(0.15);
    await rec.click();
    rec.focus(await rec.rect('#plan'), 0.9, { pad: 10, maxZ: 1.25 });
    await rec.hold(2.2);
    await rec.afterVo('plans', 1.2);
  },

  // Band switch on the hostel wing, then Find the best spot there.
  async hostel(rec, page) {
    await open(page, rec, '?fresh&plan=hostel&band=5');
    await rec.idle();
    await rec.jump({ x: 1300, y: 330 });
    await rec.hold(0.1);
    rec.showCursor(true);
    rec.start();
    rec.vo('band');
    await rec.hold(0.3);
    const bandR = await rec.rect('#band');
    rec.focus(bandR, 1.0, { pad: 60, maxZ: 2.2 });
    const b24 = await rec.centre('#band button[data-band="2.4"]');
    await rec.moveTo(b24, 1.1);
    await rec.hold(0.25);
    await rec.click();
    rec.focus(await rec.rect('#plan'), 1.0, { pad: 10, maxZ: 1.25 });
    await rec.hold(1.2);
    await rec.idle();
    rec.notes.before = await rec.text('#score, .score, .coverage');
    await rec.afterVo('band', 0.3);
    rec.wide(0.9);
    rec.vo('hostel');
    const btn = await rec.rect('#find');
    await rec.moveTo({ x: btn.x + btn.width / 2, y: btn.y + btn.height / 2 }, 1.1);
    await rec.hold(0.3);
    await rec.click();
    await rec.until(() => !document.querySelector('#result').hidden, 20);
    await rec.idle();
    rec.notes.result = await rec.text('#result');
    await rec.hold(0.4);
    const score = await rec.rect('.score, #score, .coverage');
    const res = await rec.rect('#result');
    rec.focus(rec.union(score, res), 1.0, { pad: 36 });
    await rec.afterVo('hostel', 1.0);
  },

  // Change a wall's material: the room behind it gets more signal.
  async swap(rec, page) {
    await open(page, rec, '?fresh');
    await rec.idle();
    await rec.jump({ x: 1300, y: 760 });
    await rec.hold(0.1);
    rec.showCursor(true);
    rec.start();
    rec.vo('swap');
    await rec.hold(0.3);
    const bed2 = await rec.planRect(4.2, 4.2, 11.4, 8.4);
    rec.focus(bed2, 1.1, { pad: 30, maxZ: 2.0 });
    const w = await rec.plan(6.2, 7.0);
    await rec.moveTo(w, 1.3);
    await rec.hold(0.2);
    await rec.click();
    rec.notes.selected = await rec.text('#materials');
    await rec.hold(0.4);
    rec.focus(await rec.rect('#sheet'), 1.0, { pad: 0, maxZ: 1.2, minZ: 1.0 });
    await rec.moveTo(await rec.centre('.chip[data-mat="plasterboard"]'), 1.2);
    await rec.hold(0.2);
    rec.mark('swap');
    await rec.click();
    await rec.hold(0.3);
    rec.focus(bed2, 1.0, { pad: 30, maxZ: 2.0 });
    await rec.moveTo({ x: w.x + 150, y: w.y + 40 }, 1.0);
    rec.notes.after = await rec.text('.score');
    await rec.afterVo('swap', 1.0);
  },

  // Draw a concrete wall, then drag the router: the map follows live.
  async edit(rec, page) {
    await open(page, rec, '?fresh');
    await rec.idle();
    await rec.jump({ x: 1300, y: 330 });
    await rec.hold(0.1);
    rec.showCursor(true);
    rec.start();
    rec.vo('draw');
    await rec.hold(0.2);
    const tb = await rec.rect('.toolbar');
    rec.focus(tb, 0.9, { pad: 70, maxZ: 2.0, dy: 30 });
    await rec.moveTo(await rec.centre('.tool[data-tool="wall"]'), 0.9);
    await rec.click();
    await rec.hold(0.35);
    rec.focus(await rec.rect('.toolbar'), 0.5, { pad: 70, maxZ: 2.0, dy: 30 });
    await rec.moveTo(await rec.centre('.chip[data-mat="concrete"]'), 0.7);
    await rec.click();
    await rec.hold(0.3);
    const a = await rec.plan(2.4, 4.9);
    const b = await rec.plan(2.4, 7.5);
    rec.focus(await rec.planRect(0, 3.2, 11, 8), 1.0, { pad: 20, maxZ: 1.6 });
    await rec.moveTo(a, 0.9);
    await rec.press();
    await rec.moveTo(b, 1.0, 0);
    await rec.release();
    await rec.hold(0.4);
    rec.focus(await rec.rect('#plan'), 1.0, { pad: 10, maxZ: 1.2 });
    await rec.afterVo('draw', 0.6);
    // drag
    rec.vo('drag');
    await rec.moveTo(await rec.centre('.tool[data-tool="move"]'), 0.7);
    await rec.click();
    const r0 = await rec.plan(0.7, 7.7);
    await rec.moveTo(r0, 0.8);
    await rec.press();
    for (const [x, y] of [[1.4, 6.0], [2.0, 4.2], [3.6, 3.7], [4.9, 4.6], [5.4, 6.4], [4.2, 7.2], [3.4, 5.6]]) await rec.moveTo(await rec.plan(x, y), 0.85, 0.05);
    await rec.release();
    await rec.hold(0.4);
    await rec.moveTo({ x: 1330, y: 760 }, 1.0);
    await rec.afterVo('drag', 0.6);
  },

  // Predicted, not measured; the formula and the sources.
  async honest(rec, page) {
    await open(page, rec, '?fresh');
    await rec.idle();
    await rec.jump({ x: 1250, y: 760 });
    await rec.hold(0.1);
    rec.showCursor(true);
    rec.start();
    rec.vo('honest');
    const note = await rec.page.evaluate(() => {
      const el = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && /Predicted signal, not measured/.test(e.textContent));
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    rec.focus(note, 1.1, { pad: 90, maxZ: 2.2 });
    await rec.hold(2.6);
    rec.wide(1.0);
    const how = await rec.centre('#open-model');
    await rec.moveTo(how, 1.1);
    await rec.hold(0.2);
    await rec.click();
    await rec.hold(0.4);
    const dr = await rec.rect('#drawer');
    rec.focus({ x: dr.x, y: 0, width: dr.width, height: 470 }, 1.0, { pad: 12, maxZ: 1.9 });
    await rec.moveTo({ x: dr.x + dr.width * 0.5, y: 560 }, 0.8);
    await rec.hold(1.2);
    // scroll to the sources
    for (let i = 0; i < 150; i++) { if (i < 110) await page.mouse.wheel(0, 14); await rec.frame(); }
    await rec.afterVo('honest', 2.0);
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
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(name, 'page error:', e.message));
  const cdp = await ctx.newCDPSession(page);
  const rec = new Recorder(page, cdp, name, view);
  await fn(rec, page);
  await rec.finish();
  await ctx.close();
}
await browser.close();
