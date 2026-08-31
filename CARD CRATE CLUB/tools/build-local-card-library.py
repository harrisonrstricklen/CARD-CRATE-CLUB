#!/usr/bin/env python3
"""Build Card Crate Club's local artwork library from existing card-data JSON files.

The script reads CARD CRATE CLUB/card-data/*.json, downloads one compact WebP
image for each card, and stores it under card-images/<set>/<localId>.webp.
It is resume-safe: existing non-empty images are skipped.

Pass one or more set IDs on the command line to process only those sets, e.g.:
    python build-local-card-library.py me01 me02
"""
from pathlib import Path
import json
import re
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "card-data"
IMAGE_DIR = ROOT / "card-images"
REPORT = ROOT / "card-library-report.txt"
USER_AGENT = "CardCrateClub-LocalLibrary/1.0"


def safe_id(value):
    text = str(value or "").strip()
    return re.sub(r"[^A-Za-z0-9._-]+", "-", text) or "unknown"


def candidates(set_id, card):
    base = str(card.get("image") or "").rstrip("/")
    local_id = str(card.get("localId") or "").strip()
    card_id = str(card.get("id") or "").strip()
    bases = []
    if base:
        bases.append(base)
    if local_id:
        bases.append(f"https://assets.tcgdex.net/en/me/{set_id}/{local_id}")
    if card_id and card_id != local_id:
        bases.append(f"https://assets.tcgdex.net/en/me/{set_id}/{card_id}")

    out, seen = [], set()
    for b in bases:
        if not b or b in seen:
            continue
        seen.add(b)
        out.extend([
            f"{b}/low.webp",
            f"{b}/high.webp",
        ])
    return out


def download(url, dest):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "image/webp,image/*"},
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read()
    if len(body) < 1000:
        raise ValueError("download was unexpectedly small")
    dest.write_bytes(body)


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

    report = []
    total_cards = total_ok = 0

    for json_path in json_files:
        set_id = json_path.stem
        data = json.loads(json_path.read_text(encoding="utf-8"))
        cards = data.get("cards") or []
        set_dir = IMAGE_DIR / set_id
        set_dir.mkdir(parents=True, exist_ok=True)
        set_ok = 0

        print(f"\n=== {set_id}: {len(cards)} cards ===", flush=True)
        for index, card in enumerate(cards, 1):
            total_cards += 1
            local_id = safe_id(card.get("localId"))
            dest = set_dir / f"{local_id}.webp"
            name = card.get("name") or local_id

            if dest.exists() and dest.stat().st_size > 1000:
                set_ok += 1
                total_ok += 1
                print(f"[{index}/{len(cards)}] {name}: already local", flush=True)
                card["localImage"] = f"card-images/{set_id}/{local_id}.webp"
                continue

            success = False
            for url in candidates(set_id, card):
                for attempt in range(3):
                    try:
                        download(url, dest)
                        success = True
                        break
                    except Exception as exc:
                        if dest.exists():
                            dest.unlink(missing_ok=True)
                        print(
                            f"[{index}/{len(cards)}] {name}: retry {attempt + 1} ({exc})",
                            flush=True,
                        )
                        time.sleep(1 + attempt)
                if success:
                    break

            if success:
                set_ok += 1
                total_ok += 1
                card["localImage"] = f"card-images/{set_id}/{local_id}.webp"
                print(f"[{index}/{len(cards)}] {name}: saved", flush=True)
            else:
                card["localImage"] = ""
                report.append(f"MISSING {set_id} #{local_id} {name}")
                print(f"[{index}/{len(cards)}] {name}: MISSING", flush=True)

            time.sleep(0.05)

        json_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        report.insert(0, f"{set_id}: {set_ok}/{len(cards)} artwork files local")

    header = [
        "CARD CRATE CLUB — LOCAL CARD LIBRARY REPORT",
        f"Total: {total_ok}/{total_cards} artwork files local",
        "",
    ]
    REPORT.write_text("\n".join(header + report) + "\n", encoding="utf-8")
    print(f"\nFinished: {total_ok}/{total_cards} images local", flush=True)


if __name__ == "__main__":
    main()
