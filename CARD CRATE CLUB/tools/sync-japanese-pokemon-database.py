#!/usr/bin/env python3
"""Build Card Crate Club's Japanese Pokemon TCG search/import index.

Source: TCGdex multilingual API (Japanese language endpoint).
Output: card-data/all-cards-index-ja.json

This intentionally stays separate from the English index so language-specific
IDs and set naming do not collide. Search/import code can merge the two at
runtime while still knowing which language each record came from.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import json
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "card-data"
INDEX_FILE = DATA_DIR / "all-cards-index-ja.json"
REPORT_FILE = DATA_DIR / "database-report-ja.json"
API_URL = "https://api.tcgdex.net/v2/ja/cards"


def fetch_json(url: str, attempts: int = 4):
    last_error = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Card-Crate-Club-Database-Sync/1.0"})
            with urllib.request.urlopen(req, timeout=45) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt < attempts - 1:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"Could not fetch Japanese card catalog: {last_error}")


def infer_set_id(card_id: str) -> str:
    if not card_id:
        return ""
    if "-" in card_id:
        return card_id.rsplit("-", 1)[0]
    return ""


def image_url(base: str, quality: str = "low") -> str:
    if not base:
        return ""
    base = base.rstrip("/")
    # TCGdex image values are extensionless asset URLs.
    return f"{base}/{quality}.webp"


def normalize_card(card: dict) -> dict:
    card_id = str(card.get("id") or "")
    local_id = str(card.get("localId") or card.get("number") or "")
    set_id = str((card.get("set") or {}).get("id") or card.get("setId") or infer_set_id(card_id))
    set_name = str((card.get("set") or {}).get("name") or card.get("setName") or set_id)
    image = str(card.get("image") or "")
    return {
        "id": f"ja:{card_id}",
        "sourceId": card_id,
        "name": card.get("name") or "",
        "setId": set_id,
        "setName": set_name,
        "number": local_id,
        "rarity": card.get("rarity") or "",
        "supertype": card.get("category") or card.get("supertype") or "",
        "image": image_url(image, "low"),
        "imageLarge": image_url(image, "high"),
        "language": "ja",
        "source": "tcgdex",
    }


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = fetch_json(API_URL)
    if isinstance(payload, dict):
        raw_cards = payload.get("cards") or payload.get("data") or []
    else:
        raw_cards = payload
    if not isinstance(raw_cards, list) or not raw_cards:
        raise SystemExit("TCGdex Japanese cards endpoint returned no cards")

    cards = [normalize_card(card) for card in raw_cards if isinstance(card, dict)]
    cards = [card for card in cards if card.get("sourceId") and card.get("name")]
    cards.sort(key=lambda c: ((c.get("name") or ""), c.get("setId") or "", c.get("number") or ""))

    INDEX_FILE.write_text(
        json.dumps({"language": "ja", "source": "TCGdex", "cards": cards}, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    REPORT_FILE.write_text(
        json.dumps({
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "source": "TCGdex",
            "language": "ja",
            "cards": len(cards),
            "cardIndex": "card-data/all-cards-index-ja.json",
        }, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Generated {len(cards):,} Japanese cards")
    print(f"Japanese search/import index: {INDEX_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
