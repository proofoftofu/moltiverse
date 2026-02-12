# Nomad Fun Autonomous Atelier

Real-time art playground driven by meme-coin market signals. The skill writes live state to JSON and the p5.js frontend renders it.

## Structure

```text
.
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

## Run

1. Generate one config update:

```bash
python3 .openclaw/skills/art-director/scripts/process_data.py
```

2. Serve frontend:

```bash
python3 -m http.server 8080
```

3. Open:

`http://localhost:8080/frontend/`
