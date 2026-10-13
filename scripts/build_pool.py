"""Build the local puzzle pool that in-app set building draws from.

    python scripts/build_pool.py

Reads the same cached Lichess database as select_puzzles.py and writes
src/pool.json: ~10,000 puzzles spread across rating bands and tactical themes,
so a set request like "300 endgame puzzles rated 1500-1800" can actually be
satisfied offline.

Taking the globally most popular 10,000 would bunch up around one rating and a
handful of flashy themes, so selection runs in two passes:

1. Theme quota — for every (theme, 200-point rating band) pair, keep the most
   popular QUOTA puzzles. This guarantees depth where a user is likely to filter.
2. Popularity fill — top up with the most popular remaining puzzles until the
   pool reaches POOL_SIZE.

The 50 puzzles of the original committed set are force-included, so the default
program's ids always resolve against the pool.
"""

import csv
import heapq
import io
import json
from pathlib import Path

import zstandard

REPO_ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = REPO_ROOT / "scripts" / "data" / "lichess_db_puzzle.csv.zst"
DEFAULT_SET = REPO_ROOT / "src" / "puzzles.json"
OUTPUT = REPO_ROOT / "src" / "pool.json"

POOL_SIZE = 10_000
MIN_RATING = 800
MAX_RATING = 2600
MIN_NB_PLAYS = 500
BAND = 200
QUOTA = 30

# Themes worth training deliberately. Rare mate patterns are included even though
# they will not fill their quota — a handful is still better than none.
THEMES = [
    "fork", "pin", "skewer", "discoveredAttack", "doubleCheck", "deflection",
    "attraction", "clearance", "interference", "xRayAttack", "zugzwang",
    "quietMove", "sacrifice", "trappedPiece", "hangingPiece", "capturingDefender",
    "defensiveMove", "advancedPawn", "promotion", "backRankMate", "smotheredMate",
    "arabianMate", "hookMate", "anastasiaMate", "doubleBishopMate", "bodenMate",
    "mateIn1", "mateIn2", "mateIn3", "mateIn4", "mateIn5",
    "pawnEndgame", "rookEndgame", "queenEndgame", "bishopEndgame", "knightEndgame",
    "queenRookEndgame", "kingsideAttack", "queensideAttack", "exposedKing",
    "opening", "middlegame", "endgame",
]
THEME_SET = set(THEMES)

csv.field_size_limit(10_000_000)


def has_underpromotion(moves):
    return any(len(move) == 5 and move[4] in "nbr" for move in moves)


def band_of(rating):
    return (rating - MIN_RATING) // BAND


def scan(archive):
    """One pass over the database, filling per-(theme, band) heaps and a global heap."""
    buckets = {}
    overall = []
    counter = 0
    rows = 0

    decompressor = zstandard.ZstdDecompressor()
    with archive.open("rb") as raw, decompressor.stream_reader(raw) as stream:
        text = io.TextIOWrapper(stream, encoding="utf-8", newline="")
        for row in csv.DictReader(text):
            rows += 1
            if rows % 1_000_000 == 0:
                print(f"  scanned {rows // 1_000_000}M rows", flush=True)

            try:
                rating = int(row["Rating"])
                popularity = int(row["Popularity"])
                nb_plays = int(row["NbPlays"])
            except (TypeError, ValueError):
                continue

            if not MIN_RATING <= rating <= MAX_RATING or nb_plays < MIN_NB_PLAYS:
                continue

            moves = row["Moves"].split()
            if has_underpromotion(moves):
                continue

            themes = row["Themes"].split()
            counter += 1
            entry = {
                "id": row["PuzzleId"],
                "fen": row["FEN"],
                "moves": moves,
                "rating": rating,
                "themes": themes,
            }
            # counter breaks ties so heapq never compares the dicts themselves.
            item = (popularity, nb_plays, counter, entry)

            if len(overall) < POOL_SIZE:
                heapq.heappush(overall, item)
            elif item > overall[0]:
                heapq.heapreplace(overall, item)

            band = band_of(rating)
            for theme in themes:
                if theme not in THEME_SET:
                    continue
                key = (theme, band)
                heap = buckets.get(key)
                if heap is None:
                    buckets[key] = [item]
                    heapq.heapify(buckets[key])
                elif len(heap) < QUOTA:
                    heapq.heappush(heap, item)
                elif item > heap[0]:
                    heapq.heapreplace(heap, item)

    print(f"  scanned {rows} rows", flush=True)
    return buckets, overall


