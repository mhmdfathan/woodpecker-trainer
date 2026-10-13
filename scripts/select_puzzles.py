"""Step 0: select the fixed 50-puzzle set from the Lichess open puzzle database.

Run once, offline from the app:

    python scripts/select_puzzles.py

Downloads (and caches) the ~250 MB zstd-compressed database, streams it through
decompression without ever writing the ~900 MB CSV to disk, applies the SPEC.md
filters, and writes src/puzzles.json.

The download is cached under scripts/data/ (gitignored) so re-runs are instant.
Pass --refresh to force a fresh download.
"""

import csv
import heapq
import io
import json
import sys
import urllib.request
from pathlib import Path

import zstandard

DB_URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst"

REPO_ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = REPO_ROOT / "scripts" / "data" / "lichess_db_puzzle.csv.zst"
OUTPUT = REPO_ROOT / "src" / "puzzles.json"

# SPEC.md filters
MIN_RATING = 1500
MAX_RATING = 1800
MIN_NB_PLAYS = 500
PUZZLE_COUNT = 50

# CSV is huge; some fields are long enough to trip the default field size limit.
csv.field_size_limit(10_000_000)


def download(url: str, dest: Path) -> None:
    """Stream the database to dest, printing progress."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = dest.with_suffix(dest.suffix + ".part")

    # A UA is polite and avoids any default-agent blocking.
    request = urllib.request.Request(url, headers={"User-Agent": "woodpecker-trainer/0.1"})
    with urllib.request.urlopen(request) as response, partial.open("wb") as out:
        total = int(response.headers.get("Content-Length") or 0)
        seen = 0
        last_report = 0
        while chunk := response.read(1 << 20):
            out.write(chunk)
            seen += len(chunk)
            if seen - last_report >= 25 << 20:  # report every 25 MB
                last_report = seen
                if total:
                    print(f"  {seen >> 20} / {total >> 20} MB ({seen * 100 // total}%)", flush=True)
                else:
                    print(f"  {seen >> 20} MB", flush=True)

    partial.replace(dest)
    print(f"  done: {dest.stat().st_size >> 20} MB", flush=True)


def has_underpromotion(moves: list[str]) -> bool:
    """True if any UCI move promotes to knight, bishop or rook.

    Engineering exclusion, not a difficulty choice: it lets v1 skip an
    underpromotion picker. A promotion move is 5 chars (e7e8q); the 5th char is
    the promotion piece, so plain moves like e2e4 can never match.
    """
    return any(len(move) == 5 and move[4] in "nbr" for move in moves)


def select(archive: Path) -> list[dict]:
    """Stream the CSV and return the top PUZZLE_COUNT puzzles."""
    # Min-heap capped at PUZZLE_COUNT so we never hold 5M rows in memory.
    # Key is (popularity, nb_plays) — heap pops the weakest, matching a
    # "sort by popularity desc, tiebreak plays desc" ranking.
    heap: list[tuple[int, int, int, dict]] = []
    rows_read = 0
    kept = 0
    # Tiebreaker for rows whose key is identical, so dicts are never compared.
    counter = 0

    decompressor = zstandard.ZstdDecompressor()
    with archive.open("rb") as raw, decompressor.stream_reader(raw) as stream:
        text = io.TextIOWrapper(stream, encoding="utf-8", newline="")
        for row in csv.DictReader(text):
            rows_read += 1
            if rows_read % 1_000_000 == 0:
                print(f"  scanned {rows_read // 1_000_000}M rows, {kept} eligible", flush=True)

            try:
                rating = int(row["Rating"])
                popularity = int(row["Popularity"])
                nb_plays = int(row["NbPlays"])
            except (TypeError, ValueError):
                continue  # malformed row

            if not MIN_RATING <= rating <= MAX_RATING:
                continue
            if nb_plays < MIN_NB_PLAYS:
                continue

            moves = row["Moves"].split()
            if has_underpromotion(moves):
                continue

            kept += 1
            counter += 1
            entry = {
                "id": row["PuzzleId"],
                "fen": row["FEN"],
                "moves": moves,
                "rating": rating,
                "themes": row["Themes"].split(),
            }
            item = (popularity, nb_plays, counter, entry)
            if len(heap) < PUZZLE_COUNT:
                heapq.heappush(heap, item)
            elif item > heap[0]:
                heapq.heapreplace(heap, item)

    print(f"  scanned {rows_read} rows, {kept} eligible", flush=True)
    # Strongest first.
    ranked = sorted(heap, key=lambda item: (item[0], item[1]), reverse=True)
    return [entry for _, _, _, entry in ranked]


def verify(puzzles: list[dict]) -> None:
    """SPEC.md step 0 check: 50 entries, ratings in band, no underpromotions."""
    assert len(puzzles) == PUZZLE_COUNT, f"expected {PUZZLE_COUNT} puzzles, got {len(puzzles)}"
    assert len({p["id"] for p in puzzles}) == PUZZLE_COUNT, "duplicate puzzle ids"
    for p in puzzles:
        assert MIN_RATING <= p["rating"] <= MAX_RATING, f"{p['id']} rating {p['rating']} out of band"
        assert not has_underpromotion(p["moves"]), f"{p['id']} has an underpromotion"
        assert len(p["moves"]) >= 2, f"{p['id']} has too few moves"
    print(f"  verified {len(puzzles)} puzzles", flush=True)


def main() -> int:
    refresh = "--refresh" in sys.argv

    if refresh or not ARCHIVE.exists():
        print(f"Downloading {DB_URL}", flush=True)
        download(DB_URL, ARCHIVE)
    else:
        print(f"Using cached {ARCHIVE} ({ARCHIVE.stat().st_size >> 20} MB)", flush=True)

    print("Scanning database", flush=True)
    puzzles = select(ARCHIVE)

    print("Verifying", flush=True)
    verify(puzzles)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(puzzles, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT}", flush=True)

    ratings = [p["rating"] for p in puzzles]
    print(f"  rating range {min(ratings)}-{max(ratings)}", flush=True)
    print(f"  first puzzle {puzzles[0]['id']}, last {puzzles[-1]['id']}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
