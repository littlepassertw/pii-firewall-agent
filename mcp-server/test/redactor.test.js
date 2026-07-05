// redactor.test.js — redaction/restoration invariants.
// The round-trip property (redact → restore === original) is the contract
// that makes the de-identify → cloud → re-identify loop trustworthy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.PII_FIREWALL_NER = 'off';

const { detect } = await import('../src/detector.js');
const { redact, restore, findLeftoverPlaceholders } = await import('../src/redactor.js');

const SAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'samples');
const read = (name) => fs.readFileSync(path.join(SAMPLES, name), 'utf8');

for (const sample of ['resume_01.txt', 'roster_01.txt', 'exit_interview_01.txt']) {
  test(`round-trip invariant holds for ${sample}`, async () => {
    const text = read(sample);
    const { items, registry } = await detect(text);
    const { redactedText, entries } = redact(text, items, registry);
    // Redacted text must not contain any detected original value.
    for (const entry of entries) {
      assert.ok(!redactedText.includes(entry.original), `leak: ${entry.original}`);
    }
    const { restoredText } = restore(redactedText, entries);
    assert.equal(restoredText, text);
  });
}

test('longer values are replaced before contained shorter ones', () => {
  const items = [
    { type: 'address', original: '台北市信義區松仁路100號' },
    { type: 'address', original: '松仁路100號' }
  ];
  const registry = new Map([
    ['address 台北市信義區松仁路100號', '[地址-01]'],
    ['address 松仁路100號', '[地址-02]']
  ]);
  const { redactedText } = redact('地址：台北市信義區松仁路100號', items, registry);
  assert.equal(redactedText, '地址：[地址-01]');
});

test('whitespace-normalized detections still redact the spaced original', () => {
  const items = [{ type: 'address', original: '台北市信義區松仁路100號' }];
  const registry = new Map([['address 台北市信義區松仁路100號', '[地址-01]']]);
  const { redactedText, entries } = redact('地址：台北市信義區松仁路 100 號，請寄送。', items, registry);
  assert.equal(redactedText, '地址：[地址-01]，請寄送。');
  // restore() must bring back the document's actual spelling (with spaces)
  const { restoredText } = restore(redactedText, entries);
  assert.equal(restoredText, '地址：台北市信義區松仁路 100 號，請寄送。');
});

test('restore tolerates LLM-inserted spaces inside placeholders', () => {
  const entries = [{ original: '陳志明', placeholder: 'A君', type: 'name' }];
  const { restoredText, restoredCount } = restore('請通知 A 君回覆。', entries);
  assert.equal(restoredText, '請通知 陳志明回覆。');
  assert.equal(restoredCount, 1);
});

test('mangled placeholders are reported, not silently shipped', () => {
  const leftovers = findLeftoverPlaceholders('聯絡 [電話-99]，並通知 C君。');
  assert.deepEqual(leftovers.sort(), ['C君', '[電話-99]'].sort());
});
