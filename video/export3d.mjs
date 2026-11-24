// Exports the app's own predicted heat layer (before and after "Find the best spot")
// and the plan geometry, for the 3D title shot. Usage: node video/export3d.mjs [baseUrl]
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'http://localhost:5243/';
const OUT = fileURLToPath(new URL('./work/3d/', import.meta.url));
const browser = await chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1300 }, deviceScaleFactor: 2 });
const idle = () => page.waitForFunction(() => window.fullbars && !window.fullbars.busy, null, { timeout: 30000 });
await page.goto(BASE + '?fresh');
await idle();
const save = async (name) => {
  const url = await page.evaluate(() => window.fullbars.heatPng());
  writeFileSync(OUT + name, Buffer.from(url.split(',')[1], 'base64'));
};
await save('heat-before.png');
const before = await page.evaluate(() => ({ plan: window.fullbars.plan(), coverage: window.fullbars.coverage.covered }));
await page.click('#find');
await page.waitForSelector('#result:not([hidden])', { timeout: 30000 });
await idle();
await save('heat-after.png');
const after = await page.evaluate(() => ({ router: window.fullbars.router, coverage: window.fullbars.coverage.covered }));
writeFileSync(OUT + 'plan.json', JSON.stringify({ ...before.plan, before: before.coverage, after }, null, 1));
console.log('before', before.coverage, 'after', after);
await browser.close();
