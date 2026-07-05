// detector.js — assembles the local detection pipeline.
// Loads the Taiwan lexicons once at startup and (optionally) the local NER
// model, then exposes a single detect() entry point used by the MCP tools.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectTextPii, buildLabelRegistry } from './lib/text-pii.js';
import { DEFAULT_SETTINGS } from './lib/field-definitions.js';
import { getNerDetector } from './ner-node.js';

const LEXICON_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lexicons');

let lexiconsCache = null;

// Lexicons are plain JSON: { name, type, values: string[] } — curated from
// Taiwanese open data (gov agencies, procurement vendors, school registry).
export function loadLexicons() {
  if (lexiconsCache) return lexiconsCache;
  lexiconsCache = [];
  for (const file of fs.readdirSync(LEXICON_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const lex = JSON.parse(fs.readFileSync(path.join(LEXICON_DIR, file), 'utf8'));
      if (Array.isArray(lex.values)) lexiconsCache.push(lex);
    } catch (err) {
      console.error(`[pii-firewall] skipping unreadable lexicon ${file}:`, err.message);
    }
  }
  console.error(`[pii-firewall] loaded ${lexiconsCache.length} lexicons, ${lexiconsCache.reduce((n, l) => n + l.values.length, 0)} entries`);
  return lexiconsCache;
}

// Runs the full local pipeline and builds the placeholder registry.
// Returns { items, registry, mode, engine } where `engine` reports which
// detection layers actually ran (surfaced to the agent for transparency).
export async function detect(text, settingsOverride = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...settingsOverride };
  const lexicons = loadLexicons();
  const ner = await getNerDetector(); // null when disabled or unavailable
  let items = await detectTextPii(text, settings, { lexicons, ner });
  // Cross-type conflict: universities appear in the gov-agency lexicon as
  // "company" while the pattern layer classifies them as "school". Prefer the
  // more specific school entry so the placeholder reads 學校, not 公司.
  const schoolValues = new Set(items.filter((i) => i.type === 'school').map((i) => i.original));
  items = items.filter((i) => !(i.type === 'company' && schoolValues.has(i.original)));
  const { registry, mode } = buildLabelRegistry(items, settings);
  return {
    items,
    registry,
    mode,
    engine: { rules: true, keywords: true, patterns: true, lexicon: lexicons.length > 0, ner: !!ner }
  };
}
