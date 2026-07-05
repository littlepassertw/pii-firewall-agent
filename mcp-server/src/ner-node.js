// ner-node.js — local Chinese NER for Node, ported from the browser build.
// Model: Xenova/bert-base-chinese-ner (ONNX conversion of CKIP Lab's
// bert-base-chinese-ner, ~100MB quantized). Inference runs entirely on this
// machine via transformers.js; the model is downloaded once into
// .model-cache/ and reused offline afterwards.
//
// Loading strategy (each step degrades gracefully):
//   1. @huggingface/transformers (current official package, onnxruntime-node)
//   2. @xenova/transformers 2.x  (legacy package the browser build verified
//      with this exact model; option name differs: quantized vs dtype)
//   3. null → detector runs rule/keyword/lexicon layers only.
// Set PII_FIREWALL_NER=off to skip NER entirely (faster startup for demos).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL_ID = 'Xenova/bert-base-chinese-ner';
const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.model-cache');

// CKIP NER emits OntoNotes 18 classes; we only keep the ones that map to our
// redaction fields. DATE/CARDINAL etc. are left to the rule engine, which
// avoids treating "三個月" or "第二名" as PII.
const NER_TAKE_LABELS = new Set(['PERSON', 'ORG']);
const NER_MIN_SCORE = 0.5;
const NER_MAX_UNIT = 400; // BERT limit is 512 tokens; Chinese ≈ 1 char/token, keep margin

let pipePromise; // memoized across calls; undefined = not tried, null = unavailable

async function loadPipeline() {
  try {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = CACHE_DIR;
    return await pipeline('token-classification', MODEL_ID, { dtype: 'q8' });
  } catch (err) {
    console.error('[pii-firewall] @huggingface/transformers unavailable, trying legacy package:', err.message);
  }
  try {
    const { pipeline, env } = await import('@xenova/transformers');
    env.cacheDir = CACHE_DIR;
    return await pipeline('token-classification', MODEL_ID, { quantized: true });
  } catch (err) {
    console.error('[pii-firewall] NER disabled (no usable transformers runtime):', err.message);
    return null;
  }
}

// Returns an async detector function compatible with detectTextPii's `ner`
// dependency, or null when NER is switched off / unavailable.
export async function getNerDetector() {
  if (String(process.env.PII_FIREWALL_NER || 'on').toLowerCase() === 'off') return null;
  pipePromise ??= loadPipeline();
  const pipe = await pipePromise;
  if (!pipe) return null;
  return async (text) => runNer(pipe, text);
}

async function runNer(pipe, text) {
  const seen = new Set();
  const out = [];
  for (const unit of nerUnits(text)) {
    let tokens;
    try {
      tokens = await pipe(unit);
    } catch (err) {
      console.error('[pii-firewall] NER inference failed on one unit, skipping:', err.message);
      continue;
    }
    for (const entity of aggregateNerTokens(tokens)) {
      const row = nerEntityToPii(entity);
      if (!row) continue;
      const key = `${row.type} ${row.original}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

// ── Pure helpers below are ported verbatim from the browser build (ner.js);
// they encode hard-won tuning and must not be "simplified". ────────────────

// Token aggregation: the CKIP model emits BIOES per-token tags (Chinese is
// mostly one char per token). B begins, I continues, E ends, S is a
// single-char entity; merge consecutive same-class tokens into one string.
// transformers.js returns no char offsets — the caller re-locates entities
// with indexOf, which works because Chinese has no spaces.
export function aggregateNerTokens(tokens) {
  const entities = [];
  let current = null;
  const flush = () => {
    if (current) entities.push(current);
    current = null;
  };
  for (const token of tokens) {
    const match = /^([BIES])-(.+)$/.exec(token.entity || '');
    if (!match || token.score < NER_MIN_SCORE) {
      flush();
      continue;
    }
    const [, tag, label] = match;
    let word = String(token.word || '');
    const isPiece = word.startsWith('##');
    if (isPiece) word = word.slice(2);
    // A new entity starts (B/S), the class changed, or the token index is not
    // contiguous (a low-score/O token sat in between) → close the previous one.
    const broken = !current
      || current.label !== label
      || ((tag === 'B' || tag === 'S') && !isPiece)
      || (current.lastIndex >= 0 && token.index !== current.lastIndex + 1);
    if (broken) {
      flush();
      current = { label, word: '', lastIndex: -1 };
    }
    // Re-insert spaces between ASCII tokens (English names split into pieces).
    if (current.word && !isPiece && /[A-Za-z0-9]$/.test(current.word) && /^[A-Za-z0-9]/.test(word)) {
      current.word += ' ';
    }
    current.word += word;
    current.lastIndex = token.index;
    if (tag === 'E' || tag === 'S') flush(); // explicit entity end
  }
  flush();
  return entities;
}

// ORG sub-classification: CKIP's ORG does not distinguish company/school/
// department; classify by name suffix heuristics, defaulting to company
// (human review is the final safety net).
export function classifyOrg(value) {
  // Containment (not suffix) match: "國立台灣大學資訊工程學系" is still a school.
  if (/大學|學院|高中|高職|國中|國小|中學|小學|學校/.test(value)) return 'school';
  if (value.length <= 8 && /(部|處|課|組|中心|室)$/.test(value)) return 'department';
  return 'company';
}

export function nerEntityToPii(entity) {
  if (!NER_TAKE_LABELS.has(entity.label)) return null;
  // Strip list numbering and stray punctuation swept into the entity ("1.亞力電機…").
  const value = entity.word.trim().replace(/^[\d.、()（）:：\s]+/, '').replace(/[、()（）:：\s]+$/, '');
  if (value.length < 2 || value.length > 30) return null; // 1-char names are mostly noise; overlong = bad merge
  if (!/[㐀-鿿A-Za-z]/.test(value)) return null; // digits/symbols only (benchmark caught "67" as a person)
  const type = entity.label === 'PERSON' ? 'name' : classifyOrg(value);
  return { type, original: value };
}

// Chunking: split per line (the natural semantic boundary of tables and
// documents); overlong lines split again by sentence. Never merge multiple
// lines into a fixed-size window — BERT attention is global, and unrelated
// preamble (table headers, boilerplate) poisons entity predictions for the
// whole chunk (measured: a sentence scoring 1.00 alone dropped below 0.5
// with 120 chars of header text prepended). Line-level inputs also cut
// attention cost dramatically (same document: 358s → 29s).
export function nerUnits(text) {
  const units = [];
  for (const line of String(text).split(/\n+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.length <= NER_MAX_UNIT) {
      units.push(trimmed);
      continue;
    }
    let buf = '';
    for (const seg of trimmed.split(/(?<=[。！？；])/)) {
      if (buf && buf.length + seg.length > NER_MAX_UNIT) {
        units.push(buf);
        buf = '';
      }
      buf += seg;
    }
    if (buf.trim()) units.push(buf);
  }
  return units;
}
