---
name: nomad-fun-autonomous-atelier
description: Well-structured OpenClaw autonomous skill for Nad.fun-driven generative art. Use when the agent should run scheduled cycles, fetch market data, update `art-config.json`, refresh narrative metadata, monitor errors, and iteratively improve art-generation logic in `process_data.py`, `sketch.js`, and `index.html`.
---

# Autonomous Atelier OpenClaw Skill

## Skill Intent
Operate as a production-style OpenClaw autonomous art skill that continuously converts Nad.fun market behavior into evolving visual output and narrative context.

## Autonomous Execution Model
- Run without manual prompts whenever scheduled by OpenClaw.
- Execute one full cycle per invocation with `python3 process_data.py`.
- Demo cadence: run every 30 minutes unless deployment policy overrides it.
- Treat each cycle as: fetch -> transform -> publish state -> review logs -> refine mechanism.

## End-to-End Cycle
1. Trigger from OpenClaw scheduler (or compatible automation runtime).
2. Execute `python3 process_data.py`.
3. Pull market intelligence from Nad Agent REST API:
   - `GET /agent/token/:token_id`
   - `GET /agent/swap-history/:token_id`
4. Derive and update artwork state in `art-config.json`:
   - token palette and `gradient_map`
   - `energy`, `momentum`, `activity`, `phase`, `frequency`
   - `noise_seed`, `noise_anchor`
   - `global_energy`, `momentum_bias`, `energy_spread`
   - `title`, `description`
5. Persist runtime warnings and errors in `error.log`.
6. Inspect recent logs and use them to drive corrective code edits.
7. Evolve mechanism logic only in allowed surfaces, then continue the next cycle.

## Core Operating Rules
- Keep `art-config.json` valid JSON at all times.
- Clamp all energy values to `0.0..1.0`.
- Stop the process on data/image failures; do not invent synthetic fallback tokens.
- Keep artwork square and studio presentation minimal.
- Treat `title` and `description` as artwork interpretation, not system metadata.
- Preserve an append-only WARN/ERROR trail in `error.log` for debugging and analysis.
- Prefer deterministic, explainable transformations over opaque random behavior.
- Maintain backward compatibility with the existing frontend state contract.

## Editable Surfaces (Mechanism Evolution Scope)
The autonomous agent may refine behavior only in these files:
- `process_data.py` (data preprocessing and narrative generation)
- `sketch.js` (visual rendering logic)
- `index.html` (presentation shell and controls)

## Success Criteria
- Each scheduled cycle runs end-to-end without manual intervention.
- `art-config.json` is refreshed with meaningful state changes from live inputs.
- Frontend visuals reflect updated logic and state on reload.
- Errors are observable and used to improve future behavior.
