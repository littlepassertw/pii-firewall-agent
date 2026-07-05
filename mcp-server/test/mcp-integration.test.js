// mcp-integration.test.js — spawns the real MCP server over stdio and drives
// it with the official SDK client. The core assertion turns this project's
// security claim into an executable test: NO tool response may contain any
// original PII string from the sample documents.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(ROOT, '..', 'samples', 'resume_01.txt');

// Original PII planted in samples/resume_01.txt — none of these strings may
// ever appear in a tool response.
const FORBIDDEN = [
  '林承翰', 'A123456789', '0912-345-678', 'chenghan.lin@example.com',
  '台北市信義區松仁路', '10001507', '65,000'
];

test('end-to-end MCP session never leaks original PII', async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, 'src', 'index.js')],
    env: { ...process.env, PII_FIREWALL_NER: 'off' }
  });
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  await client.connect(transport);
  t.after(() => client.close());

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    ['get_redaction_summary', 'ingest_and_redact', 'restore_and_export', 'scan_text_for_pii']
  );

  const assertNoLeak = (result, label) => {
    const raw = JSON.stringify(result);
    for (const value of FORBIDDEN) {
      assert.ok(!raw.includes(value), `${label} leaked original PII: ${value}`);
    }
  };

  // 1. ingest: response carries redacted text + session id, no originals
  const ingest = await client.callTool({ name: 'ingest_and_redact', arguments: { file_path: SAMPLE } });
  assertNoLeak(ingest, 'ingest_and_redact');
  const ingestPayload = JSON.parse(ingest.content[0].text);
  assert.ok(ingestPayload.session_id);
  assert.ok(ingestPayload.redacted_text.includes('A君'));

  // 2. summary: placeholder inventory only
  const summary = await client.callTool({
    name: 'get_redaction_summary',
    arguments: { session_id: ingestPayload.session_id }
  });
  assertNoLeak(summary, 'get_redaction_summary');

  // 3. scan: dirty text is flagged, but the response reports types only
  const scan = await client.callTool({
    name: 'scan_text_for_pii',
    arguments: { text: '請聯絡 0912-345-678 洽詢。' }
  });
  assertNoLeak(scan, 'scan_text_for_pii');
  assert.equal(JSON.parse(scan.content[0].text).clean, false);

  const cleanScan = await client.callTool({
    name: 'scan_text_for_pii',
    arguments: { text: '候選人 A君 具備十年半導體製程經驗，推薦進入二面。' }
  });
  assert.equal(JSON.parse(cleanScan.content[0].text).clean, true);

  // 4. restore: response returns a path, not the restored content
  const draft = `致用人主管：推薦候選人 A君（聯絡方式 [電話-01]）參加複試。`;
  const restored = await client.callTool({
    name: 'restore_and_export',
    arguments: { session_id: ingestPayload.session_id, text: draft, output_filename: 'test_draft.txt' }
  });
  assertNoLeak(restored, 'restore_and_export');
  const restoredPayload = JSON.parse(restored.content[0].text);
  assert.ok(restoredPayload.output_path.endsWith('test_draft.txt'));
  assert.ok(restoredPayload.restored_count >= 2);

  // The restored file on disk DOES contain the real values — that's the point.
  const fs = await import('node:fs');
  const written = fs.readFileSync(restoredPayload.output_path, 'utf8');
  assert.ok(written.includes('林承翰'));
  assert.ok(written.includes('0912-345-678'));
  fs.unlinkSync(restoredPayload.output_path);
});
