#!/usr/bin/env python3
"""
Fetch token imagery/trade data, derive palette + energy, and write art-config.json.

Usage:
  python3 process_data.py
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
ERROR_LOG_PATH = ROOT / "error.log"
LAST_API_REQUEST_TS = 0.0


def append_error_log(line: str) -> None:
    try:
        with ERROR_LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        # Avoid recursive failures if logging itself breaks.
        pass


def reset_error_log() -> None:
    try:
        ERROR_LOG_PATH.write_text("", encoding="utf-8")
    except Exception:
        # Do not fail processing if log reset fails.
        pass


def log(level: str, message: str) -> None:
    ts = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    line = f"[{ts}] [{level}] {message}"
    print(line)
    # Persist warnings and errors for autonomous post-run analysis.
    if level in {"WARN", "ERROR"}:
        append_error_log(line)


def clamp(v: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, v))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


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


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    h = value.lstrip("#")
    if len(h) != 6:
        raise ValueError(f"Invalid hex color: {value}")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def rgb_to_hex(r: float, g: float, b: float) -> str:
    rr = max(0, min(255, int(round(r))))
    gg = max(0, min(255, int(round(g))))
    bb = max(0, min(255, int(round(b))))
    return f"#{rr:02X}{gg:02X}{bb:02X}"


def build_gradient_map(palette: List[str], steps: int = 255) -> List[str]:
    if len(palette) < 3:
        raise ValueError("Palette must have at least 3 colors for gradient map.")
    c0 = hex_to_rgb(palette[0])
    c1 = hex_to_rgb(palette[1])
    c2 = hex_to_rgb(palette[2])
    out: List[str] = []
    for i in range(max(1, steps)):
        t = 0.0 if steps <= 1 else i / (steps - 1)
        if t < 0.5:
            local = t * 2.0
            r = c0[0] + (c1[0] - c0[0]) * local
            g = c0[1] + (c1[1] - c0[1]) * local
            b = c0[2] + (c1[2] - c0[2]) * local
        else:
            local = (t - 0.5) * 2.0
            r = c1[0] + (c2[0] - c1[0]) * local
            g = c1[1] + (c2[1] - c1[1]) * local
            b = c1[2] + (c2[2] - c1[2]) * local
        out.append(rgb_to_hex(r, g, b))
    return out


def seed_from_token_id(token_id: str) -> int:
    digest = hashlib.sha256(token_id.encode("utf-8")).hexdigest()
    return int(digest[:12], 16)


def phase_from_seed(seed: int) -> float:
    return round((seed % 100000) / 100000.0 * (2.0 * np.pi), 6)


def frequency_from_energy(energy: float) -> float:
    # Higher energy => faster oscillation.
    return round(0.18 + energy * 1.45, 6)


def noise_anchor_from_seed(seed: int) -> dict:
    # Stable neighborhood in normalized noise-space (0..1, 0..1).
    u = ((seed >> 8) % 10000) / 9999.0
    v = ((seed >> 24) % 10000) / 9999.0
    return {"u": round(u, 6), "v": round(v, 6)}


def calc_energy(buy_volume: float, sell_volume: float) -> float:
    total = max(buy_volume + sell_volume, 1e-6)
    return clamp(buy_volume / total)


def calc_momentum(buy_volume: float, sell_volume: float) -> float:
    total = max(buy_volume + sell_volume, 1e-6)
    return max(-1.0, min(1.0, (buy_volume - sell_volume) / total))


def describe_market(global_energy: float, avg_momentum: float, spread: float, leader_symbol: str) -> tuple[str, str]:
    if global_energy >= 0.66:
        mood = "Incandescent Tide"
    elif global_energy >= 0.45:
        mood = "Velvet Friction"
    else:
        mood = "Nocturne Undertow"

    if avg_momentum >= 0.2:
        bias_phrase = "buyers turn the current outward, lifting bright filaments from each anchor"
    elif avg_momentum <= -0.2:
        bias_phrase = "sellers pull the field inward, cutting retreating bands through the color wash"
    else:
        bias_phrase = "bid and ask braid together, keeping the sea in a tense suspended drift"

    if spread >= 0.22:
        volatility_phrase = "volatility tears the surface into hard crosscurrents and electric seams"
    elif spread >= 0.12:
        volatility_phrase = "volatility ripples the mid-tones into visible grain and lateral slips"
    else:
        volatility_phrase = "the surface holds almost laminar, with only soft halo haze around token anchors"

    title = f"{mood}: {leader_symbol}" if leader_symbol else mood
    description = (
        f"{bias_phrase.capitalize()}; {volatility_phrase}. "
        "Sampled token palettes diffuse through anchored noise neighborhoods beneath a dusk vignette."
    )
    return title, description


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
        headers={"User-Agent": "nomad-fun-autonomous-atelier/1.0", "Accept": "image/*,*/*;q=0.8"},
    )
    with urlopen(req, timeout=timeout_sec) as resp:  # nosec B310
        return resp.read()


def fetch_text(url: str, timeout_sec: int = 12) -> str:
    log("DEBUG", f"Fetching text: {url}")
    req = Request(
        url,
        headers={
            "User-Agent": "nomad-fun-autonomous-atelier/1.0",
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
    return {"User-Agent": "nomad-fun-autonomous-atelier/1.0", "Accept": "application/json"}


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


def load_text_fields() -> tuple[str, str]:
    default_title = "Nomad Fun Autonomous Atelier"
    default_description = (
        "A live pigment sea shaped by Nad.fun trade pressure. Each token diffuses through a stable "
        "noise neighborhood while volatility snaps the surface into horizontal glitches."
    )
    if not CONFIG_PATH.exists():
        return default_title, default_description
    try:
        existing = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        title = str(existing.get("title", default_title)).strip() or default_title
        description = str(existing.get("description", default_description)).strip() or default_description
        return title, description
    except Exception:
        return default_title, default_description


def build_state(limit: int = 6) -> dict:
    log("INFO", f"Building art state (limit={limit})")
    tokens = fetch_nad_tokens(target_limit=limit)
    if not tokens:
        raise RuntimeError("No tokens to process.")

    active_tokens = []
    energy_values = []
    momentum_values = []
    total_volumes = []

    for token in tokens[:limit]:
        total_volumes.append(max(0.0, token.buy_volume) + max(0.0, token.sell_volume))

    max_volume = max(total_volumes) if total_volumes else 1.0

    for token in tokens[:limit]:
        log("DEBUG", f"Processing token {token.symbol} ({token.token_id})")
        image = fetch_bytes(token.image_url)
        palette = image_to_palette_hex(image, k=3)
        gradient_map = build_gradient_map(palette, steps=96)
        log("DEBUG", f"Token {token.symbol} palette={palette}")

        energy = calc_energy(token.buy_volume, token.sell_volume)
        momentum = calc_momentum(token.buy_volume, token.sell_volume)
        seed = seed_from_token_id(token.token_id)
        phase = phase_from_seed(seed)
        frequency = frequency_from_energy(energy)
        noise_anchor = noise_anchor_from_seed(seed)
        total_volume = max(0.0, token.buy_volume) + max(0.0, token.sell_volume)
        activity = clamp(total_volume / max(1e-6, max_volume))
        energy_values.append(energy)
        momentum_values.append(momentum)
        log(
            "DEBUG",
            f"Token {token.symbol} energy={energy:.4f} from buy={token.buy_volume:.4f}, sell={token.sell_volume:.4f}",
        )
        active_tokens.append(
            {
                "token_id": token.token_id,
                "symbol": token.symbol,
                "palette": palette,
                "gradient_map": gradient_map,
                "energy": round(energy, 4),
                "momentum": round(momentum, 4),
                "activity": round(activity, 4),
                "phase": phase,
                "frequency": frequency,
                "noise_seed": seed,
                "noise_anchor": noise_anchor,
                "buy_volume": round(token.buy_volume, 6),
                "sell_volume": round(token.sell_volume, 6),
            }
        )

    global_energy = round(float(np.mean(energy_values)) if energy_values else 0.0, 4)
    momentum_bias = round(float(np.mean(momentum_values)) if momentum_values else 0.0, 4)
    energy_spread = round(float(np.std(energy_values)) if energy_values else 0.0, 4)
    leader_symbol = ""
    if active_tokens:
        leader = max(active_tokens, key=lambda t: float(t.get("activity", 0.0)))
        leader_symbol = str(leader.get("symbol", "")).strip().upper()
    title, description = describe_market(global_energy, momentum_bias, energy_spread, leader_symbol)
    log(
        "INFO",
        (
            "State complete: "
            f"active_tokens={len(active_tokens)}, global_energy={global_energy:.4f}, "
            f"momentum_bias={momentum_bias:.4f}, energy_spread={energy_spread:.4f}"
        ),
    )
    # Preserve manual overrides if an existing config explicitly pins text.
    old_title, old_description = load_text_fields()
    if os.getenv("ART_KEEP_TEXT", "").strip() == "1":
        title, description = old_title, old_description

    return {
        "last_update": now_iso(),
        "title": title,
        "description": description,
        "global_energy": global_energy,
        "momentum_bias": momentum_bias,
        "energy_spread": energy_spread,
        "active_tokens": active_tokens,
    }


def write_state(state: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    log("INFO", f"Wrote art config to {CONFIG_PATH}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate live art config from trade/image data.")
    parser.add_argument("--limit", type=int, default=6, help="Max number of active tokens.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    reset_error_log()
    load_env_file(ROOT.parents[2] / ".env")
    log("INFO", "Loaded environment configuration.")

    try:
        state = build_state(limit=args.limit)
        write_state(state)
        print(json.dumps(state, indent=2))
    except Exception as e:
        log("ERROR", f"Run failed: {e}")
        log("ERROR", traceback.format_exc().strip())
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
