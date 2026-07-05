"""Headless end-to-end smoke test: drives the full multi-agent pipeline
without the web UI. Needs a real API key (loaded by run_smoke.sh / .env).

Usage: .venv/bin/python smoke_agent.py
"""

import asyncio

from google.adk.runners import InMemoryRunner
from google.genai import types

from pii_firewall.agent import root_agent

PROMPT = (
    "請處理 ../samples/resume_01.txt，"
    "幫我寫一封推薦這位候選人給用人主管的內部 Email（繁體中文）。"
)


async def main() -> None:
    runner = InMemoryRunner(agent=root_agent, app_name="pii-firewall")
    session = await runner.session_service.create_session(
        app_name="pii-firewall", user_id="smoke"
    )
    message = types.Content(role="user", parts=[types.Part(text=PROMPT)])
    async for event in runner.run_async(
        user_id="smoke", session_id=session.id, new_message=message
    ):
        author = getattr(event, "author", "?")
        if event.content and event.content.parts:
            for part in event.content.parts:
                if part.text:
                    print(f"\n=== [{author}] ===\n{part.text}")
                elif part.function_call:
                    print(f"--- [{author}] calls {part.function_call.name}")
                elif part.function_response:
                    print(f"--- [{author}] got response from {part.function_response.name}")


if __name__ == "__main__":
    asyncio.run(main())
