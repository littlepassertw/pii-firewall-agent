// smoke.js — CLI smoke test for the local pipeline; no network, no API key.
// Usage: node scripts/smoke.js ../samples/resume_01.txt
// Prints the detection table, the redacted text, and a round-trip check.

import fs from 'node:fs';
import { detect } from '../src/detector.js';
import { redact, restore } from '../src/redactor.js';
import { textPiiTypeLabel } from '../src/lib/text-pii.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/smoke.js <text file>');
  process.exit(1);
}

const text = fs.readFileSync(file, 'utf8');
const { items, registry, mode, engine } = await detect(text);
const { redactedText, entries } = redact(text, items, registry);

console.log(`engine: ${JSON.stringify(engine)}  label mode: ${mode}`);
console.log('--- detections -------------------------------------------');
for (const entry of entries) {
  console.log(`${textPiiTypeLabel(entry.type).padEnd(6, '　')} ${entry.original} → ${entry.placeholder}`);
}
console.log('--- redacted text ----------------------------------------');
console.log(redactedText);

const { restoredText, restoredCount } = restore(redactedText, entries);
console.log('--- round-trip -------------------------------------------');
console.log(`restored ${restoredCount} placeholder occurrences; text identical: ${restoredText === text}`);
if (restoredText !== text) {
  process.exitCode = 1;
}
