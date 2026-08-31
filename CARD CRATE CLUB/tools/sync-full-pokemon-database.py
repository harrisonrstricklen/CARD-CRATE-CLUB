#!/usr/bin/env python3
"""Build Card Crate Club's complete English Pokemon TCG card database.

Source data is the public PokemonTCG/pokemon-tcg-data repository, cloned by the
GitHub Action before this script runs. The existing hand-managed/current
card-data files are intentionally left untouched.

Output:
  card-data/all-sets/index.json          compact set catalog
  card-data/all-sets/<set-id>.json      normalized cards for each English set
  card-data/all-cards-index.json        compact searchable index for imports
  card-data/database-report.json        counts/source metadata
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import json
import shutil
import sys

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "card-data"
FULL_DIR = DATA_DIR / "all-sets"
INDEX_FILE = DATA_DIR / "all-cards-index.json"
REPORT_FILE = DATA_DIR / "database-report.json"


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def clean(value):
    return value if value not in (None, "") else None


def normalize_card(card: dict, set_info: dict) -> dict:
    images = card.get("images") or {}
    tcgplayer = card.get("tcgplayer") or {}
    cardmarket = card.get("cardmarket") or {}

    return {
        "id": card.get("id"),
        "name": card.get("name"),
        "setId": set_info.get("id"),
        "setName": set_info.get("name"),
        "series": set_info.get("series"),
        "number": card.get("number"),
        "supertype": card.get("supertype"),
        "subtypes": card.get("subtypes") or [],
        "types": card.get("types") or [],
        "rarity": clean(card.get("rarity")),
        "artist": clean(card.get("artist")),
        "hp": clean(card.get("hp")),
        "regulationMark": clean(card.get("regulationMark")),
        "nationalPokedexNumbers": card.get("nationalPokedexNumbers") or [],
        "legalities": card.get("legalities") or {},
        "image": images.get("small") or images.get("large") or "",
        "imageLarge": images.get("large") or images.get("small") or "",
        "tcgplayerUrl": tcgplayer.get("url") or "",
        "cardmarketUrl": cardmarket.get("url") or "",
    }


def compact_index_card(card: dict) -> dict:
    return {
        "id": card.get("id"),
        "name": card.get("name"),
        "setId": card.get("setId"),
        "setName": card.get("setName"),
        "number": card.get("number"),
        "rarity": card.get("rarity"),
        "supertype": card.get("supertype"),
        "image": card.get("image"),
    }


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: sync-full-pokemon-database.py /path/to/pokemon-tcg-data")

    upstream = Path(sys.argv[1]).resolve()
    sets_path = upstream / "sets" / "en.json"
    cards_dir = upstream / "cards" / "en"
    if not sets_path.exists() or not cards_dir.is_dir():
        raise SystemExit(f"Invalid pokemon-tcg-data checkout: {upstream}")

    sets = read_json(sets_path)
    set_lookup = {str(s.get("id")): s for s in sets if s.get("id")}

    # Rebuild only the generated full-database directory. The site's existing
    # current-set files in card-data/ remain untouched.
    if FULL_DIR.exists():
        shutil.rmtree(FULL_DIR)
    FULL_DIR.mkdir(parents=True, exist_ok=True)

    set_catalog = []
    all_index_cards = []
    total_cards = 0
    generated_sets = 0
    missing_set_metadata = []

    for cards_path in sorted(cards_dir.glob("*.json")):
        raw_cards = read_json(cards_path)
        if not isinstance(raw_cards, list):
            continue

        set_id = cards_path.stem
        set_info = set_lookup.get(set_id)
        if not set_info:
            # Keep cards usable even if upstream set metadata temporarily lags.
            set_info = {
                "id": set_id,
                "name": set_id,
                "series": "Unknown",
                "printedTotal": len(raw_cards),
                "total": len(raw_cards),
                "releaseDate": "",
                "images": {},
            }
            missing_set_metadata.append(set_id)

        cards = [normalize_card(card, set_info) for card in raw_cards]
        cards = [card for card in cards if card.get("id") and card.get("name")]

        set_doc = {
            "id": set_id,
            "name": set_info.get("name") or set_id,
            "series": set_info.get("series") or "",
            "releaseDate": set_info.get("releaseDate") or "",
            "printedTotal": set_info.get("printedTotal"),
            "total": set_info.get("total") or len(cards),
            "images": set_info.get("images") or {},
            "cards": cards,
        }
        (FULL_DIR / f"{set_id}.json").write_text(
            json.dumps(set_doc, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )

        set_catalog.append({
            "id": set_id,
            "name": set_doc["name"],
            "series": set_doc["series"],
            "releaseDate": set_doc["releaseDate"],
            "printedTotal": set_doc["printedTotal"],
            "total": len(cards),
            "images": set_doc["images"],
            "dataFile": f"card-data/all-sets/{set_id}.json",
        })
        all_index_cards.extend(compact_index_card(card) for card in cards)
        total_cards += len(cards)
        generated_sets += 1

    set_catalog.sort(key=lambda s: (s.get("releaseDate") or "", s.get("name") or ""), reverse=True)
    all_index_cards.sort(key=lambda c: ((c.get("name") or "").lower(), c.get("setId") or "", c.get("number") or ""))

    (FULL_DIR / "index.json").write_text(
        json.dumps({"sets": set_catalog}, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    INDEX_FILE.write_text(
        json.dumps({"cards": all_index_cards}, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "PokemonTCG/pokemon-tcg-data",
        "language": "en",
        "sets": generated_sets,
        "cards": total_cards,
        "missingSetMetadata": missing_set_metadata,
        "setCatalog": "card-data/all-sets/index.json",
        "cardIndex": "card-data/all-cards-index.json",
    }
    REPORT_FILE.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    print(f"Generated {total_cards:,} cards across {generated_sets:,} English sets")
    print(f"Search/import index: {INDEX_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
