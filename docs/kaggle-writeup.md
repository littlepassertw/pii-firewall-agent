# PII Firewall Agent — Kaggle Writeup Draft

> Track: **Agents for Business** · ≤2,500 words · paste into the Kaggle Writeup editor.
> Attach: cover image, YouTube video link, GitHub repo link.

---

**Title:** PII Firewall Agent — Cloud AI for HR Documents That Never Sees Personal Data

**Subtitle:** A local MCP firewall lets multi-agent LLM pipelines summarize, draft and audit HR documents while every piece of personal data stays on the machine — de-identify → cloud reasoning → re-identify.

---

## The Problem

I work as an HR specialist at a Taiwanese technology company with several thousand employees. My daily inputs are the most sensitive documents a company owns: résumés with national ID numbers, salary rosters, exit-interview notes naming managers and grievances.

These documents are also exactly where LLM assistants would help most — summarize this résumé, draft a recommendation email, turn these interview notes into a report. But sending them to a cloud model is a compliance nonstarter. Taiwan's Personal Data Protection Act (and its cousins — GDPR, CCPA) makes "we pasted the employee roster into a chatbot" a reportable incident. The result in real HR departments today: either LLMs are banned, or people quietly paste and hope.

The insight behind this project: **the cloud model doesn't actually need the personal data to do the work.** To write "I recommend candidate X, who led a 5-person team at company Y," the model needs the structure and the story — not the real name, not the real ID. If we can swap PII for stable placeholders *before* text leaves the machine, and swap it back *after* the model is done, we get cloud-grade reasoning with local-grade privacy.

## Why Agents?

A single LLM call can't deliver this, because the guarantees come from an **orchestrated division of labor** between components that deliberately don't trust each other:

- A **local tool layer** must own file access, detection, redaction and restoration — and must be the only component that ever touches real data.
- A **cloud reasoning layer** must do the writing — and must be structurally incapable of seeing originals.
- A **verification step** must check the cloud's output *before* it's accepted, using the same local detector — closing the loop against leaks the writer might introduce.

That's a multi-agent system with a tool boundary, not a prompt. Agents also make the workflow conversational: the user asks for a summary, then a rewrite, then the restored final file — all in one session, with the mapping held safely outside the conversation.

## Solution Architecture

Two processes, one boundary:

**Local: the firewall (Node.js MCP server, stdio).** Four tools:

| Tool | Returns | Never returns |
|---|---|---|
| `ingest_and_redact(file_path)` | session_id, redacted text, type stats | original values |
| `get_redaction_summary(session_id)` | placeholder inventory | original values |
| `scan_text_for_pii(text)` | clean flag + PII types/counts | matched values |
| `restore_and_export(session_id, text, filename)` | local output path | restored content |

**Cloud: the reasoning layer (Google ADK, three agents).**

- `pii_firewall_coordinator` (root) — owns the workflow; tools: ingest + restore only.
- `hr_task_writer` — writes summaries/emails/reports from redacted text; **has no tools at all**.
- `compliance_auditor` — re-scans drafts with the local detector; tools: scan + summary only.

The coordinator ingests, delegates writing, routes the draft through the auditor, and only calls restore after approval. ADK's `tool_filter` enforces least privilege per agent. The model layer is provider-agnostic via LiteLLM (tested with Claude; one env var switches to Gemini).

**Detection is 100% local and Taiwan-tuned**, in four layers merged and de-duplicated: (1) a rule engine — regex plus *checksum validation* for Taiwan Unified Business Numbers and national-ID formats including new-style ARC numbers, ROC-era dates, Taiwanese address grammar; (2) field-label keyword extraction for `姓名：…`-style documents and pipe-separated roster rows; (3) label-less document patterns (a bare name atop a résumé, `…股份有限公司`); (4) curated lexicons — 41k+ entries of government agencies, procurement vendors and schools from Taiwanese open data. An optional fifth layer runs CKIP Chinese BERT NER (ONNX, ~100MB) fully in-process to catch in-sentence names, degrading gracefully when unavailable.

