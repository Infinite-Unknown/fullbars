import './styles/app.css';
import { BAR_LABEL, BAR_MEANING, barsFor, type Bars } from './model/classes';
import { computeField, coverageOf, insideFloor, makeGrid, scorePosition, type Coverage, type Field, type Grid } from './model/field';
import { distanceToSegment } from './model/geometry';
import { BAND_GHZ, MATERIALS, MATERIAL_ORDER, defaultThickness, wallLossDb } from './model/materials';
import { searchSteps } from './model/optimize';
import { readingAt } from './model/propagation';
import type { Band, MaterialId, ModelSettings, Plan, Point, Wall } from './model/types';
import { TEMPLATES, makeTemplate } from './plans/templates';
import { RollingNumber } from './ui/digits';
import { BAR_COLOR, barsGlyph, logoSvg } from './ui/icons';
import { HEAT_SWATCH } from './ui/heatPalette';
import { renderModelSheet } from './ui/modelSheet';
import { PlanRenderer, type Overlay } from './ui/renderer';

// ------------------------------------------------------------------ constants
const FIELD_CELL = 0.1; // metres per heat-map cell
const STORE_KEY = 'fullbars:v1';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const stacked = window.matchMedia('(max-width: 1023px)');
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// ------------------------------------------------------------------ state
type Tool = 'move' | 'wall' | 'erase';

interface Saved {
  templateId: string;
  plan: Plan;
  settings: ModelSettings;
}

const defaults = (): ModelSettings => ({ band: '5', eirpDbm: 20, exponent: 3, thicknessM: defaultThickness() });

function load(): Saved {
  const params = new URLSearchParams(location.search);
  const fresh = params.has('fresh');
  const tpl = params.get('plan');
  if (!fresh) {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Saved;
        if (s?.plan?.walls && s?.settings?.thicknessM && !tpl) return s;
      }
    } catch {
      /* storage unavailable: start fresh */
    }
  }
  const id = tpl && TEMPLATES.some((t) => t.id === tpl) ? tpl : 'flat';
  const settings = defaults();
  const band = params.get('band');
  if (band === '2.4' || band === '5') settings.band = band;
  return { templateId: id, plan: makeTemplate(id), settings };
}

const saved = load();
let templateId = saved.templateId;
let plan: Plan = saved.plan;
let settings: ModelSettings = saved.settings;
let grid: Grid = makeGrid(plan, FIELD_CELL);
let field: Field = computeField(plan, grid, plan.router, settings);
let coverage: Coverage = coverageOf(field);

let tool: Tool = 'move';
let newMaterial: MaterialId = 'brick';
let selectedWallId: string | null = null;
let hoverWallId: string | null = null;
let probe: Overlay['probe'] = null;
let draft: Overlay['draft'] = null;
let drag: 'router' | 'wall' | null = null;
let ghost: Point | null = null;
let busy = false;
let search: { dots: Point[]; best: Point | null } | null = null;
let spreadStart: number | null = null;
let spreadDur = 0;
let glide: { from: Point; to: Point; start: number; dur: number; done: () => void } | null = null;
let heatDirty = true;
let drawDirty = true;
let wallSeq = 1000;

// ------------------------------------------------------------------ DOM
const canvas = $<HTMLCanvasElement>('#plan');
const sheet = $('#sheet');
const renderer = new PlanRenderer(canvas);
const probeEl = $('#probe');
const digits = new RollingNumber($('#digits'));
const scoreLabel = $('#score-label');
const stack = $('#stack');
const legend = $('#legend');
const findBtn = $<HTMLButtonElement>('#find');
const resultEl = $('#result');

document.querySelectorAll('[data-logo]').forEach((el) => (el.innerHTML = logoSvg()));

