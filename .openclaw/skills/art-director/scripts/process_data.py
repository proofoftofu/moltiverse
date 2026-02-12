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
import re
import time
import traceback
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import List
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image
from sklearn.cluster import KMeans


@dataclass
class TokenData:
    token_id: str
    symbol: str
    image_url: str
    buy_volume: float
    sell_volume: float


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "art-config.json"
LAST_API_REQUEST_TS = 0.0


def log(level: str, message: str) -> None:
    ts = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    print(f"[{ts}] [{level}] {message}")


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
    log("DEBUG", f"Fetching bytes: {url}")
    req = Request(
        url,
        headers={"User-Agent": "meme-art-platform/1.0", "Accept": "image/*,*/*;q=0.8"},
    )
    with urlopen(req, timeout=timeout_sec) as resp:  # nosec B310
        return resp.read()


def fetch_text(url: str, timeout_sec: int = 12) -> str:
    log("DEBUG", f"Fetching text: {url}")
    req = Request(
        url,
        headers={
            "User-Agent": "meme-art-platform/1.0",
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        },
    )
    with urlopen(req, timeout=timeout_sec) as resp:  # nosec B310
        return resp.read().decode("utf-8", errors="ignore")


def build_api_url(path: str, query: dict | None = None) -> str:
    base = "https://api.nadapp.net"
    url = f"{base}{path}"
    if query:
        url = f"{url}?{urlencode(query)}"
    return url


def api_min_interval_sec() -> float:
    configured = os.getenv("NAD_API_MIN_INTERVAL_MS", "").strip()
    if configured:
        try:
            return max(0.0, float(configured) / 1000.0)
        except ValueError:
            log("WARN", f"Invalid NAD_API_MIN_INTERVAL_MS={configured!r}; using defaults.")
    return 6.5


def wait_before_api_request() -> None:
    global LAST_API_REQUEST_TS
    min_interval = api_min_interval_sec()
    elapsed = time.time() - LAST_API_REQUEST_TS
    wait_s = min_interval - elapsed
    if wait_s > 0:
        log("DEBUG", f"Rate-limit pacing sleep {wait_s:.2f}s before API request")
        time.sleep(wait_s)


def mark_api_request_time() -> None:
    global LAST_API_REQUEST_TS
    LAST_API_REQUEST_TS = time.time()


def parse_retry_after_seconds(http_error: HTTPError) -> float:
    header_val = ""
    try:
        header_val = str(http_error.headers.get("Retry-After", "")).strip()
    except Exception:
        header_val = ""
    if header_val.isdigit():
        return max(0.0, float(header_val))

    try:
        body = http_error.read().decode("utf-8")
        payload = json.loads(body) if body else {}
        retry_after = payload.get("retry_after")
        if retry_after is not None:
            return max(0.0, float(retry_after))
    except Exception:
        return 0.0
    return 0.0


def api_headers() -> dict:
    return {"User-Agent": "meme-art-platform/1.0", "Accept": "application/json"}


def api_get_json(path: str, query: dict | None = None, timeout_sec: int = 15) -> dict:
    url = build_api_url(path, query=query)
    max_retries = max(0, int(os.getenv("NAD_API_MAX_RETRIES", "2")))
    attempt = 0
    while True:
        attempt += 1
        wait_before_api_request()
        log("DEBUG", f"API GET {url} (attempt={attempt})")
        req = Request(url, headers=api_headers())
        try:
            with urlopen(req, timeout=timeout_sec) as resp:  # nosec B310
                raw = resp.read().decode("utf-8")
            mark_api_request_time()
            log("DEBUG", f"API OK {path} (bytes={len(raw)})")
            return json.loads(raw) if raw else {}
        except HTTPError as e:
            mark_api_request_time()
            status = getattr(e, "code", "unknown")
            log("WARN", f"API HTTPError {path}: status={status}")
            if int(status) == 429 and attempt <= max_retries:
                retry_after = parse_retry_after_seconds(e)
                backoff = retry_after if retry_after > 0 else min(20.0, 1.5 * (2 ** (attempt - 1)))
                log("WARN", f"429 on {path}; sleeping {backoff:.2f}s then retrying")
                time.sleep(backoff)
                continue
            return {}
        except URLError as e:
            mark_api_request_time()
            log("WARN", f"API URLError {path}: {e}")
            return {}
        except TimeoutError:
            mark_api_request_time()
            log("WARN", f"API timeout {path}")
            return {}
        except json.JSONDecodeError:
            mark_api_request_time()
            log("WARN", f"API invalid JSON {path}")
            return {}
        except Exception as e:
            mark_api_request_time()
            log("WARN", f"API unknown error {path}: {e}")
            return {}


def validate_http_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def fetch_trending_token_ids(limit: int = 8) -> List[str]:
    """
    Discover token IDs from Nad.fun Trending cards.
    Current Nad.fun token pages follow /tokens/<0x-address>.
    """
    try:
        html = fetch_text("https://nad.fun/")
    except Exception:
        log("WARN", "Failed to fetch nad.fun homepage for trending discovery.")
        return []

    matches = re.findall(r"/tokens/(0x[a-fA-F0-9]{40})", html)
    if not matches:
        log("WARN", "No token links found on nad.fun homepage.")
        return []

    out: List[str] = []
    seen = set()
    for token_id in matches:
        key = token_id.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(token_id)
        if len(out) >= max(1, limit):
            break
    log("INFO", f"Auto-discovered {len(out)} trending token ids from nad.fun")
    return out


