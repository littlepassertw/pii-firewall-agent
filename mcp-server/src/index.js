// index.js — MCP server entry point (stdio transport).
// Exposes 4 tools that together form a privacy firewall between local HR
// documents and cloud LLM agents. stdio rule: stdout carries JSON-RPC only,
// so ALL logging in this codebase goes to stderr (console.error).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ingestAndRedact, getRedactionSummary, scanTextForPii, restoreAndExport } from './tools.js';
import { loadLexicons } from './detector.js';

const server = new McpServer({ name: 'pii-firewall', version: '1.0.0' });

function wrap(name, handler) {
  return async (args) => {
    try {
      return await handler(args);
    } catch (err) {
      console.error(`[pii-firewall] ${name} failed:`, err.message);
      return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
    }
  };
}

server.registerTool(
  'ingest_and_redact',
  {
    title: 'Ingest and redact a local document',
    description:
      'Read a local text file, detect Taiwanese PII (names, national IDs, tax IDs, phones, emails, addresses, salaries, …) using fully local rules/lexicons/NER, and return the REDACTED text plus a session_id. The original file content never appears in the response — placeholders like A君 or [ID-01] replace every detected value. Use the returned redacted_text for all downstream reasoning.',
    inputSchema: {
      file_path: z.string().describe('Absolute or relative path to a local .txt file to process')
    }
  },
  wrap('ingest_and_redact', ingestAndRedact)
);

server.registerTool(
  'get_redaction_summary',
  {
    title: 'Get placeholder inventory for a session',
    description:
      'Return the list of placeholders (and their PII types) created for a redaction session. Contains NO original values. Use it to verify that placeholders in generated text match the session inventory.',
    inputSchema: {
      session_id: z.string().describe('Session id returned by ingest_and_redact')
    }
  },
  wrap('get_redaction_summary', getRedactionSummary)
);

server.registerTool(
  'scan_text_for_pii',
  {
    title: 'Scan text for PII leaks',
    description:
      'Run the local PII detector over a piece of text (e.g. LLM-generated output) and report whether it is clean. Returns only PII types and counts — never the matched values. Use this to audit generated content before it is approved.',
    inputSchema: {
      text: z.string().describe('Text to scan (typically the draft produced by a writer agent)')
    }
  },
  wrap('scan_text_for_pii', scanTextForPii)
);

server.registerTool(
  'restore_and_export',
  {
    title: 'Restore placeholders and export locally',
    description:
      'Replace placeholders in the given text with the original values from the session mapping, then write the result to the local output/ directory. Returns only the output file path — the restored content itself is never sent back, so real data stays on this machine.',
    inputSchema: {
      session_id: z.string().describe('Session id returned by ingest_and_redact'),
      text: z.string().describe('Placeholder-bearing text to restore (e.g. the approved draft)'),
      output_filename: z.string().describe('File name for the restored document, e.g. email_draft.txt')
    }
  },
  wrap('restore_and_export', restoreAndExport)
);

loadLexicons(); // warm the lexicons at startup so first tool call is fast
await server.connect(new StdioServerTransport());
console.error('[pii-firewall] MCP server ready (stdio)');