def main():
    if not ARCHIVE.exists():
        raise SystemExit(f"Missing {ARCHIVE}. Run scripts/select_puzzles.py first to download it.")

    print(f"Using cached {ARCHIVE} ({ARCHIVE.stat().st_size >> 20} MB)", flush=True)
    buckets, overall = scan(ARCHIVE)

    # Pass 1: everything the theme quotas reserved.
    chosen = {}
    ranks = {}
    for heap in buckets.values():
        for popularity, nb_plays, _, entry in heap:
            chosen[entry["id"]] = entry
            ranks[entry["id"]] = (popularity, nb_plays)
    print(f"Theme quota kept {len(chosen)} unique puzzles across {len(buckets)} buckets", flush=True)

    # Pass 2: fill the rest with the most popular puzzles overall.
    for popularity, nb_plays, _, entry in sorted(overall, key=lambda i: (i[0], i[1]), reverse=True):
        if len(chosen) >= POOL_SIZE:
            break
        if entry["id"] not in chosen:
            chosen[entry["id"]] = entry
            ranks[entry["id"]] = (popularity, nb_plays)
    print(f"After popularity fill: {len(chosen)}", flush=True)

    # The committed default set must always resolve against the pool.
    default_ids = [p["id"] for p in json.loads(DEFAULT_SET.read_text(encoding="utf-8"))]
    added = 0
    for puzzle in json.loads(DEFAULT_SET.read_text(encoding="utf-8")):
        if puzzle["id"] not in chosen:
            chosen[puzzle["id"]] = puzzle
            ranks[puzzle["id"]] = (0, 0)
            added += 1
    if added:
        print(f"Force-included {added} puzzles from the default set", flush=True)

    # Popularity order, so a set built by taking the first N of a filtered list
    # is "most popular first" exactly like the original 50.
    pool = sorted(chosen.values(), key=lambda e: (ranks[e["id"]], e["id"]), reverse=True)

    assert len({p["id"] for p in pool}) == len(pool), "duplicate ids in pool"
    for puzzle in pool:
        assert MIN_RATING <= puzzle["rating"] <= MAX_RATING, f"{puzzle['id']} out of rating band"
        assert not has_underpromotion(puzzle["moves"]), f"{puzzle['id']} has an underpromotion"
    missing = [i for i in default_ids if i not in chosen]
    assert not missing, f"default set ids missing from pool: {missing}"

    OUTPUT.write_text(json.dumps(pool, separators=(",", ":")) + "\n", encoding="utf-8")

    ratings = [p["rating"] for p in pool]
    print(f"Wrote {OUTPUT}: {len(pool)} puzzles, {OUTPUT.stat().st_size >> 10} KB", flush=True)
    print(f"  rating range {min(ratings)}-{max(ratings)}", flush=True)

    per_band = {}
    for puzzle in pool:
        low = MIN_RATING + band_of(puzzle["rating"]) * BAND
        per_band[low] = per_band.get(low, 0) + 1
    print("  per rating band: " + "  ".join(f"{k}-{k + BAND - 1}:{v}" for k, v in sorted(per_band.items())), flush=True)

    counts = {}
    for puzzle in pool:
        for theme in puzzle["themes"]:
            counts[theme] = counts.get(theme, 0) + 1
    top = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
    print(f"  {len(counts)} distinct themes; most common: " + "  ".join(f"{t}:{n}" for t, n in top[:12]), flush=True)
    thin = [f"{t}:{counts.get(t, 0)}" for t in THEMES if counts.get(t, 0) < 100]
    if thin:
        print("  thin themes (<100): " + "  ".join(thin), flush=True)


if __name__ == "__main__":
    main()
