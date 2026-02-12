# Meme Art Platform

Real-time art playground driven by meme-coin market signals. The skill writes live state to JSON and the p5.js frontend renders it.

## Structure

```text
meme-art-platform/
├── .openclaw/
│   └── skills/
│       └── art-director/
│           ├── SKILL.md
│           ├── art-config.json
│           └── scripts/
│               └── process_data.py
├── frontend/
│   ├── index.html
│   └── sketch.js
├── .env
└── README.md
```

## Local Setup

1. Create and activate a Python venv.
2. Install Python deps:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install pillow scikit-learn numpy
```

3. Fill in `.env` values.

## Run

1. Generate one config update:

```bash
cd .openclaw/skills/art-director
python3 scripts/process_data.py
```

2. Run stream loop:

```bash
python3 scripts/process_data.py --loop --interval 2
```

3. Serve frontend:

```bash
cd ../../..
python3 -m http.server 8080
```

4. Open:

`http://localhost:8080/frontend/`

## Telegram / OpenClaw Commands

- `Start the stream`
- `Change style to pixel`
- `Change style to voronoi`
- `Change style to minimal`
- `What's the vibe?`

