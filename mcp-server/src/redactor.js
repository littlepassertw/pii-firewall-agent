// redactor.js — applies the placeholder registry to produce redacted text,
// and restores placeholders back to original values on the way out.
// Redaction and restoration both happen only inside this local process.

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(value) {
  return String(value).replace(REGEX_SPECIALS, '\\$&');
}

// Replace originals with placeholders. Longer originals are replaced first so
// that "台北市信義區松仁路100號" wins over a shorter contained match, and a
// person's full name wins over a surname the NER also emitted.
//
// Detected values are sometimes whitespace-normalized ("松仁路100號") while
// the document spells them with spaces ("松仁路 100 號"). An exact replace
// would silently leave the original in the output — a redaction failure —
// so when the exact form is absent we fall back to a whitespace-tolerant
// match and store the actually-matched span for faithful restoration.
export function redact(text, items, registry) {
  const entries = items
    .map((item) => ({
      original: item.original,
      placeholder: registry.get(`${item.type} ${item.original}`),
      type: item.type
    }))
    .filter((e) => e.placeholder)
    .sort((a, b) => b.original.length - a.original.length);

  let out = String(text);
  const applied = [];
  for (const entry of entries) {
    if (out.includes(entry.original)) {
      out = out.split(entry.original).join(entry.placeholder);
      applied.push(entry);
      continue;
    }
    const lenient = new RegExp(
      entry.original.replace(/[\s　]+/g, '').split('').map(escapeRegex).join('[\\s　]?'),
      'g'
    );
    let matchedSpan = null;
    out = out.replace(lenient, (span) => {
      matchedSpan ??= span; // remember the document's actual spelling for restore()
      return entry.placeholder;
    });
    if (matchedSpan) applied.push({ ...entry, original: matchedSpan });
  }
  return { redactedText: out, entries: applied };
}

// Restore placeholders to original values. LLMs occasionally insert spaces
// inside a placeholder ("A君" → "A 君"), so matching tolerates optional
// whitespace between the placeholder's characters. Longer placeholders are
// restored first for the same containment reason as redact().
export function restore(text, entries) {
  let out = String(text);
  let restoredCount = 0;
  const sorted = [...entries].sort((a, b) => b.placeholder.length - a.placeholder.length);
  for (const entry of sorted) {
    const lenient = new RegExp(entry.placeholder.split('').map(escapeRegex).join('[\\s　]?'), 'g');
    out = out.replace(lenient, () => {
      restoredCount += 1;
      return entry.original;
    });
  }
  return { restoredText: out, restoredCount, unrestored: findLeftoverPlaceholders(out) };
}

// After restoration, anything that still looks like one of our placeholder
// shapes means the LLM altered a placeholder beyond recognition — surfaced
// to the caller instead of silently shipping a broken document.
const LEFTOVER_PATTERNS = [
  /\[(?:電話|Email|ID|統編|日期|地址|金額|帳號)-\d+\]/g,
  /(?:人員|機構|部門|學校|專案)-\d{3}/g,
  /[A-Z]{1,2}(?:君|公司|部門|學校|專案)/g
];

export function findLeftoverPlaceholders(text) {
  const leftovers = new Set();
  for (const re of LEFTOVER_PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) leftovers.add(match[0]);
  }
  return Array.from(leftovers);
}