// stacked bar + legend rows (4 bars first)
const ORDER: Bars[] = [4, 3, 2, 1, 0];
const stackSegs = new Map<Bars, HTMLElement>();
const legendPct = new Map<Bars, HTMLElement>();
for (const b of ORDER) {
  const seg = document.createElement('span');
  seg.style.background = b === 0 ? `repeating-linear-gradient(135deg, ${BAR_COLOR[0]} 0 2px, #ffe4db 2px 6px)` : HEAT_SWATCH[b];
  stack.appendChild(seg);
  stackSegs.set(b, seg);
  const li = document.createElement('li');
  li.dataset.bars = String(b);
  li.innerHTML = `${barsGlyph(b)}<span class="legend-name">${BAR_LABEL[b]}<span class="legend-meaning">${BAR_MEANING[b]}</span></span><span class="legend-pct">0%</span>`;
  legend.appendChild(li);
  legendPct.set(b, li.querySelector('.legend-pct')!);
}

// templates
const tplHost = $('#templates');
for (const t of TEMPLATES) {
  const p = t.make();
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'template';
  b.setAttribute('role', 'radio');
  b.dataset.id = t.id;
  b.innerHTML = `<span>${t.name}</span><small>${(p.width - 0.4).toFixed(1)} × ${(p.height - 0.4).toFixed(1)} m · ${p.rooms.length} spaces</small>`;
  b.addEventListener('click', () => chooseTemplate(t.id));
  tplHost.appendChild(b);
}

// material chips
const matHost = $('#materials');
const matLabel = $('#materials-label');
const matSep = $('#mat-sep');
const MAT_WIDTH: Record<MaterialId, string> = { concrete: '4px', brick: '3px', plasterboard: '2px', glass: '1px', wood: '2px' };
for (const id of MATERIAL_ORDER) {
  const c = document.createElement('button');
  c.type = 'button';
  c.className = 'chip';
  c.setAttribute('role', 'radio');
  c.dataset.mat = id;
  c.innerHTML = `<i data-m="${id}" style="--wall-w:${MAT_WIDTH[id]}"></i>${MATERIALS[id].label}`;
  c.addEventListener('click', () => pickMaterial(id));
  matHost.appendChild(c);
}
const delChip = document.createElement('button');
delChip.type = 'button';
delChip.className = 'chip chip-danger';
delChip.textContent = 'Delete wall';
delChip.addEventListener('click', () => {
  if (selectedWallId) removeWall(selectedWallId);
});
matHost.appendChild(delChip);

// ------------------------------------------------------------------ UI sync
function syncPanel(): void {
  const pct = Math.round(coverage.covered * 100);
  digits.set(pct);
  const band = settings.band === '5' ? '5 GHz' : '2.4 GHz';
  scoreLabel.innerHTML = `of your home gets <b>3 bars or more</b>. Predicted at ${band}.<span class="visually-hidden"> Coverage ${pct} percent.</span>`;
  for (const b of ORDER) {
    const share = coverage.share[b];
    stackSegs.get(b)!.style.flexGrow = String(share);
    const label = share > 0 && share < 0.005 ? '<1%' : `${Math.round(share * 100)}%`;
    legendPct.get(b)!.textContent = label;
  }
}

function syncControls(): void {
  document.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
  sheet.dataset.tool = tool;
  const sel = selectedWallId ? plan.walls.find((w) => w.id === selectedWallId) : null;
  const showMats = tool === 'wall' || !!sel;
  const matsChanged = matHost.hidden === showMats;
  matHost.hidden = !showMats;
  matSep.hidden = !showMats;
  delChip.hidden = !sel;
  const active = sel ? sel.material : newMaterial;
  if (sel) {
    matLabel.textContent = `This wall · ${wallLossDb(sel.material, settings.band, settings.thicknessM[sel.material]).toFixed(1)} dB`;
  } else {
    matLabel.textContent = 'New walls';
  }
  matHost.querySelectorAll<HTMLButtonElement>('.chip[data-mat]').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.mat === active)));
  tplHost.querySelectorAll<HTMLButtonElement>('.template').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === templateId && !planEdited())));
  document.querySelectorAll<HTMLButtonElement>('#band button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.band === settings.band)));
  $('#band').style.setProperty('--band-i', settings.band === '5' ? '1' : '0');
  $('#scalebar').querySelector('i')!.style.width = `${renderer.layout.scale}px`;
  sheet.style.setProperty('--plan-aspect', `${plan.width} / ${plan.height + 1.6}`);
  // the toolbar can grow a row (material chips on narrow sheets): lay the plan out below it
  if (matsChanged) layout();
}

