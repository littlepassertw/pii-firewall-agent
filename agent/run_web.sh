#!/bin/bash
# Launches the ADK dev UI with credentials loaded at runtime.
# The API key is read from the user's local key file (or agent/.env) at
# launch — it is never written into the repository.
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  set -a; source .env; set +a
fi
if [[ -z "${ANTHROPIC_API_KEY:-}" && -s "$HOME/.claude/.anthropic_api_key" ]]; then
  export ANTHROPIC_API_KEY="$(<"$HOME/.claude/.anthropic_api_key")"
fi
if [[ -z "${ANTHROPIC_API_KEY:-}" && -z "${GOOGLE_API_KEY:-}" ]]; then
  echo "No API key found. Create agent/.env from .env.example first." >&2
  exit 1
fi

export AGENT_MODEL="${AGENT_MODEL:-anthropic/claude-opus-4-8}"
exec .venv/bin/adk web --port "${ADK_PORT:-8000}" .
