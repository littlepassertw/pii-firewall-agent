// tools.js — MCP tool handlers for the PII firewall.
//
// SECURITY DESIGN — the "architectural isolation" this project is built on:
// every tool response passes through sanitizeForCloud(), a whitelist
// projection. Original PII values are never part of any response schema, so
// isolation is enforced by program structure, not by prompt instructions.
// The mapping placeholder↔original lives only in .sessions/ on this machine.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect } from './detector.js';
import { redact, restore } from './redactor.js';
import { createSession, loadSession } from './session-store.js';
import { textPiiTypeLabel } from './lib/text-pii.js';

const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'output');

// The single exit point for data leaving this process toward the cloud LLM.
// Anything not explicitly whitelisted here does not exist for the agent.
// The audit log on stderr shows exactly what the cloud is allowed to see —
// demo material and a debugging aid at once.
function sanitizeForCloud(toolName, payload) {
  console.error(`[audit] ${toolName} → cloud payload: ${JSON.stringify(payload).slice(0, 400)}…`);
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

// ingest_and_redact(file_path) — reads the file INSIDE this process (the LLM
// only ever supplied a path string), detects PII, stores the mapping locally,
// and returns redacted text + type/label statistics. No original values.
export async function ingestAndRedact({ file_path }) {
  const resolved = path.resolve(file_path.startsWith('~') ? file_path.replace('~', process.env.HOME) : file_path);
  const text = fs.readFileSync(resolved, 'utf8');

  const { items, registry, mode, engine } = await detect(text);
  const { redactedText, entries } = redact(text, items, registry);

  const sessionId = createSession({ sourceFile: resolved, mode, entries });

  const stats = entries.map((e) => ({
    type: e.type,
    type_label: textPiiTypeLabel(e.type),
    placeholder: e.placeholder
  }));

  return sanitizeForCloud('ingest_and_redact', {
    session_id: sessionId,
    redacted_text: redactedText,
    redaction_count: entries.length,
    stats,
    engine
  });
}

// get_redaction_summary(session_id) — placeholder inventory for the auditor.
// Deliberately reads the session file and projects AWAY the originals.
export async function getRedactionSummary({ session_id }) {
  const session = loadSession(session_id);
  return sanitizeForCloud('get_redaction_summary', {
    session_id,
    source_file: path.basename(session.sourceFile),
    label_mode: session.mode,
    total: session.entries.length,
    placeholders: session.entries.map((e) => ({ placeholder: e.placeholder, type: e.type }))
  });
}

// Our own placeholder shapes (A君, B公司, [電話-01], 人員-001…). The scanner
// must not flag these as PII — they ARE the redaction — or the auditor gets
// stuck in an endless reject/rewrite loop over false positives.
const PLACEHOLDER_SHAPES = [
  /^\[(?:電話|Email|ID|統編|日期|地址|金額|帳號)-\d+\]$/,
  /^(?:人員|機構|部門|學校|專案)-\d{3}$/,
  /^[A-Z]{1,2}(?:君|公司|部門|學校|專案)$/
];

const isPlaceholder = (value) => PLACEHOLDER_SHAPES.some((re) => re.test(value));

// scan_text_for_pii(text) — re-runs local detection on LLM-generated text so
// the auditor can verify nothing leaked. Returns only types and counts,
// never the matched values (returning them would itself be a leak).
export async function scanTextForPii({ text }) {
  const { items } = await detect(text);
  const byType = new Map();
  for (const item of items) {
    if (isPlaceholder(item.original)) continue;
    byType.set(item.type, (byType.get(item.type) || 0) + 1);
  }
  const findings = Array.from(byType, ([type, count]) => ({
    type,
    type_label: textPiiTypeLabel(type),
    count
  }));
  return sanitizeForCloud('scan_text_for_pii', { clean: findings.length === 0, findings });
}

// restore_and_export(session_id, text, output_filename) — re-identification.
// The restored document is written to output/ and only the PATH is returned:
// the closing half of the loop also never routes real data through the cloud.
export async function restoreAndExport({ session_id, text, output_filename }) {
  const session = loadSession(session_id);
  const { restoredText, restoredCount, unrestored } = restore(text, session.entries);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const safeName = path.basename(output_filename || 'restored.txt');
  const outputPath = path.join(OUTPUT_DIR, safeName);
  fs.writeFileSync(outputPath, restoredText, { mode: 0o600 });

  return sanitizeForCloud('restore_and_export', {
    output_path: outputPath,
    restored_count: restoredCount,
    unrestored_placeholders: unrestored
  });
}
