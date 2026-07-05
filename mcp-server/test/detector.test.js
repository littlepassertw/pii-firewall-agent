// detector.test.js — unit tests for the local detection pipeline.
// Runs fully offline: no network, no API key, NER disabled.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.PII_FIREWALL_NER = 'off';

const { detect } = await import('../src/detector.js');
const { isValidTaxId, buildLabelRegistry } = await import('../src/lib/text-pii.js');

const SAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'samples');
const read = (name) => fs.readFileSync(path.join(SAMPLES, name), 'utf8');

test('tax id checksum accepts valid and rejects invalid numbers', () => {
  assert.equal(isValidTaxId('10001507'), true);   // generated valid sample
  assert.equal(isValidTaxId('10000274'), true);
  assert.equal(isValidTaxId('12345678'), false);  // fails checksum
  assert.equal(isValidTaxId('99999999'), false);
});

test('resume: rules + keywords + lexicon find the core PII set', async () => {
  const { items, mode } = await detect(read('resume_01.txt'));
  const byType = (type) => items.filter((i) => i.type === type).map((i) => i.original);

  assert.ok(byType('name').includes('林承翰'));
  assert.ok(byType('id_number').includes('A123456789'));
  assert.ok(byType('phone').includes('0912-345-678'));
  assert.ok(byType('email').includes('chenghan.lin@example.com'));
  assert.ok(byType('tax_id').includes('10001507'));
  assert.ok(byType('school').some((v) => v.includes('輔仁大學')));   // lexicon hit
  assert.ok(byType('company').some((v) => v.includes('宏遠精密')));  // pattern hit
  // Cross-type conflict resolution: a university must not also be a company.
  assert.ok(!byType('company').some((v) => v.includes('清華大學')));
  assert.equal(mode, 'letter'); // few names → letter labels (A君)
});

test('roster: >10 names switch the registry to numeric mode', async () => {
  const { items, mode, registry } = await detect(read('roster_01.txt'));
  const names = items.filter((i) => i.type === 'name');
  assert.ok(names.length >= 12, `expected 12+ names, got ${names.length}`);
  assert.equal(mode, 'numeric');
  assert.match(registry.get(`name ${names[0].original}`), /^人員-\d{3}$/);
  // Salaries in pipe-separated rows must be caught by the keyword layer.
  assert.ok(items.filter((i) => i.type === 'amount').length >= 12);
});

test('registry keeps referential integrity: same value → same label', () => {
  const items = [
    { type: 'name', original: '陳志明', count: 2 },
    { type: 'name', original: '陳志明', count: 1 }, // duplicate entry
    { type: 'name', original: '林美惠', count: 1 }
  ];
  const { registry } = buildLabelRegistry(items, { labelThreshold: 10, fields: [] });
  assert.equal(registry.get('name 陳志明'), 'A君');
  assert.equal(registry.get('name 林美惠'), 'B君');
  assert.equal(registry.size, 2);
});

test('inline spaced address is still detected (de-spaced rule scan)', async () => {
  const { items } = await detect(read('exit_interview_01.txt'));
  assert.ok(items.some((i) => i.type === 'address' && i.original.includes('中山路')));
});
