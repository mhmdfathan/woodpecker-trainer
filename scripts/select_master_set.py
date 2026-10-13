"""Build the first accessible master-game Woodpecker set from the committed pool.

The pool is already derived from the Lichess open puzzle database. This recipe
keeps master/GM provenance while selecting shorter, lower-rated tactical lines
for players roughly in the 100-1000 Elo learning range.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POOL = ROOT / "src" / "pool.json"
OUTPUT = ROOT / "src" / "puzzles.json"
COUNT = 100

ACCESSIBLE = {
    "oneMove", "mateIn1", "mateIn2", "short", "fork", "pin", "skewer",
    "hangingPiece", "discoveredAttack", "deflection", "attraction",
    "capturingDefender", "intermezzo", "clearance", "endgame", "advantage",
}
BUCKETS = [
    {"oneMove", "mateIn1", "mateIn2"},
    {"fork", "pin", "skewer", "hangingPiece"},
    {"discoveredAttack", "deflection", "attraction", "capturingDefender", "intermezzo"},
    {"endgame", "advantage"},
]


def underpromotion(moves):
    return any(len(move) == 5 and move[4] in "nbr" for move in moves)


def rank(row):
    themes = set(row["themes"])
    # Prefer accessible motifs and short lines, while keeping a slight spread
    # through the 800-1400 band instead of selecting only the easiest puzzles.
    score = len(themes & ACCESSIBLE) * 20
    score += 15 if "masterVsMaster" in themes else 0
    score += 12 if "short" in themes else 0
    score += max(0, 18 - abs(row["rating"] - 1000) // 20)
    score -= max(0, len(row["moves"]) - 4) * 4
    return (-score, row["rating"], row["id"])


def main():
    pool = json.loads(POOL.read_text(encoding="utf-8"))
    candidates = [
        row for row in pool
        if ("master" in row["themes"] or "masterVsMaster" in row["themes"])
        and 800 <= row["rating"] <= 1400
        and len(row["moves"]) <= 8
        and "long" not in row["themes"]
        and "veryLong" not in row["themes"]
        and not underpromotion(row["moves"])
    ]
    candidates.sort(key=rank)

    chosen = []
    chosen_ids = set()
    # Round-robin motif buckets so the set teaches patterns, not just mates.
    per_bucket = COUNT // len(BUCKETS)
    for bucket in BUCKETS:
        bucket_count = 0
        for row in candidates:
            if row["id"] in chosen_ids or not (set(row["themes"]) & bucket):
                continue
            chosen.append(row)
            chosen_ids.add(row["id"])
            bucket_count += 1
            if bucket_count >= per_bucket:
                break

    for row in candidates:
        if len(chosen) >= COUNT:
            break
        if row["id"] not in chosen_ids:
            chosen.append(row)
            chosen_ids.add(row["id"])

    if len(chosen) != COUNT:
        raise RuntimeError(f"expected {COUNT} puzzles, got {len(chosen)}")
    if len(chosen_ids) != COUNT:
        raise RuntimeError("duplicate puzzle ids")

    OUTPUT.write_text(json.dumps(chosen, indent=2) + "\n", encoding="utf-8")
    ratings = [row["rating"] for row in chosen]
    print(f"wrote {OUTPUT}")
    print(f"count={len(chosen)} rating={min(ratings)}-{max(ratings)}")
    print(f"master provenance={sum('master' in row['themes'] or 'masterVsMaster' in row['themes'] for row in chosen)}")


if __name__ == "__main__":
    main()