/** On the stacked (phone) layout the plan scrolls away; bring it back before it changes. */
function showPlan(): void {
  if (!stacked.matches || sheet.getBoundingClientRect().top >= 0) return;
  window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}

let pristine = JSON.stringify(makeTemplate(templateId).walls);
function planEdited(): boolean {
  return JSON.stringify(plan.walls) !== pristine;
}

let saveTimer = 0;
function persist(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ templateId, plan, settings } satisfies Saved));
    } catch {
      /* private mode or blocked storage: the app works without it */
    }
  }, 250);
}

function invalidate(opts: { spread?: boolean } = {}): void {
  heatDirty = true;
  drawDirty = true;
  if (opts.spread) startSpread();
  persist();
}

function startSpread(): void {
  if (reducedMotion.matches) {
    spreadStart = null;
    canvas.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    return;
  }
  spreadStart = performance.now();
  spreadDur = 0; // computed after the field is fresh
}

// ------------------------------------------------------------------ actions
function chooseTemplate(id: string): void {
  if (busy) return;
  showPlan();
  templateId = id;
  plan = makeTemplate(id);
  pristine = JSON.stringify(plan.walls);
  grid = makeGrid(plan, FIELD_CELL);
  selectedWallId = null;
  ghost = null;
  resultEl.hidden = true;
  layout();
  invalidate({ spread: true });
  syncControls();
}

function setBand(b: Band): void {
  if (busy || b === settings.band) return;
  settings = { ...settings, band: b };
  ghost = null;
  resultEl.hidden = true;
  invalidate({ spread: true });
  syncControls();
}

function setTool(t: Tool): void {
  tool = t;
  if (t !== 'move') selectedWallId = null;
  probe = null;
  hideProbe();
  drawDirty = true;
  syncControls();
}

function pickMaterial(id: MaterialId): void {
  const sel = selectedWallId ? plan.walls.find((w) => w.id === selectedWallId) : null;
  if (sel) {
    sel.material = id;
    invalidate();
  } else {
    newMaterial = id;
  }
  syncControls();
}

function removeWall(id: string): void {
  plan.walls = plan.walls.filter((w) => w.id !== id);
  if (selectedWallId === id) selectedWallId = null;
  hoverWallId = null;
  invalidate();
  syncControls();
}

