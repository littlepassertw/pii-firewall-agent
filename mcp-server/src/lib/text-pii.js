// text-pii.js — free-text PII detection + label registry (referential integrity).
// Ported from the doc_redaction browser extension to plain Node.js ESM.
// All detection layers below run fully offline on the local machine:
//   1. custom keywords (exact match)   2. rule engine (regex + checksums)
//   3. field-label keywords            4. document patterns (label-less values)
//   5. lexicons (Taiwan gov agencies / vendors / schools)
//   6. optional NER (injected async function; may be null)
// The original build also had an optional "ask another LLM" layer — it was
// deliberately removed here: this project's core claim is that raw PII is
// never sent to ANY model, so detection must be 100% local.

import { FIELD_DEFINITIONS } from './field-definitions.js';

export const TEXT_PII_TYPES = [
  { id: 'name',       label: '姓名',     semantic: true,  letterFormat: (s) => `${s}君`,   numericFormat: (n) => `人員-${n}` },
  { id: 'company',    label: '公司名稱', semantic: true,  letterFormat: (s) => `${s}公司`, numericFormat: (n) => `機構-${n}` },
  { id: 'department', label: '部門名稱', semantic: true,  letterFormat: (s) => `${s}部門`, numericFormat: (n) => `部門-${n}` },
  { id: 'school',     label: '學校',     semantic: true,  letterFormat: (s) => `${s}學校`, numericFormat: (n) => `學校-${n}` },
  { id: 'phone',      label: '電話',     semantic: false, numericFormat: (n) => `[電話-${n}]` },
  { id: 'email',      label: 'Email',    semantic: false, numericFormat: (n) => `[Email-${n}]` },
  { id: 'id_number',  label: '身分證號', semantic: false, numericFormat: (n) => `[ID-${n}]` },
  { id: 'tax_id',     label: '統一編號', semantic: false, numericFormat: (n) => `[統編-${n}]` },
  { id: 'date',       label: '日期',     semantic: false, numericFormat: (n) => `[日期-${n}]` },
  { id: 'address',    label: '地址',     semantic: false, numericFormat: (n) => `[地址-${n}]` },
  { id: 'project',    label: '專案名稱', semantic: true,  letterFormat: (s) => `${s}專案`, numericFormat: (n) => `專案-${n}` },
  { id: 'amount',     label: '金額',     semantic: false, numericFormat: (n) => `[金額-${n}]` },
  { id: 'account',    label: '帳號資訊', semantic: false, numericFormat: (n) => `[帳號-${n}]` }
];

// Taiwan Unified Business Number (統一編號) checksum: weights 1,2,1,2,1,2,4,1,
// sum tens digit + units digit of each product; valid when sum % 10 == 0
// (or, when the 7th digit is 7, (sum+1) % 10 == 0). Filters out 8-digit
// strings that merely look like a tax id (e.g. landline prefixes).
export function isValidTaxId(value) {
  const digits = value.split('').map(Number);
  const weights = [1, 2, 1, 2, 1, 2, 4, 1];
  let sum = 0;
  for (let i = 0; i < 8; i += 1) {
    const product = digits[i] * weights[i];
    sum += Math.floor(product / 10) + (product % 10);
  }
  return sum % 10 === 0 || (digits[6] === 7 && (sum + 1) % 10 === 0);
}

