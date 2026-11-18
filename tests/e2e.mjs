// Prueba de punta a punta con Playwright: node tests/e2e.mjs <archivo.zip|psd> [salida]
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'fs';
const [file, out = '/tmp/banners-e2e'] = process.argv.slice(2);
const url = process.env.APP_URL || 'http://localhost:8765/';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
if (file) await page.setInputFiles('#file', file);
else await page.click('#btnDemo');
await page.waitForFunction(() => window.__app && window.__app.project, null, { timeout: 180000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/1-editor.png` });
console.log('ingest:', await page.textContent('#ingestInfo'));
// Sumar 728x90
await page.click('#sizes .chip:has-text("728x90")');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/2-728.png` });
await page.click('#btnGenerate');
await page.waitForFunction(() => window.__lastResults, null, { timeout: 180000 });
const res = await page.evaluate(async () => Promise.all(window.__lastResults.map(async (r) => ({
  size: r.size, zip: r.zip.size, gif: r.gif.size, q: r.quality, fits: r.fits,
  zipB64: btoa(Array.from(new Uint8Array(await r.zip.arrayBuffer()), (c) => String.fromCharCode(c)).join('')),
  gifB64: btoa(Array.from(new Uint8Array(await r.gif.arrayBuffer()), (c) => String.fromCharCode(c)).join('')),
}))));
for (const r of res) {
  console.log(r.size, 'zip', (r.zip / 1024).toFixed(1), 'KB', 'gif', (r.gif / 1024).toFixed(1), 'KB', 'q', r.q, 'fits', r.fits);
  fs.writeFileSync(`${out}/${r.size}.zip`, Buffer.from(r.zipB64, 'base64'));
  fs.writeFileSync(`${out}/${r.size}.gif`, Buffer.from(r.gifB64, 'base64'));
}
await page.screenshot({ path: `${out}/3-generated.png` });
console.log('errors:', errors);
await browser.close();
