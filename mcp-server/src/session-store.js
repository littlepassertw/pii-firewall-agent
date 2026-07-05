// session-store.js — persists the placeholder↔original mapping per session.
// This file is the ONLY place original PII lives after redaction, and it
// never leaves this machine: .sessions/ is gitignored and files are written
// with owner-only permissions (0600). Storing on disk (vs in memory) also
// survives `adk web` reloads, which re-spawn the MCP server process.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SESSION_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.sessions');

export function createSession({ sourceFile, mode, entries }) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  const sessionId = crypto.randomUUID();
  const record = {
    sessionId,
    createdAt: new Date().toISOString(),
    sourceFile,
    mode,
    entries // [{ original, placeholder, type }]
  };
  fs.writeFileSync(sessionFile(sessionId), JSON.stringify(record, null, 2), { mode: 0o600 });
  return sessionId;
}

export function loadSession(sessionId) {
  // Validate before touching the filesystem — the id comes from the LLM.
  if (!/^[0-9a-f-]{36}$/i.test(String(sessionId))) {
    throw new Error(`Invalid session id: ${sessionId}`);
  }
  const file = sessionFile(sessionId);
  if (!fs.existsSync(file)) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sessionFile(sessionId) {
  return path.join(SESSION_DIR, `${sessionId}.json`);
}