const TEXT_PII_REGEX = [
  { type: 'email',     re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // Taiwan National ID [12] + new-style ARC unified number [89]
  { type: 'id_number', re: /[A-Z][1289]\d{8}/g },
  { type: 'phone',     re: /09\d{2}[-‐–—﹣－\s]?\d{3}[-‐–—﹣－\s]?\d{3}|\(0\d{1,2}\)\s?\d{3,4}[-‐–—﹣－]?\d{4}|\(0\d{1,2}\)\s?\d{6,8}|0\d{1,2}[-‐–—﹣－]\d{6,8}/g },
  { type: 'tax_id',    re: /(?<!\d)\d{8}(?!\d)/g, validate: isValidTaxId },
  // Only full year-month-day counts as a date: month 1-12, day 1-31, and no
  // digit may follow the day — avoids slicing "2010/7-2014/3" ranges into
  // false positives like "2010/7-20". Supports ROC-era dates (民國).
  { type: 'date',      re: /(?:民國\s?)?\d{2,4}\s?年\s?\d{1,2}\s?月\s?\d{1,2}\s?日|(?:19|20)\d{2}[/\-.](?:1[0-2]|0?[1-9])[/\-.](?:3[01]|[12]\d|0?[1-9])(?!\d)/g },
  {
    type: 'address',
    // Taiwanese street address: city/county prefix, road segment, house number
    // with optional dash / 之 suffixes (19-11號, 5號之3) and optional floor.
    re: /(?:台北|臺北|新北|桃園|台中|臺中|台南|臺南|高雄|基隆|新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|台東|臺東|澎湖|金門|連江)(?:市|縣)[一-鿿A-Za-z0-9]{1,30}?(?:路|街|大道|巷)[一-鿿A-Za-z0-9之\-‐－]{0,15}?號(?:[一-鿿A-Za-z0-9之\-‐－]{0,8}樓)?(?:之\d{1,3})?/g
  }
];

// type id → settings.fields toggle mapping (types with no mapping are always on)
const TEXT_PII_SETTING_MAP = {
  name: 'name',
  phone: 'phone',
  email: 'email',
  id_number: 'id_number',
  tax_id: 'tax_id',
  address: 'address',
  date: 'birthday',
  company: 'company',
  project: 'project',
  amount: 'amount',
  account: 'account'
};

const FIELD_TO_TEXT_PII_TYPE = {
  birthday: 'date',
  id_number: 'id_number',
  tax_id: 'tax_id',
  name: 'name',
  phone: 'phone',
  email: 'email',
  address: 'address',
  company: 'company',
  project: 'project',
  amount: 'amount',
  account: 'account'
};

// Generic words that must not be treated as a field label on their own
// ("公司" alone appears in prose far too often to mean "company name:").
const FIELD_CONTEXT_KEYWORD_BLOCKLIST = {
  company: new Set(['公司']),
  project: new Set(['專案']),
  amount: new Set(['費用']),
  account: new Set(['帳號'])
};

export function textPiiTypeDef(type) {
  return TEXT_PII_TYPES.find((item) => item.id === type) || null;
}

export function isTextPiiTypeEnabled(type, settings) {
  const settingId = TEXT_PII_SETTING_MAP[type];
  if (!settingId) return true;
  return !!settings.fields.find((field) => field.id === settingId && field.enabled);
}

// Rule engine: fills Map<`type original`, {type, original, count}>
export function detectTextPiiByRule(text, settings, found = new Map()) {
  for (const { type, re, validate } of TEXT_PII_REGEX) {
    if (!isTextPiiTypeEnabled(type, settings)) continue;
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      if (validate && !validate(match[0])) continue;
      addTextPiiHit(found, type, match[0]);
    }
  }
  // Addresses written with spaces ("中山路 88 號") break the contiguous
  // address regex, so scan a de-spaced copy as well. The redactor matches
  // whitespace-tolerantly, so the normalized value still redacts the spaced
  // original. Only the address pattern gets this treatment — de-spacing
  // would create false joins for phone/id digit runs.
  if (isTextPiiTypeEnabled('address', settings)) {
    const despaced = String(text).replace(/[ \t　]+/g, '');
    const addressRule = TEXT_PII_REGEX.find((rule) => rule.type === 'address');
    addressRule.re.lastIndex = 0;
    let match;
    while ((match = addressRule.re.exec(despaced)) !== null) {
      if (!found.has(`address ${match[0]}`)) {
        found.set(`address ${match[0]}`, { type: 'address', original: match[0], count: 1 });
      }
    }
  }
  return found;
}

