// Records real footage of the running app, one clip per scene, using the browser's
// screencast (lossless-ish JPEG frames with timestamps), then encodes each clip to MP4.
// Usage: node video/record.mjs [baseUrl] [scene ...]
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'http://localhost:5243/';
const only = process.argv.slice(3);
const WORK = fileURLToPath(new URL('./work/clips/', import.meta.url));
const VIEW = { width: 1536, height: 864 };
const SCALE = 1.25; // 1920 x 1080 frames

const CURSOR = `
(() => {
  const install = () => {
    if (document.getElementById('__cursor')) return;
    const c = document.createElement('div');
    c.id = '__cursor';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M4 2.5l16 9.2-7 1.6-3.4 6.6z" fill="#121417" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-100px,-100px)', transition: 'none' });
    document.documentElement.appendChild(c);
    const ring = document.createElement('div');
    Object.assign(ring.style, { position: 'fixed', left: '0', top: '0', width: '36px', height: '36px', margin: '-18px 0 0 -18px', borderRadius: '50%', border: '2px solid #0b3bf5', zIndex: 2147483646, pointerEvents: 'none', opacity: '0' });
    document.documentElement.appendChild(ring);
    addEventListener('pointermove', (e) => { c.style.transform = 'translate(' + (e.clientX - 4) + 'px,' + (e.clientY - 3) + 'px)'; }, true);
    addEventListener('pointerdown', (e) => {
      ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px';
      ring.animate([{ opacity: 0.9, transform: 'scale(0.5)' }, { opacity: 0, transform: 'scale(1.3)' }], { duration: 420, easing: 'cubic-bezier(0.23,1,0.32,1)' });
    }, true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', install); else install();
})();`;

