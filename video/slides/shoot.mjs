// shoot.mjs — renders slides.html and captures each .slide as a 1920x1080 PNG.
// Usage: node shoot.mjs   (needs playwright installed alongside)
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('file://' + path.join(dir, 'slides.html'));
const slides = await page.$$('.slide');
for (const [i, slide] of slides.entries()) {
  await slide.screenshot({ path: path.join(dir, '..', 'build', `slide${i + 1}.png`) });
  console.log(`slide${i + 1}.png`);
}
await browser.close();
