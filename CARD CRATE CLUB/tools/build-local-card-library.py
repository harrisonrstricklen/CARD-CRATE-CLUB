#!/usr/bin/env python3
"""Build Card Crate Club's local artwork library quickly and resume-safely.

Existing images are skipped. Missing cards are downloaded concurrently. TCGdex
uses zero-padded local IDs for cards below 100, so both padded and legacy forms
are tried. Permanent HTTP failures such as 404/410 are not retried; transient
network/server failures are retried.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import json
import re
import socket
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "card-data"
IMAGE_DIR = ROOT / "card-images"
REPORT = ROOT / "card-library-report.txt"
USER_AGENT = "CardCrateClub-LocalLibrary/2.1"
MAX_WORKERS = 12
TIMEOUT = 12
TRANSIENT_RETRIES = 2


def safe_id(value):
    text = str(value or "").strip()
    return re.sub(r"[^A-Za-z0-9._-]+", "-", text) or "unknown"


def id_variants(value):
    """Return TCGdex-compatible ID variants, padded form first."""
    raw = str(value or "").strip()
    variants = []
    if raw.isdigit():
        variants.append(raw.zfill(3))
    if raw and raw not in variants:
        variants.append(raw)
    return variants


def candidates(set_id, card):
    """Return deduplicated plausible low-res image URLs."""
    base = str(card.get("image") or "").rstrip("/")
    local_id = str(card.get("localId") or "").strip()
    bases = []

    # The stored JSON was generated with unpadded IDs (1, 2, ... 99), while
    # TCGdex artwork paths use 001, 002, ... 099. Rebuild the canonical asset
    # URL from the set/local ID first, then retain the stored URL as fallback.
    for variant in id_variants(local_id):
        bases.append(f"https://assets.tcgdex.net/en/me/{set_id}/{variant}")
    if base:
        bases.append(base)

    out = []
    seen = set()
    for b in bases:
        url = f"{b}/low.webp"
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out


def fetch_bytes(url):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "image/webp,image/*"},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as response:
        body = response.read()
    if len(body) < 1000:
        raise ValueError("download was unexpectedly small")
    return body


def try_url(url):
    """Fetch once on permanent errors; retry only temporary network/server errors."""
    for attempt in range(TRANSIENT_RETRIES + 1):
        try:
            return fetch_bytes(url), None
        except urllib.error.HTTPError as exc:
            if exc.code in (404, 410):
                return None, f"HTTP {exc.code}"
            if exc.code not in (408, 425, 429, 500, 502, 503, 504):
                return None, f"HTTP {exc.code}"
            last = f"HTTP {exc.code}"
        except (urllib.error.URLError, socket.timeout, TimeoutError) as exc:
            last = str(exc)
        except Exception as exc:
            return None, str(exc)

        if attempt < TRANSIENT_RETRIES:
            time.sleep(0.35 * (attempt + 1))
    return None, last


def download_card(set_id, card, set_dir):
    local_id = safe_id(card.get("localId"))
    dest = set_dir / f"{local_id}.webp"
    if dest.exists() and dest.stat().st_size > 1000:
        return local_id, True, "already local"

    last_error = "no image URL"
    for url in candidates(set_id, card):
        body, error = try_url(url)
        if body:
            temp = dest.with_suffix(".tmp")
            temp.write_bytes(body)
            temp.replace(dest)
            return local_id, True, "saved"
        last_error = error or last_error
    return local_id, False, last_error


def selected_json_files():
    requested = [safe_id(value) for value in sys.argv[1:] if str(value).strip()]
    if requested:
        files = [DATA_DIR / f"{set_id}.json" for set_id in requested]
        missing = [path.name for path in files if not path.exists()]
        if missing:
            raise SystemExit(f"Missing card-data file(s): {', '.join(missing)}")
        return files
    return sorted(DATA_DIR.glob("*.json"))


def main():
    IMAGE_DIR.mkdir(exist_ok=True)
    json_files = selected_json_files()
    if not json_files:
        raise SystemExit("No card-data JSON files found")

    set_summaries = []
    missing_lines = []
    total_cards = 0
    total_ok = 0

    for json_path in json_files:
        set_id = json_path.stem
        data = json.loads(json_path.read_text(encoding="utf-8"))
        cards = data.get("cards") or []
        total_cards += len(cards)
        set_dir = IMAGE_DIR / set_id
        set_dir.mkdir(parents=True, exist_ok=True)
        set_ok = 0

        print(f"\n=== {set_id}: {len(cards)} cards; {MAX_WORKERS} workers ===", flush=True)
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = {
                pool.submit(download_card, set_id, card, set_dir): (index, card)
                for index, card in enumerate(cards, 1)
            }
            completed = 0
            for future in as_completed(futures):
                index, card = futures[future]
                completed += 1
                local_id, success, status = future.result()
                name = card.get("name") or local_id
                if success:
                    set_ok += 1
                    total_ok += 1
                    card["localImage"] = f"card-images/{set_id}/{local_id}.webp"
                else:
                    card["localImage"] = ""
                    missing_lines.append(f"MISSING {set_id} #{local_id} {name} ({status})")
                print(f"[{completed}/{len(cards)}] #{local_id} {name}: {status}", flush=True)

        json_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        set_summaries.append(f"{set_id}: {set_ok}/{len(cards)} artwork files local")
        print(f"{set_id} finished: {set_ok}/{len(cards)} local", flush=True)

    header = [
        "CARD CRATE CLUB — LOCAL CARD LIBRARY REPORT",
        f"Total: {total_ok}/{total_cards} artwork files local",
        "",
    ]
    REPORT.write_text("\n".join(header + set_summaries + [""] + missing_lines) + "\n", encoding="utf-8")
    print(f"\nFinished: {total_ok}/{total_cards} images local", flush=True)


if __name__ == "__main__":
    main()
