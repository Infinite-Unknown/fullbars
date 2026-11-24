// Drives the core flow like a judge would and saves a screenshot of each step.
// Usage: node tools/flow.mjs [url] [outdir]
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5243/?fresh';
const out = process.argv[3] ?? 'assets';
const browser = await chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));

const idle = () => page.waitForFunction(() => window.fullbars && !window.fullbars.busy, null, { timeout: 20000 });
const cov = () => page.evaluate(() => Math.round(window.fullbars.coverage.covered * 1000) / 10);
const routerPx = async () => {
  const box = await page.locator('#plan').boundingBox();
  const r = await page.evaluate(() => window.fullbars.router);
  // read the layout the renderer uses
  return { box, r };
};
const log = (...a) => console.log(...a);

await page.goto(url);
await idle();
await page.waitForTimeout(500);
log('heat path:', await page.evaluate(() => window.fullbars.heatPath()));
log('1 start coverage', await cov());
await page.screenshot({ path: `${out}/flat-5ghz-router-by-door-78pct.png` });

// probe a point in bedroom 1
const canvas = page.locator('#plan');
const box = await canvas.boundingBox();
await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.32);
await page.waitForTimeout(300);
const probeText = await page.locator('#probe').innerText();
log('2 probe:', probeText.replace(/\s+/g, ' '));
await page.screenshot({ path: `${out}/probe-bedroom-through-concrete.png` });

// drag the router towards the middle of the living room
const { r } = await routerPx();
const rpx = await page.evaluate(() => window.fullbars.routerPx());
await page.mouse.move(rpx.x + box.x, rpx.y + box.y);
await page.mouse.down();
for (let i = 1; i <= 20; i++) {
  await page.mouse.move(box.x + rpx.x + i * 14, box.y + rpx.y - i * 12);
  await page.waitForTimeout(16);
}
await page.mouse.up();
await page.waitForTimeout(200);
log('3 after drag router', JSON.stringify(await page.evaluate(() => window.fullbars.router)), 'from', JSON.stringify(r), 'coverage', await cov());
await page.screenshot({ path: `${out}/router-dragged-to-living-room.png` });

// reset and run find the best spot
await page.goto(url);
await idle();
const before = await cov();
await page.click('#find');
await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/find-best-spot-searching.png` });
await page.waitForSelector('#result:not([hidden])', { timeout: 20000 });
await idle();
await page.waitForTimeout(800);
log('4 best spot: before', before, 'after', await cov(), 'card', (await page.locator('#result').innerText()).replace(/\s+/g, ' '));
await page.screenshot({ path: `${out}/best-spot-78-to-100pct.png` });

// switch band
await page.click('#band button[data-band="2.4"]');
await idle();
await page.waitForTimeout(400);
log('5 at 2.4 GHz coverage', await cov());
await page.screenshot({ path: `${out}/flat-2-4ghz.png` });

// hostel template
await page.click('.template[data-id="hostel"]');
await idle();
await page.waitForTimeout(400);
log('6 hostel 2.4 coverage', await cov());
await page.screenshot({ path: `${out}/hostel-2-4ghz-dead-rooms.png` });

// draw a concrete wall, then erase it
await page.click('.tool[data-tool="wall"]');
await page.click('.chip[data-mat="concrete"]');
const b2 = await canvas.boundingBox();
await page.mouse.move(b2.x + b2.width * 0.62, b2.y + b2.height * 0.62);
await page.mouse.down();
await page.mouse.move(b2.x + b2.width * 0.62, b2.y + b2.height * 0.8, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
log('7 after drawing a concrete wall in the corridor', await cov());
await page.screenshot({ path: `${out}/drew-concrete-wall.png` });

// open the model sheet
await page.click('#open-model');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/model-sheet-sources.png` });
await page.keyboard.press('Escape');

log('errors:', errors.length ? errors : 'none');
await browser.close();