async function recordScene(browser, name, fn, view = VIEW, scale = SCALE) {
  const dir = join(WORK, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'f'), { recursive: true });
  const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: scale });
  if (!name.startsWith('card-')) await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    const i = frames.length;
    const file = join(dir, 'f', `${String(i).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch { /* closed */ }
  });
  const helpers = makeHelpers(page);
  // load first, start capturing right before the scene's own actions
  await fn(page, helpers, async () => {
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  });
  await page.waitForTimeout(300);
  await cdp.send('Page.stopScreencast');
  await ctx.close();
  // concat list with real frame durations, then a constant 30 fps MP4
  let list = '';
  for (let i = 0; i < frames.length; i++) {
    const d = i + 1 < frames.length ? frames[i + 1].t - frames[i].t : 0.3;
    list += `file '${frames[i].file}'\nduration ${Math.max(0.001, d).toFixed(4)}\n`;
  }
  list += `file '${frames[frames.length - 1].file}'\n`;
  writeFileSync(join(dir, 'list.txt'), list);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'),
    '-vf', 'scale=1920:1080:flags=lanczos,fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', join(WORK, `${name}.mp4`)]);
  const dur = frames.length ? frames[frames.length - 1].t - frames[0].t : 0;
  console.log(`${name}: ${frames.length} frames, ${dur.toFixed(1)} s`);
}

function makeHelpers(page) {
  let pos = { x: 640, y: 400 };
  const glide = async (x, y, ms = 700) => {
    const steps = Math.max(8, Math.round(ms / 16));
    const from = { ...pos };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
      await page.waitForTimeout(ms / steps);
    }
    pos = { x, y };
  };
  const center = async (sel) => {
    await page.locator(sel).first().scrollIntoViewIfNeeded();
    const b = await page.locator(sel).first().boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const clickEl = async (sel, ms = 600) => {
    const c = await center(sel);
    await glide(c.x, c.y, ms);
    await page.waitForTimeout(120);
    await page.mouse.down();
    await page.waitForTimeout(90);
    await page.mouse.up();
  };
  const plan = async (x, y) => {
    const b = await page.locator('#plan').boundingBox();
    const p = await page.evaluate(([x, y]) => window.fullbars.toPx(x, y), [x, y]);
    return { x: b.x + p.x, y: b.y + p.y };
  };
  const idle = () => page.waitForFunction(() => window.fullbars && !window.fullbars.busy, null, { timeout: 30000 });
  const setPos = (x, y) => { pos = { x, y }; };
  return { glide, clickEl, plan, idle, setPos, page };
}

const scenes = {
  // Router by the front door; probe the bedrooms behind the concrete wall.
  async problem(page, h, start) {
    await start();
    await page.goto(BASE + '?fresh');
    await h.idle();
    await page.waitForTimeout(600);
    await page.mouse.move(700, 160);
    h.setPos(700, 160);
    const a = await h.plan(9.2, 2.6);
    await h.glide(a.x, a.y, 1400);
    await page.waitForTimeout(1600);
    const b = await h.plan(10.2, 1.0);
    await h.glide(b.x, b.y, 1100);
    await page.waitForTimeout(1500);
    const c = await h.plan(8.6, 6.8);
    await h.glide(c.x, c.y, 1100);
    await page.waitForTimeout(1800);
  },

  // Pick plans, draw a wall, drag the router: the map follows live.
  async see(page, h, start) {
    await page.goto(BASE + '?fresh');
    await h.idle();
    await page.mouse.move(1100, 650);
    h.setPos(1100, 650);
    await start();
    await page.waitForTimeout(300);
    await h.clickEl('.template[data-id="terrace"]', 700);
    await page.waitForTimeout(2200);
    await h.clickEl('.template[data-id="flat"]', 600);
    await page.waitForTimeout(2000);
    // draw a plasterboard wall to close off a study corner in the living room
    await h.clickEl('.tool[data-tool="wall"]', 900);
    await page.waitForTimeout(250);
    await h.clickEl('.chip[data-mat="plasterboard"]', 700);
    await page.waitForTimeout(300);
    const w1 = await h.plan(3.2, 3.6);
    const w2 = await h.plan(3.2, 6.0);
    await h.glide(w1.x, w1.y, 900);
    await page.mouse.down();
    await h.glide(w2.x, w2.y, 1100);
    await page.mouse.up();
    await page.waitForTimeout(700);
    await h.clickEl('.tool[data-tool="move"]', 900);
    await page.waitForTimeout(300);
    // drag the router out of the corner, slowly, through the living room
    const r0 = await h.plan(0.7, 7.7);
    await h.glide(r0.x, r0.y, 1000);
    await page.mouse.down();
    const path = [[1.6, 6.6], [2.6, 5.4], [3.0, 4.4], [4.6, 4.4], [5.2, 5.6]];
    for (const [x, y] of path) {
      const q = await h.plan(x, y);
      await h.glide(q.x, q.y, 900);
    }
    await page.mouse.up();
    await page.waitForTimeout(1200);
  },

  // The wow: one click, the router glides to the best spot.
  async best(page, h, start) {
    await page.goto(BASE + '?fresh');
    await h.idle();
    await page.mouse.move(900, 600);
    h.setPos(900, 600);
    await start();
    await page.waitForTimeout(900);
    await h.clickEl('#find', 1000);
    await page.waitForSelector('#result:not([hidden])', { timeout: 30000 });
    await h.idle();
    await page.waitForTimeout(900);
    const r = await h.plan(5.4, 6.9);
    await h.glide(r.x, r.y, 1200);
    await page.waitForTimeout(3400);
  },

  // Band switch, hostel, change a wall.
  async value(page, h, start) {
    await page.goto(BASE + '?fresh');
    await h.idle();
    await page.mouse.move(1000, 300);
    h.setPos(1000, 300);
    await start();
    await page.waitForTimeout(400);
    await h.clickEl('#band button[data-band="2.4"]', 800);
    await page.waitForTimeout(2200);
    await h.clickEl('.template[data-id="hostel"]', 900);
    await page.waitForTimeout(2800);
    // select the block wall between room C and room D and make it plasterboard
    const w = await h.plan(8.6, 2.0);
    await h.glide(w.x, w.y, 1100);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(700);
    await h.clickEl('.chip[data-mat="plasterboard"]', 1000);
    await page.waitForTimeout(1600);
    await h.clickEl('.chip[data-mat="concrete"]', 500);
    await page.waitForTimeout(1200);
    await h.clickEl('#find', 1000);
    await page.waitForSelector('#result:not([hidden])', { timeout: 30000 });
    await h.idle();
    await page.waitForTimeout(2200);
  },

  // Shows its working: the model sheet with the sources.
  async working(page, h, start) {
    await page.goto(BASE + '?fresh');
    await h.idle();
    await page.mouse.move(900, 300);
    h.setPos(900, 300);
    await start();
    await page.waitForTimeout(300);
    await h.clickEl('#open-model', 700);
    await page.waitForTimeout(1500);
    await page.mouse.move(1000, 500);
    h.setPos(1000, 500);
    for (let i = 0; i < 24; i++) {
      await page.mouse.wheel(0, 40);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(1800);
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, 60);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(2200);
  },
};

// Animated title cards (video/cards.html), recorded the same way.
const CARD_LEN = { hook: 6500, logo: 4200, why: 6000, close: 5600 };
for (const [card, ms] of Object.entries(CARD_LEN)) {
  scenes[`card-${card}`] = async (page, _h, start) => {
    await start();
    await page.goto(BASE + `video/cards.html?card=${card}`);
    await page.waitForTimeout(ms);
  };
}

const browser = await chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
mkdirSync(WORK, { recursive: true });
for (const [name, fn] of Object.entries(scenes)) {
  if (only.length && !only.includes(name)) continue;
  if (name.startsWith('card-')) await recordScene(browser, name, fn, { width: 1920, height: 1080 }, 1);
  else await recordScene(browser, name, fn);
}
await browser.close();
