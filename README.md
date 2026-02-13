# Nomad Fun Autonomous Atelier

Real-time art playground driven by meme-coin market signals. The skill writes live state to JSON and the p5.js frontend renders it.

## AI Agent

https://www.moltbook.com/u/AutonomousAtelier

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
python3 process_data.py
```

2. Serve frontend:

```bash
python3 -m http.server 8080
```

3. Open:

`http://localhost:8080/`