function moveRouter(p: Point): void {
  plan.router = {
    x: Math.max(0.05, Math.min(plan.width - 0.05, p.x)),
    y: Math.max(0.05, Math.min(plan.height - 0.05, p.y)),
  };
  if (ghost) {
    ghost = null;
    resultEl.hidden = true;
  }
  invalidate();
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function glideTo(to: Point, done: () => void): void {
  if (reducedMotion.matches) {
    plan.router = { ...to };
    invalidate();
    canvas.animate([{ opacity: 0.5 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    done();
    return;
  }
  const from = { ...plan.router };
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  glide = { from, to, start: performance.now(), dur: Math.min(1400, 650 + dist * 60), done };
}

async function findBest(): Promise<void> {
  if (busy) return;
  busy = true;
  showPlan();
  selectedWallId = null;
  syncControls();
  findBtn.setAttribute('aria-busy', 'true');
  findBtn.querySelector('.btn-label')!.textContent = 'Checking spots…';
  resultEl.hidden = true;
  ghost = null;
  const before = coverage.covered;
  const from = { ...plan.router };
  search = { dots: [], best: null };
  drawDirty = true;

  const it = searchSteps(plan, settings, undefined, reducedMotion.matches ? 100000 : 10);
  let r = it.next();
  while (!r.done) {
    for (const c of r.value.scored) search.dots.push(c.p);
    search.best = r.value.best.p;
    drawDirty = true;
    await nextFrame();
    r = it.next();
  }
  const best = r.value.best;
  search = null;
  drawDirty = true;

  const finish = (moved: boolean) => {
    const fine = makeGrid(plan, FIELD_CELL);
    const after = scorePosition(plan, fine, plan.router, settings).covered;
    $('#r-before').textContent = `${Math.round(before * 100)}%`;
    $('#r-after').textContent = `${Math.round(after * 100)}%`;
    const d = Math.hypot(plan.router.x - from.x, plan.router.y - from.y);
    $('#r-note').textContent = moved
      ? `Moved ${d.toFixed(1)} m. ${r.value.evaluated} spots checked.`
      : `Your router is already in the best spot we found. ${r.value.evaluated} spots checked.`;
    $<HTMLButtonElement>('#undo').hidden = !moved;
    resultEl.hidden = false;
    findBtn.removeAttribute('aria-busy');
    findBtn.querySelector('.btn-label')!.textContent = 'Find the best spot';
    busy = false;
    syncControls();
  };

  const moved = Math.hypot(best.p.x - from.x, best.p.y - from.y) > 0.05 && best !== r.value.start;
  if (!moved) {
    finish(false);
    return;
  }
  ghost = from;
  glideTo(best.p, () => {
    ghost = from;
    drawDirty = true;
    finish(true);
  });
}

function undo(): void {
  if (!ghost || busy) return;
  const back = ghost;
  busy = true;
  resultEl.hidden = true;
  glideTo(back, () => {
    ghost = null;
    busy = false;
    drawDirty = true;
  });
}

const nextFrame = () => new Promise<void>((res) => requestAnimationFrame(() => res()));

// ------------------------------------------------------------------ probe
function hideProbe(): void {
  probeEl.dataset.show = 'false';
}

function showProbe(p: Point, cx: number, cy: number): void {
  const r = readingAt(plan.router, p, plan.walls, settings);
  const bars = barsFor(r.dbm);
  probe = { p, crossed: new Set(r.walls.map((w) => w.id)) };
  const counts = new Map<MaterialId, number>();
  for (const w of r.walls) counts.set(w.material, (counts.get(w.material) ?? 0) + 1);
  const wallText = r.walls.length
    ? `${r.walls.length} wall${r.walls.length > 1 ? 's' : ''}: ${[...counts].map(([m, n]) => `${n > 1 ? n + '× ' : ''}${MATERIALS[m].label.toLowerCase()}`).join(', ')} (−${r.wallLossDb.toFixed(1)} dB)`
    : 'No walls in the way';
  probeEl.innerHTML = `
    <div class="probe-head">${barsGlyph(bars, { dark: true })}<span class="probe-dbm">${r.dbm.toFixed(0).replace('-', '−')} dBm</span></div>
    <div>${BAR_LABEL[bars]} · predicted</div>
    <div class="probe-dim">${r.distanceM.toFixed(1)} m from the router</div>
    <div class="probe-dim">${wallText}</div>`;
  const rect = sheet.getBoundingClientRect();
  const w = probeEl.offsetWidth || 200;
  const h = probeEl.offsetHeight || 90;
  let x = cx + 18;
  let y = cy + 18;
  if (x + w > rect.width - 8) x = cx - w - 18;
  if (y + h > rect.height - 8) y = cy - h - 18;
  probeEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  probeEl.dataset.show = 'true';
}

// ------------------------------------------------------------------ pointer
function local(e: PointerEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function wallAt(p: Point, tolPx = 9): Wall | null {
  const tol = tolPx / renderer.layout.scale;
  let best: Wall | null = null;
  let bd = Infinity;
  for (const w of plan.walls) {
    const d = distanceToSegment(p, w.a, w.b);
    if (d < tol && d < bd) {
      bd = d;
      best = w;
    }
  }
  return best;
}

function nearRouter(cx: number, cy: number): boolean {
  const [rx, ry] = renderer.toPx(plan.router);
  return Math.hypot(cx - rx, cy - ry) <= 24;
}

function snap(p: Point, from?: Point): Point {
  const s = renderer.layout.scale;
  // snap to existing wall ends
  for (const w of plan.walls) {
    for (const q of [w.a, w.b]) {
      if (Math.hypot(q.x - p.x, q.y - p.y) * s < 12) return { ...q };
    }
  }
  let x = Math.round(p.x * 10) / 10;
  let y = Math.round(p.y * 10) / 10;
  if (from) {
    const ang = Math.abs(Math.atan2(y - from.y, x - from.x));
    if (ang < 0.17 || ang > Math.PI - 0.17) y = from.y;
    else if (Math.abs(ang - Math.PI / 2) < 0.17) x = from.x;
  }
  return { x: Math.max(0, Math.min(plan.width, x)), y: Math.max(0, Math.min(plan.height, y)) };
}

canvas.addEventListener('pointerdown', (e) => {
  if (busy || e.button !== 0) return;
  const [cx, cy] = local(e);
  const p = renderer.toMetres(cx, cy);
  // keyboard focus for arrow-key nudging; a finger has no keyboard, so no focus ring for taps
  if (e.pointerType === 'mouse') canvas.focus({ preventScroll: true });
  if (tool === 'move') {
    if (nearRouter(cx, cy)) {
      drag = 'router';
      sheet.dataset.drag = 'router';
      canvas.setPointerCapture(e.pointerId);
      hideProbe();
      probe = null;
    } else {
      const w = wallAt(p);
      selectedWallId = w ? w.id : null;
      syncControls();
      // touch has no hover: a tap on the floor shows the reading there, a tap elsewhere clears it
      if (e.pointerType !== 'mouse') {
        if (!w && insideFloor(plan, p)) showProbe(p, cx, cy);
        else {
          probe = null;
          hideProbe();
        }
      }
    }
  } else if (tool === 'wall') {
    const a = snap(p);
    draft = { a, b: a };
    drag = 'wall';
    canvas.setPointerCapture(e.pointerId);
  } else if (tool === 'erase') {
    const w = wallAt(p);
    if (w) removeWall(w.id);
  }
  drawDirty = true;
});

canvas.addEventListener('pointermove', (e) => {
  const [cx, cy] = local(e);
  const p = renderer.toMetres(cx, cy);
  if (drag === 'router') {
    moveRouter(p);
    return;
  }
  if (drag === 'wall' && draft) {
    draft = { a: draft.a, b: snap(p, draft.a) };
    drawDirty = true;
    return;
  }
  if (busy || e.pointerType === 'touch') return;
  const prevHover = hoverWallId;
  if (tool === 'move' && !nearRouter(cx, cy) && insideFloor(plan, p)) {
    const w = wallAt(p);
    hoverWallId = w ? w.id : null;
    showProbe(p, cx, cy);
  } else {
    probe = null;
    hideProbe();
    hoverWallId = tool === 'erase' ? wallAt(p)?.id ?? null : null;
  }
  if (prevHover !== hoverWallId || probe) drawDirty = true;
});

function endDrag(): void {
  if (drag === 'wall' && draft) {
    const len = Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y);
    if (len >= 0.3) {
      plan.walls.push({ id: `u${++wallSeq}`, a: draft.a, b: draft.b, material: newMaterial });
      invalidate();
      syncControls();
    }
  }
  draft = null;
  drag = null;
  delete sheet.dataset.drag;
  drawDirty = true;
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', (e) => {
  // a lifted finger also "leaves": keep the tapped reading on screen
  if (drag || e.pointerType !== 'mouse') return;
  probe = null;
  hoverWallId = null;
  hideProbe();
  drawDirty = true;
});

canvas.addEventListener('keydown', (e) => {
  if (busy) return;
  const step = e.shiftKey ? 0.5 : 0.1;
  const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (d[e.key]) {
    e.preventDefault();
    moveRouter({ x: plan.router.x + d[e.key][0], y: plan.router.y + d[e.key][1] });
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedWallId) {
    e.preventDefault();
    removeWall(selectedWallId);
  } else if (e.key === 'Escape') {
    selectedWallId = null;
    draft = null;
    drawDirty = true;
    syncControls();
  }
});

document.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool as Tool)));
document.querySelectorAll<HTMLButtonElement>('#band button').forEach((b) => b.addEventListener('click', () => setBand(b.dataset.band as Band)));
findBtn.addEventListener('click', () => void findBest());
$('#undo').addEventListener('click', undo);