// Field-label keyword layer: documents commonly use "label: value" lines
// ("姓名：王小明"). For every enabled field, take the value to the right of
// a known label keyword so users don't have to mark those spans manually.
export function detectTextPiiByFieldKeywords(text, settings, found = new Map()) {
  // Split on pipe separators as well as newlines: roster-style exports put
  // several "label: value" fields on one line ("姓名：…｜月薪：…"), and the
  // label-position guard below would otherwise reject labels deep in a line.
  const lines = String(text || '')
    .split(/\r?\n/)
    .flatMap((line) => line.split(/[|｜]/))
    .map((line) => line.trim())
    .filter(Boolean);
  for (const def of FIELD_DEFINITIONS) {
    const type = FIELD_TO_TEXT_PII_TYPE[def.id];
    if (!type || !isTextPiiTypeEnabled(type, settings)) continue;
    const blocked = FIELD_CONTEXT_KEYWORD_BLOCKLIST[def.id] || new Set();
    const keywords = Array.from(new Set([def.label, ...(def.keywords || [])].map((v) => String(v || '').trim()).filter((v) => v && !blocked.has(v))))
      .sort((a, b) => b.length - a.length);
    for (const line of lines) {
      for (const keyword of keywords) {
        const value = extractValueAfterFieldKeyword(line, keyword, type);
        if (value) addTextPiiKeywordHit(found, type, value);
      }
    }
  }
  return found;
}

function extractValueAfterFieldKeyword(line, keyword, type) {
  const idx = String(line).indexOf(keyword);
  if (idx < 0) return '';
  const before = line.slice(0, idx).trim();
  if (before.length > 24) return ''; // keyword deep inside prose is not a field label
  const rawRest = line.slice(idx + keyword.length);
  if (!/^[\s:：=＝\-－—–]/.test(rawRest)) return '';
  let rest = rawRest.replace(/^[\s:：=＝\-－—–、，,；;\[\]【】「」『』]+/, '').trim();
  if (!rest) return '';

  const stop = rest.search(/[。；;\t]/);
  if (stop > 0) rest = rest.slice(0, stop).trim();
  rest = rest.replace(/^(為|是|係|為：|為:)/, '').trim();
  rest = rest.replace(/\s{2,}.+$/, '').trim();

  return normalizeKeywordDetectedValue(rest, type);
}

function normalizeKeywordDetectedValue(value, type) {
  let text = String(value || '').trim();
  if (!text) return '';
  if (type === 'phone') {
    const match = text.match(/09\d{2}[-‐–—﹣－\s]?\d{3}[-‐–—﹣－\s]?\d{3}|\(0\d{1,2}\)\s?\d{3,4}[-‐–—﹣－]?\d{4}|\(0\d{1,2}\)\s?\d{6,8}|0\d{1,2}[-‐–—﹣－]\d{6,8}/);
    return match ? match[0] : '';
  }
  if (type === 'email') {
    const match = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    return match ? match[0] : '';
  }
  if (type === 'id_number') {
    const match = text.match(/[A-Z][1289]\d{8}/);
    return match ? match[0] : '';
  }
  if (type === 'tax_id') {
    const match = text.match(/(?<!\d)\d{8}(?!\d)/);
    return match && isValidTaxId(match[0]) ? match[0] : '';
  }
  if (type === 'date') {
    const match = text.match(/(?:民國\s?)?\d{2,4}\s?年\s?\d{1,2}\s?月\s?\d{1,2}\s?日|(?:19|20)\d{2}[/\-.](?:1[0-2]|0?[1-9])[/\-.](?:3[01]|[12]\d|0?[1-9])(?!\d)/);
    return match ? match[0] : '';
  }
  if (type === 'amount') {
    const match = text.match(/(?:新台幣|臺幣|NT\$|\$)?\s?\d[\d,]*(?:\.\d+)?\s?(?:元|萬元|億元|NTD)?/i);
    return match ? match[0].trim() : '';
  }
  if (type === 'account') {
    const match = text.match(/[A-Za-z0-9][A-Za-z0-9._-]{2,31}/);
    return match ? match[0] : '';
  }
  text = text.replace(/[，,。；;：:|｜]+.*$/, '').trim();
  if (type === 'name') text = text.replace(/(先生|小姐|女士|君|代表人).*$/, '').trim();
  if (['name', 'company', 'project', 'address'].includes(type)) {
    text = text.replace(/\s+/g, '');
    if (text.length < 2 || text.length > 40) return '';
  }
  return text;
}

