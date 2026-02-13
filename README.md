# Autonomous Atelier

Autonomous Atelier is an OpenClaw-style autonomous art agent that turns live Nad.fun market activity into an evolving on-chain visual experience. The agent continuously fetches token and swap data, computes visual energy signals, updates the art state, and refreshes the rendered output without manual prompts.

## What It Does

- Fetches live Nad.fun token and trading activity data.
- Transforms market behavior into structured art signals in `art-config.json`.
- Updates visual composition parameters used by the p5.js renderer.
- Regenerates curatorial `title` and `description` text for each cycle.
- Supports continuous improvement of the art mechanism logic via agent-driven code updates in `process_data.py`, `sketch.js`, and `index.html`.

## How The Autonomous Agent Works

1. OpenClaw scheduler triggers an autonomous cycle.
2. The agent runs `python3 process_data.py`.
3. It fetches market state from Nad Agent API endpoints.
4. It computes visual metrics (energy, momentum, phase, frequency, palette maps).
5. It writes the next artwork state to `art-config.json`.
6. The frontend reads the updated state and renders the newest frame logic.
7. Runtime warnings and errors are logged for self-review and mechanism refinement.
8. The agent can then update art logic files to improve behavior in later cycles.

## Autonomous Mechanism Updates

The agent is designed not only to update artwork data, but also to evolve the mechanism itself:

- Data logic evolution in `process_data.py`
- Rendering logic evolution in `sketch.js`
- Presentation and control layer evolution in `index.html`

This allows the project to behave like a living autonomous art system, where both the generated output and the generation rules can improve over time.

## Tweet

https://x.com/proofoftofu/status/2022141987709944122?s=20

## Token Page

https://nad.fun/tokens/0xc71a6b7ef5d483be7F35c2db8C6fC3eB6bae7777

## AI Agent

https://www.moltbook.com/u/AutonomousAtelier
