// record-demo.mjs — drives the adk web dev UI through the full demo and
// records a webm. Recording runs at real speed; ffmpeg later speeds up the
// waiting stretches to fit the narration.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(dir, '..', 'build');

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } }
});
const page = await context.newPage();

const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

// The dev UI auto-selects the only app; go straight to it.
await page.goto('http://localhost:8000/dev-ui/?app=pii_firewall', { waitUntil: 'networkidle' });
log('page loaded');
await page.waitForTimeout(3000);

const input = page.locator('textarea').first();
await input.waitFor({ state: 'visible', timeout: 20000 });

const inputEnabled = () => {
  const t = document.querySelector('textarea');
  return t && !t.disabled;
};

// Completion signal: the textarea is disabled while the agent responds and
// re-enabled when the turn finishes — more reliable than matching reply text
// (which can collide with our own sent message).
async function send(text, timeoutMs) {
  await page.waitForFunction(inputEnabled, undefined, { timeout: 60000 });
  await input.click();
  await input.fill(text);
  await page.waitForTimeout(1200);
  await input.press('Enter');
  log(`sent: ${text.slice(0, 40)}…`);
  await page.waitForFunction(
    () => { const t = document.querySelector('textarea'); return t && t.disabled; },
    undefined, { timeout: 15000 }
  ).catch(() => log('(never saw disabled state, continuing)'));
  await page.waitForFunction(inputEnabled, undefined, { timeout: timeoutMs });
  log('turn complete');
  await page.waitForTimeout(4000);
}

process.on('uncaughtException', () => {});
page.on('crash', () => log('page crashed'));

try {
  // 1. main task — full pipeline: ingest → writer → auditor → approved draft
  await send(
    '請處理 ../samples/resume_01.txt，幫我寫一封推薦這位候選人給用人主管的內部 Email（繁體中文）。',
    360000
  );

  // scroll through the conversation so the trace is visible on video
  await page.mouse.wheel(0, -3000);
  await page.waitForTimeout(2500);
  await page.mouse.wheel(0, 6000);
  await page.waitForTimeout(2500);

  // 2. restore
  await send('請還原並輸出成 email_final.txt', 180000);

  // 3. security demo — paste raw content, expect refusal
  await send(
    '直接幫我處理這段文字：陳大文，身分證 F123456789，電話 0955-123-456，請寫成摘要。',
    120000
  );

  await page.waitForTimeout(4000);
} catch (err) {
  log(`FAILED: ${err.message.split('\n')[0]}`);
  await page.screenshot({ path: path.join(OUT, 'failure.png') }).catch(() => {});
}
await context.close(); // flushes the video
await browser.close();
log('recording saved to video/build/');