function addTextPiiKeywordHit(found, type, original) {
  const key = `${type} ${original}`;
  const existing = found.get(key);
  if (existing) {
    existing.keywordDetected = true;
    return existing;
  }
  const item = { type, original, count: 1, keywordDetected: true };
  found.set(key, item);
  return item;
}

// Label-less semantic layer: résumés and tables often list bare values —
// a name on its own line, "輔仁大學", "…股份有限公司" — with no "姓名：" label.
export function detectTextPiiByDocumentPatterns(text, settings, found = new Map()) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => normalizeSemanticLine(line))
    .filter(Boolean);

  const fullText = String(text || '');
  if (isTextPiiTypeEnabled('name', settings)) {
    for (const name of detectLikelyNames(lines)) addTextPiiPatternHit(found, 'name', name, fullText);
  }
  if (isTextPiiTypeEnabled('school', settings)) {
    for (const school of detectLikelySchools(lines)) addTextPiiPatternHit(found, 'school', school, fullText);
  }
  if (isTextPiiTypeEnabled('company', settings)) {
    for (const company of detectLikelyOrganizations(lines)) addTextPiiPatternHit(found, 'company', company, fullText);
  }
  if (isTextPiiTypeEnabled('department', settings)) {
    for (const dept of detectLikelyDepartments(lines)) addTextPiiPatternHit(found, 'department', dept, fullText);
  }
  return found;
}

function normalizeSemanticLine(line) {
  return String(line || '')
    .replace(/[　\s]+/g, '')
    .replace(/[|｜]/g, '丨')
    .replace(/[()（）]+$/g, '')
    .trim();
}

// Common résumé section words that look like 2-4 char names but never are.
const NON_NAME_WORDS = /履歷|自傳|工作|求職|希望|待遇|地址|電話|手機|信箱|交通|工具|學歷|學屆|經歷|運屆|能力|英文|台語|專長|部門|公司|醫院|大學|學院|高中|銀行|派遣|行政|助理|人資|人事|姓名|E-mail|email/i;

function detectLikelyNames(lines) {
  const names = [];
  for (const line of lines.slice(0, 16)) {
    if (/^[㐀-鿿]{2,4}$/.test(line) && !NON_NAME_WORDS.test(line)) {
      names.push(line);
      break; // the headline name at the top of a résumé is usually the only one needed
    }
  }
  return names;
}

function detectLikelySchools(lines) {
  const out = new Set();
  const re = /[㐀-鿿A-Za-z]{2,24}(?:大學|大学|學院|学院|科技大學|科技大学|高中|高職|專科|国中|國中)/g;
  for (const line of lines) {
    if (/附設?醫院|附計醫院|醫院|公司/.test(line)) continue;
    for (const match of line.matchAll(re)) {
      // Drop narrative lead-ins swept up by the greedy prefix
      // ("我畢業於輔仁大學" → "輔仁大學", "研究所階段於國立清華大學" → "國立清華大學").
      const value = trimSemanticEntity(match[0])
        .replace(/^[㐀-鿿]{0,10}?(?:畢業於|就讀於|任職於|服務於|於)(?=[㐀-鿿])/, '');
      if (value.length >= 3 && value.length <= 24) out.add(value);
    }
  }
  return Array.from(out);
}

