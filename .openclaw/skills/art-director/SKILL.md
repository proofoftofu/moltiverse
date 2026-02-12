---
name: meme-art-director
description: Directs and evolves a generative artwork from Nad.fun market data. Use when the agent needs to (1) preprocess Nad API data into visual state, (2) analyze the current artwork and write meaningful title/description text, or (3) update the rendering system in process_data.py, frontend/sketch.js, or frontend/index.html.
---

# Meme Art Director Skill

## Objective
Continuously transform Nad.fun market activity into a single evolving square artwork, and maintain curatorial text that describes the current piece.

## Control Commands
- "Start the stream": Run `python3 scripts/process_data.py --loop`.
- "What's the vibe?": Analyze current state/artwork and update textual interpretation.
- "Retune the studio": Update preprocessing or rendering logic if the visual output needs refinement.

## Logic Flow
1. Trigger on new trade events or user commands.
2. Run `python3 scripts/process_data.py`.

## Working Rules
- Keep `art-config.json` valid JSON at all times.
- Clamp all energy values to `0.0..1.0`.
- Stop the process on data/image failures; do not invent synthetic fallback tokens.
- Keep artwork square and studio presentation minimal.
- Treat `title` and `description` as artwork interpretation, not system metadata.

## Editable Surfaces
Update these files whenever the piece needs better behavior or presentation:
- `.openclaw/skills/art-director/scripts/process_data.py` (data preprocessing and narrative generation)
- `frontend/sketch.js` (visual rendering logic)
- `frontend/index.html` (studio/atelier layout and framing)