def fetch_nad_tokens(target_limit: int = 6) -> List[TokenData]:
    token_ids = [x.strip() for x in os.getenv("NAD_TOKEN_IDS", "").split(",") if x.strip()]
    account_id = os.getenv("NAD_ACCOUNT_ID", "").strip()
    trending_limit = int(os.getenv("NAD_TRENDING_LIMIT", "8"))

    if not token_ids:
        log("INFO", "NAD_TOKEN_IDS not set. Discovering from nad.fun Trending.")
        token_ids = fetch_trending_token_ids(limit=trending_limit)
    else:
        log("INFO", f"Using {len(token_ids)} token ids from NAD_TOKEN_IDS.")

    if not token_ids and account_id:
        log("INFO", f"Trending unavailable. Fetching created tokens for account: {account_id}")
        created = api_get_json(
            f"/agent/token/created/{account_id}",
            query={"page": 1, "limit": int(os.getenv("NAD_CREATED_LIMIT", "10"))},
        )
        created_tokens = created.get("tokens", [])
        for item in created_tokens:
            token_info = item.get("token_info", {}) if isinstance(item, dict) else {}
            token_id = str(token_info.get("id", "")).strip()
            if token_id:
                token_ids.append(token_id)
        log("INFO", f"Loaded {len(token_ids)} token ids from account-created tokens.")

    live_tokens: List[TokenData] = []
    log("INFO", f"Building live token list from {len(token_ids)} token ids (target={target_limit}).")
    for token_id in token_ids:
        if len(live_tokens) >= max(1, target_limit):
            log("INFO", f"Reached target token count={target_limit}; stopping API fetch loop early.")
            break

        log("DEBUG", f"Resolving token metadata for token_id={token_id}")
        token_resp = api_get_json(f"/agent/token/{token_id}")
        if not token_resp:
            log("WARN", f"Token metadata request failed for token_id={token_id}; skipping.")
            continue
        token_info = token_resp.get("token_info", {}) if isinstance(token_resp, dict) else {}
        symbol = str(token_info.get("symbol", token_id)).strip().upper() or token_id
        image_uri = str(token_info.get("image_uri", "")).strip()

        if not validate_http_url(image_uri):
            log("WARN", f"Token {symbol}: missing/invalid image_uri from token info; skipping swap call.")
            continue

        log("DEBUG", f"Fetching swap history for token_id={token_id}")
        swaps_resp = api_get_json(
            f"/agent/swap-history/{token_id}",
            query={"limit": int(os.getenv("NAD_SWAP_LIMIT", "50")), "trade_type": "ALL"},
        )
        swaps = swaps_resp.get("swaps", []) if isinstance(swaps_resp, dict) else []
        buy_volume = 0.0
        sell_volume = 0.0
        for swap in swaps:
            info = swap.get("swap_info", {}) if isinstance(swap, dict) else {}
            event_type = str(info.get("event_type", "")).upper()
            try:
                amount = float(info.get("native_amount", 0.0))
            except (TypeError, ValueError):
                amount = 0.0

            if "BUY" in event_type:
                buy_volume += amount
            elif "SELL" in event_type:
                sell_volume += amount

        log(
            "INFO",
            f"Token {symbol}: image ok, swaps={len(swaps)}, buy={buy_volume:.4f}, sell={sell_volume:.4f}",
        )
        live_tokens.append(
            TokenData(
                token_id=token_id,
                symbol=symbol,
                image_url=image_uri,
                buy_volume=buy_volume,
                sell_volume=sell_volume,
            )
        )

    if live_tokens:
        log("INFO", f"Using {len(live_tokens)} live tokens from Nad API.")
        return live_tokens
    raise RuntimeError("No live tokens available from Nad API.")


def build_state(style: str, limit: int = 6) -> dict:
    log("INFO", f"Building art state (style={style}, limit={limit})")
    tokens = fetch_nad_tokens(target_limit=limit)
    if not tokens:
        raise RuntimeError("No tokens to process.")

    active_tokens = []
    energy_values = []

    for token in tokens[:limit]:
        log("DEBUG", f"Processing token {token.symbol} ({token.token_id})")
        image = fetch_bytes(token.image_url)
        palette = image_to_palette_hex(image, k=3)
        log("DEBUG", f"Token {token.symbol} palette={palette}")

        energy = calc_energy(token.buy_volume, token.sell_volume)
        energy_values.append(energy)
        log(
            "DEBUG",
            f"Token {token.symbol} energy={energy:.4f} from buy={token.buy_volume:.4f}, sell={token.sell_volume:.4f}",
        )

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
    log("INFO", f"State complete: active_tokens={len(active_tokens)}, global_energy={global_energy:.4f}")

    return {
        "last_update": now_iso(),
        "style": normalize_style(style),
        "global_energy": global_energy,
        "active_tokens": active_tokens,
    }


def write_state(state: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    log("INFO", f"Wrote art config to {CONFIG_PATH}")


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
    log("INFO", "Loaded environment configuration.")

    style = args.style
    if not style and CONFIG_PATH.exists():
        try:
            existing = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            style = str(existing.get("style", "pixel-clusters"))
        except Exception:
            style = "pixel-clusters"

    if args.loop:
        log("INFO", f"Starting stream loop with interval={max(args.interval, 1)}s")
        while True:
            try:
                state = build_state(style=style or "pixel-clusters", limit=args.limit)
                write_state(state)
                print(json.dumps(state, indent=2))
            except Exception as e:
                log("ERROR", f"Loop iteration failed: {e}")
                log("ERROR", traceback.format_exc().strip())
                return 1
            time.sleep(max(args.interval, 1))
    else:
        try:
            state = build_state(style=style or "pixel-clusters", limit=args.limit)
            write_state(state)
            print(json.dumps(state, indent=2))
        except Exception as e:
            log("ERROR", f"Run failed: {e}")
            log("ERROR", traceback.format_exc().strip())
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
