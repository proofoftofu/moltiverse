---
name: meme-art-director
description: Directs a generative art canvas based on Nad.fun meme coin data.
---

# Meme Art Director Skill

## Objective
Monitor Nad.fun trades on Monad and translate market energy into artwork.

## Control Commands (Telegram)
- "Start the stream": Begin running `python3 scripts/process_data.py --loop`.
- "Change style to [pixel|voronoi|minimal]": Update `art-config.json` style.
- "What's the vibe?": Analyze recent trade colors and report the market palette.

## Logic Flow
1. Trigger on new trade events or user commands.
2. Run `python3 scripts/process_data.py`.
3. Call Nad Agent REST API:
   - `GET /agent/token/:token_id` for symbol + image URI
   - `GET /agent/swap-history/:token_id` for BUY/SELL volume
4. Fetch token image, extract dominant colors using K-means (`k=3`), and compute buy-vs-sell energy.
5. Overwrite `art-config.json` with style, energy, and token render coordinates.

## Working Rules
- Keep `art-config.json` valid JSON at all times.
- Clamp all energy values to `0.0..1.0`.
- Use deterministic coordinates per token symbol to avoid canvas flicker.
- Prefer graceful fallbacks when API keys, image URLs, or trade data are unavailable.
