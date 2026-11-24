// Screenshots every screen and state at 1440 px and 375 px, plus reduced motion and
// the no-WebGL2 (CPU) heat path. Usage: node tools/shots.mjs <outdir> [url]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'assets/after';
const url = process.argv[3] ?? 'http://localhost:5243/?fresh';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
const errors = [];
const report = {};

const NO_WEBGL2 = () => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (type === 'webgl2') return null;
    return orig.call(this, type, ...rest);
  };
};

async function open(name, viewport, opts = {}) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    reducedMotion: opts.reduced ? 'reduce' : 'no-preference',
    hasTouch: viewport.width < 500,
    isMobile: viewport.width < 500,
  });
  if (opts.noGl) await ctx.addInitScript(NO_WEBGL2);
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(url + (opts.query ?? ''));
  await idle(page);
  await page.waitForTimeout(500);
  return { page, ctx };
}
const idle = (page) => page.waitForFunction(() => window.fullbars && !window.fullbars.busy, null, { timeout: 20000 });
const cov = (page) => page.evaluate(() => Math.round(window.fullbars.coverage.covered * 1000) / 10);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = (page, file, full = false) => page.screenshot({ path: `${out}/${file}.png`, fullPage: full });

for (const [tag, viewport] of [['1440', { width: 1440, height: 900 }], ['375', { width: 375, height: 812 }]]) {
  const full = tag === '375';
  const { page, ctx } = await open(tag, viewport);
  report[`${tag} heat path`] = await page.evaluate(() => window.fullbars.heatPath());
  report[`${tag} overflow px`] = await overflow(page);
  report[`${tag} start`] = await cov(page);
  await shot(page, `${tag}-01-first-load`, full);

  // mid-spread frame (signature animation)
  await page.click('.template[data-id="flat"]');
  await page.waitForTimeout(450);
  await shot(page, `${tag}-02-spread-midway`);
  await idle(page);

  // probe (hover on desktop, tap on phone)
  const box = await page.locator('#plan').boundingBox();
  if (full) await page.touchscreen.tap(box.x + box.width * 0.72, box.y + box.height * 0.32);
  else await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.32);
  await page.waitForTimeout(300);
  await shot(page, `${tag}-03-probe`);

  // searching + result
  await page.click('#find');
  await page.waitForTimeout(250);
  await shot(page, `${tag}-04-searching`);
  await page.waitForSelector('#result:not([hidden])', { timeout: 20000 });
  await idle(page);
  await page.waitForTimeout(800);
  report[`${tag} best`] = await cov(page);
  await shot(page, `${tag}-05-best-spot`, full);

  // 2.4 GHz and hostel
  await page.click('#band button[data-band="2.4"]');
  await idle(page);
  await page.waitForTimeout(400);
  await shot(page, `${tag}-06-flat-2-4ghz`);
  await page.click('.template[data-id="hostel"]');
  await idle(page);
  await page.waitForTimeout(400);
  report[`${tag} hostel 2.4`] = await cov(page);
  await shot(page, `${tag}-07-hostel-2-4ghz`, full);

  // wall tool
  await page.click('.tool[data-tool="wall"]');
  await page.waitForTimeout(200);
  await shot(page, `${tag}-08-wall-tool`);

  // model sheet
  await page.click('#open-model');
  await page.waitForTimeout(500);
  await shot(page, `${tag}-09-model-sheet`);
  await page.keyboard.press('Escape');
  await ctx.close();
}

// reduced motion and no WebGL2 at desktop, plus a narrow phone
{
  const { page, ctx } = await open('reduced', { width: 1440, height: 900 }, { reduced: true });
  await page.click('#find');
  await page.waitForSelector('#result:not([hidden])', { timeout: 20000 });
  await idle(page);
  await page.waitForTimeout(400);
  await shot(page, '1440-10-reduced-motion-best-spot');
  await ctx.close();
}
{
  const { page, ctx } = await open('nogl', { width: 1440, height: 900 }, { noGl: true });
  report['nogl heat path'] = await page.evaluate(() => window.fullbars.heatPath());
  report['nogl start'] = await cov(page);
  await shot(page, '1440-11-no-webgl2');
  await page.click('#find');
  await page.waitForSelector('#result:not([hidden])', { timeout: 20000 });
  await idle(page);
  await page.waitForTimeout(600);
  await shot(page, '1440-12-no-webgl2-best-spot');
  await ctx.close();
}
{
  const { page, ctx } = await open('320', { width: 320, height: 700 });
  report['320 overflow px'] = await overflow(page);
  await shot(page, '320-01-first-load', true);
  await ctx.close();
}

console.log(JSON.stringify(report, null, 1));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