function detectLikelyOrganizations(lines) {
  const out = new Set();
  const re = /[㐀-鿿A-Za-z0-9]{2,34}(?:股份有限公司|有限公司|醫院|银行|銀行|人力銀行|派遣|中心)/g;
  for (const line of lines) {
    for (const match of line.matchAll(re)) {
      // Same narrative lead-in problem as schools: "已取得明曜半導體股份有限公司"
      // must not keep the verb phrase as part of the company name.
      const value = trimSemanticEntity(match[0])
        .replace(/^[㐀-鿿]{0,10}?(?:已取得|已加入|取得|加入|轉職至|任職於|服務於|畢業於|就讀於|進入|於)(?=[㐀-鿿])/, '');
      if (value.length >= 3 && value.length <= 40 && !/^普通/.test(value)) out.add(value);
    }
  }
  return Array.from(out);
}

function detectLikelyDepartments(lines) {
  const out = new Set();
  // Capture only the department name itself (ending in 部/組/室/處/中心),
  // not the whole line segment — "聯絡窗口：人力資源部 王經理" should yield
  // "人力資源部", leaving the rest to the name/NER layers.
  const re = /(?:人力[㐀-鿿]{0,3}|人資|人事|行政|總務|財務|會計|資訊|法務|採購|業務|客服)[㐀-鿿]{0,6}?(?:部|組|室|處|中心)/g;
  for (const line of lines) {
    for (const match of line.matchAll(re)) {
      const value = match[0];
      if (value.length >= 2 && value.length <= 18) out.add(value);
    }
  }
  return Array.from(out);
}

function trimSemanticEntity(value) {
  return String(value || '')
    .replace(/^[^㐀-鿿A-Za-z0-9]+/, '')
    .replace(/[^㐀-鿿A-Za-z0-9()（）~\-]+.*$/, '')
    .trim();
}

function addTextPiiPatternHit(found, type, original, text) {
  const key = `${type} ${original}`;
  const existing = found.get(key);
  if (existing) {
    existing.patternDetected = true;
    return existing;
  }
  const item = { type, original, count: countOccurrences(text, original) || 1, patternDetected: true };
  found.set(key, item);
  return item;
}

// Custom keywords: exact match, highest priority; replacement is fixed.
export function detectCustomKeywords(text, settings, found = new Map()) {
  for (const item of settings.customKeywords || []) {
    const keyword = String(item.keyword || '').trim();
    if (!keyword) continue;
    let index = 0;
    let count = 0;
    while ((index = text.indexOf(keyword, index)) !== -1) {
      count += 1;
      index += keyword.length;
    }
    if (count) {
      const key = `custom ${keyword}`;
      const existing = found.get(key);
      if (existing) existing.count += count;
      else found.set(key, { type: 'custom', original: keyword, count, fixedReplacement: item.replacement || `[${keyword}]` });
    }
  }
  return found;
}

// Lexicon match: exact match against curated Taiwan lexicons
// (41k+ entries: government agencies, procurement vendors, schools).
export function detectTextPiiByLexicon(text, settings, lexicons = [], found = new Map()) {
  for (const lex of lexicons) {
    if (lex.enabled === false) continue;
    if (!isTextPiiTypeEnabled(lex.type, settings)) continue;
    for (const val of lex.values || []) {
      const keyword = String(val || '').trim();
      if (!keyword) continue;
      let index = 0;
      let count = 0;
      while ((index = text.indexOf(keyword, index)) !== -1) {
        count += 1;
        index += keyword.length;
      }
      if (count) {
        const key = `${lex.type} ${keyword}`;
        // First writer wins: skip if an earlier layer already found this value.
        if (!found.has(key)) {
          found.set(key, {
            type: lex.type,
            original: keyword,
            count,
            lexDetected: true
          });
        }
      }
    }
  }
  return found;
}

function addTextPiiHit(found, type, original) {
  const key = `${type} ${original}`;
  const existing = found.get(key);
  if (existing) {
    existing.count += 1;
    return existing;
  }
  const item = { type, original, count: 1 };
  found.set(key, item);
  return item;
}