// ------------------------------------------------------------------ model drawer
const drawer = $('#drawer');
const scrim = $('#scrim');
let lastFocus: HTMLElement | null = null;
function onSettings(s: ModelSettings): void {
  settings = s;
  invalidate();
  syncControls();
  renderModelSheet($('#drawer-body'), settings, onSettings);
}
function openModel(): void {
  lastFocus = document.activeElement as HTMLElement;
  renderModelSheet($('#drawer-body'), settings, onSettings);
  drawer.hidden = false;
  scrim.hidden = false;
  requestAnimationFrame(() => {
    drawer.dataset.open = 'true';
    scrim.dataset.open = 'true';
    $('#close-model').focus();
  });
}
function closeModel(): void {
  drawer.dataset.open = 'false';
  scrim.dataset.open = 'false';
  window.setTimeout(() => {
    drawer.hidden = true;
    scrim.hidden = true;
  }, 220);
  lastFocus?.focus();
}
$('#open-model').addEventListener('click', openModel);
$('#close-model').addEventListener('click', closeModel);
scrim.addEventListener('click', closeModel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !drawer.hidden) closeModel();
});

// ------------------------------------------------------------------ frame loop
const toolbarEl = $('.toolbar');
function layout(): void {
  renderer.resize(plan, toolbarEl.offsetTop + toolbarEl.offsetHeight + 8);
  heatDirty = true;
  drawDirty = true;
  syncControls();
}

