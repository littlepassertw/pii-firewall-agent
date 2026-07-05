"""PII Firewall Agent — ADK multi-agent pipeline.

Architecture (least-privilege tool routing):

    pii_firewall_coordinator (root)
    │   tools: ingest_and_redact, restore_and_export
    ├── hr_task_writer        tools: none  — reasons over redacted text only
    └── compliance_auditor    tools: scan_text_for_pii, get_redaction_summary

The MCP server (Node, stdio) runs locally and is the only component that ever
sees original document content. Each agent gets a tool_filter'd view of it,
so e.g. the writer cannot ingest files and the auditor cannot restore data.
"""

import os

from google.adk.agents import LlmAgent
from google.adk.models.lite_llm import LiteLlm
from google.adk.tools.mcp_tool import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StdioConnectionParams
from mcp import StdioServerParameters

from .prompts import AUDITOR_INSTRUCTION, COORDINATOR_INSTRUCTION, WRITER_INSTRUCTION

_SERVER_ENTRY = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "mcp-server", "src", "index.js")
)

# Model is provider-agnostic via LiteLLM; set AGENT_MODEL in agent/.env.
# Anthropic: anthropic/claude-opus-4-8 (needs ANTHROPIC_API_KEY)
# Gemini:    gemini-2.5-flash          (needs GOOGLE_API_KEY; pass the bare id)
_MODEL_ID = os.environ.get("AGENT_MODEL", "anthropic/claude-opus-4-8")
_MODEL = _MODEL_ID if _MODEL_ID.startswith("gemini") else LiteLlm(model=_MODEL_ID)


def _firewall_toolset(tool_filter: list[str]) -> McpToolset:
    """One stdio connection per agent, narrowed to the tools it may use."""
    return McpToolset(
        connection_params=StdioConnectionParams(
            server_params=StdioServerParameters(
                command="node",
                args=[_SERVER_ENTRY],
                # NER adds ~10s to first ingest; flip to "on" for the full demo.
                env={**os.environ, "PII_FIREWALL_NER": os.environ.get("PII_FIREWALL_NER", "on")},
            ),
            timeout=60,  # first call may load the NER model
        ),
        tool_filter=tool_filter,
    )


hr_task_writer = LlmAgent(
    name="hr_task_writer",
    model=_MODEL,
    description="Writes HR documents (summaries, emails, reports) from redacted text. Has no tools.",
    instruction=WRITER_INSTRUCTION,
)

compliance_auditor = LlmAgent(
    name="compliance_auditor",
    model=_MODEL,
    description="Audits generated drafts for PII leaks using the local scanner.",
    instruction=AUDITOR_INSTRUCTION,
    tools=[_firewall_toolset(["scan_text_for_pii", "get_redaction_summary"])],
)

root_agent = LlmAgent(
    name="pii_firewall_coordinator",
    model=_MODEL,
    description="Coordinates redaction, writing, auditing and restoration of HR documents.",
    instruction=COORDINATOR_INSTRUCTION,
    tools=[_firewall_toolset(["ingest_and_redact", "restore_and_export"])],
    sub_agents=[hr_task_writer, compliance_auditor],
)