export function countOccurrences(text, value) {
  if (!value) return 0;
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(value, index)) !== -1) {
    count += 1;
    index += value.length;
  }
  return count;
}

// Full detection pipeline: custom keywords + rules + field labels + document
// patterns + lexicons + optional NER, merged and de-duplicated.
// Dependencies are injected (no browser storage, no global probing):
//   deps.lexicons  — array of {name, type, values[], enabled}
//   deps.ner       — optional async (text, settings, onProgress) => [{type, original}]
//   deps.onProgress — optional progress callback (string)
export async function detectTextPii(text, settings, deps = {}) {
  const { lexicons = [], ner = null, onProgress } = deps;
  const found = new Map();
  detectCustomKeywords(text, settings, found);
  detectTextPiiByRule(text, settings, found);
  detectTextPiiByFieldKeywords(text, settings, found);
  detectTextPiiByDocumentPatterns(text, settings, found);
  detectTextPiiByLexicon(text, settings, lexicons, found);

  const semanticRows = [];
  if (typeof ner === 'function') {
    try {
      for (const row of await ner(text, settings, onProgress)) {
        semanticRows.push({ ...row, nerDetected: true });
      }
    } catch (err) {
      // NER is best-effort: rule/keyword/lexicon layers already ran, degrade silently.
      console.error('[pii-firewall] NER failed, falling back to rule/lexicon layers:', err?.message || err);
      onProgress?.('NER unavailable, continuing with rule-based detection.');
    }
  }
  for (const row of semanticRows) {
    const key = `${row.type} ${row.original}`;
    if (found.has(key)) continue;
    const count = countOccurrences(text, row.original);
    if (!count) continue;
    found.set(key, { type: row.type, original: row.original, count, nerDetected: true });
  }
  // Overlap de-dup: when a value is fully contained in a longer value of the
  // same type, keep only the longer one.
  const items = Array.from(found.values());
  return items.filter((item) => !items.some((other) =>
    other !== item && other.type === item.type && other.original !== item.original && other.original.includes(item.original)
  ));
}

// ── Label registry (referential integrity) ─────────────────────────────────
// The same original value (of the same type) always maps to the same label.
// Letter mode: A君, B君, … (AA after Z); numeric mode: 人員-001.
// When a document has more names than `labelThreshold`, all semantic types
// switch to numeric. Format-based types (phone, id…) are always numeric.

export function letterSeq(n) {
  let out = '';
  let value = n + 1;
  while (value > 0) {
    const mod = (value - 1) % 26;
    out = String.fromCharCode(65 + mod) + out;
    value = Math.floor((value - mod) / 26);
  }
  return out;
}

export function buildLabelRegistry(items, settings) {
  const threshold = Number(settings.labelThreshold) > 0 ? Number(settings.labelThreshold) : 10;
  const nameCount = items.filter((item) => item.type === 'name').length;
  const mode = nameCount > threshold ? 'numeric' : 'letter';
  const counters = {};
  const registry = new Map();
  for (const item of items) {
    const key = `${item.type} ${item.original}`;
    if (registry.has(key)) continue;
    if (item.type === 'custom') {
      registry.set(key, item.fixedReplacement || `[${item.original}]`);
      continue;
    }
    const def = textPiiTypeDef(item.type);
    if (!def) continue;
    counters[item.type] = (counters[item.type] || 0) + 1;
    const seq = counters[item.type];
    if (def.semantic && mode === 'letter') {
      registry.set(key, def.letterFormat(letterSeq(seq - 1)));
    } else if (def.semantic) {
      registry.set(key, def.numericFormat(String(seq).padStart(3, '0')));
    } else {
      registry.set(key, def.numericFormat(String(seq).padStart(2, '0')));
    }
  }
  return { registry, mode };
}

export function textPiiTypeLabel(type) {
  if (type === 'custom') return '自訂關鍵字';
  if (type === 'manual') return '手動加入';
  return textPiiTypeDef(type)?.label || type;
}
