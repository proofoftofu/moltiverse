---
name: meme-art-director
description: Autonomous generative art director for Nad.fun market data. Use when the agent must continuously preprocess data into visual state, update artwork narrative text, monitor and analyze runtime errors, and evolve only process_data.py and frontend/sketch.js (never frontend/index.html).
---

# Meme Art Director Skill

## Objective
Run autonomously and continuously transform Nad.fun market activity into a single evolving square artwork, while maintaining curatorial text and self-correcting behavior based on logged warnings/errors.

## Execution Model
- Do not wait for user prompts to trigger generation.
- Run one autonomous cycle per invocation (`python3 scripts/process_data.py`) under OpenClaw scheduling/automation.
- Treat each cycle as: fetch -> preprocess -> render-state update -> error review.

## Logic Flow
1. Trigger automatically on schedule/stream cycle (no user trigger required).
2. Run `python3 scripts/process_data.py`.
3. Call Nad Agent REST API:
   - `GET /agent/token/:token_id`
   - `GET /agent/swap-history/:token_id`
4. Build artwork state fields in `art-config.json`:
   - token palette and `gradient_map`
   - `energy`, `phase`, `frequency`
   - `noise_seed`, `noise_anchor`
   - `global_energy`
   - `title`, `description`
5. Persist runtime warnings/errors to `.openclaw/skills/art-director/error.log`.
6. In agent actions, inspect recent `error.log` entries and use them to guide corrective edits.

## Working Rules
- Keep `art-config.json` valid JSON at all times.
- Clamp all energy values to `0.0..1.0`.
- Stop the process on data/image failures; do not invent synthetic fallback tokens.
- Keep artwork square and studio presentation minimal.
- Treat `title` and `description` as artwork interpretation, not system metadata.
- Preserve an append-only WARN/ERROR trail in `error.log` for debugging and analysis.

## Editable Surfaces
Update these files whenever behavior or quality needs refinement:
- `.openclaw/skills/art-director/scripts/process_data.py` (data preprocessing and narrative generation)
- `frontend/sketch.js` (visual rendering logic)
