// prefetch-model.js — downloads the NER model (~100MB) into .model-cache/
// ahead of time so the first real detection run doesn't stall.
// Usage: npm run prefetch-model
import { getNerDetector } from '../src/ner-node.js';

console.error('Prefetching NER model (Xenova/bert-base-chinese-ner)…');
const ner = await getNerDetector();
if (!ner) {
  console.error('NER unavailable (PII_FIREWALL_NER=off or no usable runtime).');
  process.exit(1);
}
const rows = await ner('王小明在台積電上班。');
console.error('NER ready. Sanity check:', JSON.stringify(rows));