Placeholders preserve **referential integrity** — the same person is `A君` throughout, so the model can still reason about who did what. Rosters with more than ten people switch to numeric labels (`人員-001`).

## Security by Architecture, Not by Prompt

The distinctive claim of this project: privacy is enforced by program structure, and the enforcement is *testable*.

1. **Path-in, path-out.** The agent receives a file path, never file content; file reads happen inside the MCP server process. Restoration writes to a local `output/` directory and returns only the path — real data never transits the cloud in either direction.
2. **A single whitelist exit.** Every tool response passes through one function, `sanitizeForCloud()`. Original values are simply not part of any response schema. There is no code path from the mapping to the model.
3. **Local-only mapping.** The placeholder↔original table lives in `.sessions/<uuid>.json`, mode 0600, gitignored. It survives server restarts (ADK's dev server re-spawns MCP processes on reload) and is humanly inspectable — in the demo you can open it and see the only place real data ever lived.
4. **Least-privilege agents.** The writer cannot ingest or restore; the auditor cannot restore; nobody but the local server touches originals.
5. **Refuse-pasted-content policy.** If a user pastes raw document text into chat, the coordinator refuses and asks for a path — the one leak the architecture can't prevent is turned into a taught behavior.
6. **The claim is a test.** The integration suite spawns the real MCP server, drives all four tools, and asserts that no response contains any planted PII string from the sample documents. The security property fails CI if it regresses.
7. **Auditability.** Every tool call logs its cloud-bound payload to stderr; you can watch, byte for byte, everything the model was allowed to see.

One honest bug from development: the auditor initially rejected clean drafts because the scanner flagged our own placeholder `A部門` as a department name — a false-positive loop between two agents. The fix (placeholder shapes are exempt from scanning) is itself a small lesson in multi-agent design: verifiers need to know what the sanitizer's output looks like.

## The Build

The detection engine wasn't written for this hackathon — it's ported from a browser-based HR de-identification extension I built earlier, with recall tuned on real (local-only) documents. Its core was deliberately DOM-free, which made the port to Node ESM mostly mechanical: add exports, inject dependencies, and *delete* the optional "ask another LLM to find PII" layer, which would have violated the project's core claim.

The stack: `@modelcontextprotocol/sdk` v1 (stdio transport) for the server; Google ADK 2.3 with `McpToolset` + `StdioConnectionParams` for the agents; `@huggingface/transformers` for in-process ONNX NER; `node:test` for the suite (13 tests, offline, no API key needed). Development itself was agentic — Claude Code did the porting and wiring, Antigravity was used for [demo shown in video], and the headless smoke test (`smoke_agent.py`) let the whole pipeline be verified end-to-end before the UI demo.

Everything a judge needs to reproduce: `npm test` (offline), `npm run smoke` (watch a résumé round-trip), `./run_web.sh` (full ADK UI). Samples are AI-generated fictional documents — format-valid but fabricated IDs — so the repo itself contains zero real personal data.

## Value

For an HR department, this pattern converts "LLMs are banned for personnel documents" into "LLMs are the default drafting tool for personnel documents." The same architecture generalizes to any regulated-data domain — legal, medical, finance — because the firewall is a generic MCP server: any MCP-capable agent (ADK, Claude, or otherwise) gets the same guarantee for free.

The business case is concrete: recommendation emails, interview summaries and roster reports are daily, hour-scale tasks. Redaction-first agents cut them to minutes without adding a single row to the company's data-breach risk register.

## Links

- **Video (≤5 min):** https://youtu.be/Rb-Sp0ReYw0
- **Code:** https://github.com/littlepassertw/pii-firewall-agent
- **Live demo:** not deployed (by design — the whole point is that it runs on *your* machine); the repo includes full setup instructions and an offline test suite.

---

*Word count: ~1,150 — well under the 2,500 limit, leaving room for judge-requested edits.*