function frame(now: number): void {
  if (glide) {
    const t = Math.min(1, (now - glide.start) / glide.dur);
    const k = easeInOut(t);
    plan.router = { x: glide.from.x + (glide.to.x - glide.from.x) * k, y: glide.from.y + (glide.to.y - glide.from.y) * k };
    heatDirty = true;
    if (t >= 1) {
      plan.router = { ...glide.to };
      const done = glide.done;
      glide = null;
      persist();
      done();
    }
  }

  const fieldChanged = heatDirty;
  if (heatDirty) {
    field = computeField(plan, grid, plan.router, settings, field.grid === grid ? field : undefined);
    coverage = coverageOf(field);
    heatDirty = false;
    syncPanel();
  }

  let revealT = Infinity;
  if (spreadStart !== null) {
    if (spreadDur === 0) spreadDur = renderer.spreadDuration(field, plan.router);
    revealT = (now - spreadStart) / 1000;
    if (revealT >= spreadDur) {
      spreadStart = null;
      revealT = Infinity;
    }
  }

  if (fieldChanged || spreadStart !== null || Number.isFinite(revealT)) {
    renderer.paintHeat(field, plan.router, revealT, plan, settings);
    drawDirty = true;
  }
  if (drawDirty) {
    const ov: Overlay = {
      selectedWallId,
      hoverWallId,
      hoverTone: tool === 'erase' ? 'erase' : 'select',
      probe,
      draft,
      ghost,
      searchDots: search?.dots ?? [],
      searchBest: search?.best ?? null,
      routerActive: drag === 'router' || !!glide,
    };
    renderer.draw(plan, plan.router, ov, now);
    drawDirty = false;
  }
  requestAnimationFrame(frame);
}

new ResizeObserver(() => layout()).observe(sheet);
layout();
syncPanel();
startSpread();
requestAnimationFrame(frame);
document.fonts?.ready.then(() => {
  drawDirty = true;
});

// expose a tiny read-only hook for automated checks and the demo recorder
(window as unknown as { fullbars: unknown }).fullbars = {
  get coverage() {
    return coverage;
  },
  get router() {
    return { ...plan.router };
  },
  get busy() {
    return busy || !!glide || spreadStart !== null;
  },
  band: () => settings.band,
  heatPath: () => renderer.heatPath,
  heatPng: () => renderer.heatPng(),
  plan: () => JSON.parse(JSON.stringify(plan)),
  routerPx: () => {
    const [x, y] = renderer.toPx(plan.router);
    return { x, y };
  },
  toPx: (x: number, y: number) => {
    const [px, py] = renderer.toPx({ x, y });
    return { x: px, y: py };
  },
  ghz: () => BAND_GHZ[settings.band],
};
