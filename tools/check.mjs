// Opens the app in headless Chromium, waits for the first render, saves screenshots,
// prints console errors and the coverage numbers. Usage: node tools/check.mjs [url] [outdir]
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5243/?fresh';
const out = process.argv[3] ?? 'assets';
const browser = await chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
const errors = [];
for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => window.fullbars && !window.fullbars.busy, null, { timeout: 15000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/check-${name}.png`, fullPage: name === 'mobile' });
  console.log(name, JSON.stringify(await page.evaluate(() => window.fullbars.coverage.covered)));
  await page.close();
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
