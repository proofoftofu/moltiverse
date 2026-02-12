#!/usr/bin/env python3
"""
Fetch token imagery/trade data, derive palette + energy, and write art-config.json.

Usage:
  python3 scripts/process_data.py
  python3 scripts/process_data.py --loop --interval 2
  python3 scripts/process_data.py --style voronoi
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import List
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image
from sklearn.cluster import KMeans


@dataclass
class TokenData:
    symbol: str
    image_url: str
    buy_volume: float
    sell_volume: float


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "art-config.json"


def clamp(v: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, v))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def normalize_style(style: str | None) -> str:
    if not style:
        return "pixel-clusters"
    s = style.strip().lower()
    mapping = {"pixel": "pixel-clusters", "voronoi": "voronoi", "minimal": "minimal"}
    return mapping.get(s, s)


def stable_coordinates(symbol: str, width: int = 960, height: int = 640) -> dict:
    digest = hashlib.md5(symbol.encode("utf-8")).hexdigest()
    sx = int(digest[:8], 16)
    sy = int(digest[8:16], 16)
    return {"x": 40 + (sx % (width - 80)), "y": 40 + (sy % (height - 80))}


def image_to_palette_hex(image_bytes: bytes, k: int = 3) -> List[str]:
    img = Image.open(BytesIO(image_bytes)).convert("RGB")
    img = img.resize((32, 32), Image.Resampling.LANCZOS)
    pixels = np.array(img).reshape(-1, 3)

    # Keep deterministic clusters so visual output is stable across runs.
    model = KMeans(n_clusters=k, random_state=7, n_init=10)
    model.fit(pixels)
    centers = model.cluster_centers_.astype(int)

    counts = np.bincount(model.labels_, minlength=k)
    ordered = centers[np.argsort(counts)[::-1]]
    return [f"#{r:02X}{g:02X}{b:02X}" for r, g, b in ordered]


def calc_energy(buy_volume: float, sell_volume: float) -> float:
    total = max(buy_volume + sell_volume, 1e-6)
    return clamp(buy_volume / total)


def load_env_file(env_path: Path) -> None:
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def fetch_bytes(url: str, timeout_sec: int = 12) -> bytes:
    req = Request(
        url,
        headers={"User-Agent": "meme-art-platform/1.0", "Accept": "image/*,*/*;q=0.8"},
    )
    with urlopen(req, timeout=timeout_sec) as resp:  # nosec B310
        return resp.read()


def validate_http_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def fetch_nad_tokens() -> List[TokenData]:
    """
    Production hook for Nad.fun data.
    This function currently uses environment-provided sample data unless a custom API endpoint is given.
    """
    sample = os.getenv("NAD_SAMPLE_IMAGE_URL", "").strip()
    if sample and validate_http_url(sample):
        return [
            TokenData(
                symbol=os.getenv("NAD_SAMPLE_SYMBOL", "PEPE").strip().upper() or "PEPE",
                image_url=sample,
                buy_volume=float(os.getenv("NAD_SAMPLE_BUY_VOLUME", "1200")),
                sell_volume=float(os.getenv("NAD_SAMPLE_SELL_VOLUME", "400")),
            )
        ]
    return []


def fallback_tokens() -> List[TokenData]:
    base = [
        ("PEPE", "https://picsum.photos/seed/pepe/128/128"),
        ("DOGE", "https://picsum.photos/seed/doge/128/128"),
        ("WEN", "https://picsum.photos/seed/wen/128/128"),
    ]
    out: List[TokenData] = []
    for sym, url in base:
        buy = random.uniform(500, 5000)
        sell = random.uniform(500, 5000)
        out.append(TokenData(sym, url, buy, sell))
    return out


def build_state(style: str, limit: int = 6) -> dict:
    tokens = fetch_nad_tokens()
    if not tokens:
        tokens = fallback_tokens()

    active_tokens = []
    energy_values = []

    for token in tokens[:limit]:
        try:
            image = fetch_bytes(token.image_url)
            palette = image_to_palette_hex(image, k=3)
        except Exception:
            palette = ["#1E1E1E", "#7A7A7A", "#F5F5F5"]

        energy = calc_energy(token.buy_volume, token.sell_volume)
        energy_values.append(energy)

        size = int(20 + energy * 60)
        active_tokens.append(
            {
                "symbol": token.symbol,
                "palette": palette,
                "coordinates": stable_coordinates(token.symbol),
                "size": size,
                "energy": round(energy, 4),
            }
        )

    global_energy = round(float(np.mean(energy_values)) if energy_values else 0.0, 4)

    return {
        "last_update": now_iso(),
        "style": normalize_style(style),
        "global_energy": global_energy,
        "active_tokens": active_tokens,
    }


def write_state(state: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate live art config from trade/image data.")
    parser.add_argument("--loop", action="store_true", help="Run forever with interval updates.")
    parser.add_argument("--interval", type=int, default=2, help="Seconds between loop updates.")
    parser.add_argument("--style", type=str, default="", help="Override style name.")
    parser.add_argument("--limit", type=int, default=6, help="Max number of active tokens.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_env_file(ROOT.parents[2] / ".env")

    style = args.style
    if not style and CONFIG_PATH.exists():
        try:
            existing = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            style = str(existing.get("style", "pixel-clusters"))
        except Exception:
            style = "pixel-clusters"

    if args.loop:
        while True:
            state = build_state(style=style or "pixel-clusters", limit=args.limit)
            write_state(state)
            print(json.dumps(state, indent=2))
            time.sleep(max(args.interval, 1))
    else:
        state = build_state(style=style or "pixel-clusters", limit=args.limit)
        write_state(state)
        print(json.dumps(state, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

