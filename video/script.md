# Video Narration Script (English, ~4:40 total)

Voice: en-US-AndrewNeural (edge-tts). One mp3 per segment; timings are targets.

## Segment 1 — The Problem (0:00–0:40)

HR teams work with the most sensitive data in any company: national ID numbers, salaries, home addresses, exit-interview notes. They are also the people who would benefit most from AI assistants — summarizing résumés, drafting emails, writing reports. But pasting an employee file into a cloud chatbot is a data-protection breach waiting to happen. So companies face a bad choice: ban AI for HR work, or quietly leak personal data. This project removes that trade-off.

## Segment 2 — The Idea (0:40–1:10)

Here's the insight: the cloud model never actually needs the personal data. To write a recommendation email, it needs the story — not the real name or ID number. PII Firewall Agent runs a privacy firewall on your own machine, as an MCP server. It detects and redacts personal data locally, sends only placeholder text to the cloud agents, and restores the real values locally at the end. De-identify, reason in the cloud, re-identify. Personal data never leaves the machine.

## Segment 3 — Live Demo (1:10–3:10)

Let's see it live, in Google's Agent Development Kit. I ask the coordinator to process a résumé and draft a recommendation email. Notice: I give it a file path, not the file content. The coordinator calls the local firewall, which reads the file, runs four layers of Taiwan-tuned detection — rules with checksum validation, field keywords, document patterns, and a forty-one-thousand-entry lexicon — plus local Chinese BERT NER. What comes back is fully redacted: person A, ID placeholder one. The writer agent — which has no tools at all — drafts the email from placeholders. Then the compliance auditor re-scans the draft with the local detector to prove nothing leaked, and approves it. Finally I ask for the real document. The firewall restores every placeholder locally and returns only a file path. The restored file, with the real names, exists only on my machine.

## Segment 4 — Proof (3:10–4:00)

Don't take the prompts' word for it. This session file is the only place where placeholders and real values coexist — it never leaves the machine. This audit log shows every byte the cloud model was allowed to see. And the security claim is an executable test: the integration suite spawns the real server, calls every tool, and asserts that no response contains any original personal data. Thirteen tests, all passing, fully offline. And if someone pastes raw content into the chat instead of a path? The coordinator refuses, and asks for a file path — so the firewall can do its job.

## Segment 5 — Security Architecture (4:00–4:30)

The guarantees are structural, not polite requests. All tool responses exit through a single whitelist function — original values are not part of any response schema. Agents get least-privilege tool filters: the writer has no tools, the auditor can only scan. And restoration writes locally, returning only a path — so real data never transits the cloud in either direction.

## Segment 6 — The Build (4:30–5:00)

The detection engine is ported from a production browser extension I built for HR de-identification, tuned on real documents. The firewall is a Node MCP server; the agents run on Google ADK with a provider-agnostic model layer; NER runs in-process with ONNX. The project was built agentically — with Claude Code and Antigravity. Because the firewall is a standard MCP server, any MCP-capable agent gets the same guarantee for free. Thanks for watching.
