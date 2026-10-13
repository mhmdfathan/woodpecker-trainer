# Woodpecker — chess puzzle cycle trainer (v1 spec)

A personal training PWA implementing the Woodpecker Method: solve the same fixed set
of 50 puzzles in repeated timed cycles, trying to get faster and more accurate each
cycle. Single user, no accounts, no server. All state in localStorage. Deployed as a
static site (GitHub Pages) and installable to a phone home screen.

This spec is the contract. Implement it step by step (see Build order). Do not add
features that are not in scope. When a detail is ambiguous, prefer the simplest
implementation and flag the decision in a code comment.

## Scope

**In v1:**
- Named **programs** — save files. Each owns a fixed puzzle set, a target time, its
  in-flight cycle and its own history; switching between them touches nothing else.
  A program's set is fixed at creation and always presented in the same order.
- A set builder: choose a size, a rating range and any mix of themes, drawn from a
  10,000-puzzle pool that ships with the app.
- Count-up stopwatch per cycle, compared against a single standing target time set
  by the user. The target is informational only — never stop or interrupt a cycle.
- Instant fail on a wrong move (see Solve rules), with the intended line shown
  briefly before advancing.
- Save/resume mid-cycle: closing the app and reopening resumes at the same puzzle
  with the same accumulated clock time.
- Cycle history with per-puzzle time splits and miss lists.
- Post-cycle untimed review pass over that cycle's misses.
- PWA: installable, works offline after first load.

**Explicitly out of v1 (do not build):** order shuffling, charts, spaced repetition,
Lichess login/API calls at runtime, export/import, sound, hints, retries.

## Stack

- Vite, vanilla JavaScript, no framework. Three screens managed by showing/hiding
  DOM sections.
- `chessground` (the actual lichess.org board component) for the board UI.
- `chess.js` for move legality, checkmate detection, and FEN handling.
- Board look: chessground's stock assets from the npm package — base CSS, the brown
  board theme, and the cburnett piece set. The board must look and feel like
  lichess.org's default. Chessground's own drawing layer stays enabled, so
  right-click highlights squares and right-drag draws arrows exactly as on
  lichess. Shapes clear whenever the position changes.
- One deliberate departure from lichess: arrows that trace a knight's move are
  drawn bent, two squares then one, rather than as a straight diagonal.
  Chessground can only draw straight arrows, so those shapes are claimed by an
  overlay (`src/knight-arrows.js`) sharing its SVG coordinate space.
- Everything else (timer, counters, screens) is minimal custom UI. Clean, quiet,
  mobile-first: the Practice screen is essentially just the board, the clock, and a
  puzzle counter.

## Puzzle data

### Source (step 0, run once, offline from the app)

The Lichess open puzzle database: `https://database.lichess.org/lichess_db_puzzle.csv.zst`
(~250 MB compressed, ~900 MB decompressed, ~5M rows; requires zstd to decompress).

CSV columns:
`PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags`

Selection script (Python or Node, in `scripts/`):
1. Filter: `1500 <= Rating <= 1800`.
2. Engineering exclusions (not difficulty choices): drop puzzles whose Moves contain
   a non-queen promotion (any UCI move ending in `n`, `b`, or `r`), so v1 needs no
   underpromotion UI. Drop rows with fewer than, say, 500 NbPlays to avoid noisy
   popularity scores.
3. Sort by Popularity desc, tiebreak NbPlays desc. Take the top 50.
4. Write `src/puzzles.json` as an array of:
   `{ "id", "fen", "moves": ["e8d7", ...], "rating", "themes": [...] }`
   (Moves and Themes are space-separated in the CSV — split them.)

The raw CSV is `.gitignore`d but cached under `scripts/data/`, so re-runs need no
download. `puzzles.json` is committed. The database is never touched again at
runtime; the app ships fully self-contained.

### Pool (step 0b, `scripts/build_pool.py`)

In-app set building needs more than 50 puzzles to choose from, so a second script
writes `src/pool.json`: 10,000 puzzles, ratings 800–2600, same engineering
exclusions. Taking the globally most popular 10,000 would bunch around one rating
and a few themes, so selection runs two passes — a per-(theme, 200-point band)
quota first, then a popularity fill to reach 10,000. The committed 50 are
force-included so the default program's ids always resolve.

The pool is popularity-ordered, so taking the first N of any filtered view means
"most popular first", matching how the original 50 were chosen. Programs store
only puzzle **ids**; the objects are looked up in the pool at runtime.

### Format semantics (critical)

In every Lichess puzzle, `fen` is the position **before** the opponent's last move,
and `moves[0]` is that opponent move. The app must load the FEN, auto-play
`moves[0]` with animation, and only then start the clock and accept input. The
solver plays `moves[1]`, the app auto-plays `moves[2]` as the opponent's reply, and
so on, alternating. The solver's color is whoever is to move after `moves[0]` —
orient the board with that color at the bottom.

## Solve rules

1. A move is first checked for legality (chess.js). Illegal moves are simply
   rejected by the board (chessground handles this when fed legal destinations).
2. A legal move is compared (as UCI) to the next expected solution move.
3. **Match:** if more solver moves remain, auto-play the opponent's reply and wait.
   If it was the last move, the puzzle is solved — stamp the split, advance.
4. **Mismatch:** if the played move delivers checkmate, count the puzzle as solved
   (Lichess convention). Otherwise the puzzle is instantly failed: stamp it as a
   miss, briefly show the intended line (play the remaining solution moves on the
   board at readable speed, or show the SAN line), then advance. No retries.
5. Auto-queen all promotions (underpromotion puzzles were excluded in step 0).

## Clock rules

- One count-up stopwatch per cycle, accumulating across sessions.
- The clock runs only while a puzzle is live: it starts when a puzzle becomes
  interactive (after the setup move animates) and stops the moment the puzzle
  resolves. It does not run during solution flashes, between puzzles, on other
  screens, or during miss review.
- Pause on `visibilitychange` → hidden (app backgrounded/closed); resume on return.
  Persist accumulated time so a killed tab loses at most the current puzzle's
  in-progress seconds.
- Display format m:ss (h:mm:ss past an hour). Show the standing target alongside.

## Persistence (localStorage)

Single key `woodpecker.v2`, one JSON blob:

```json
{
  "version": 2,
  "configured": true,
  "activeProgramId": "default",
  "programs": [
    {
      "id": "default",
      "name": "Woodpecker 50",
      "createdAt": "2026-08-08T14:00:00Z",
      "puzzleIds": ["abcde", "fghij"],
      "targetSeconds": 1800,
      "filters": { "minRating": 1500, "maxRating": 1800, "themes": ["fork"] },
      "progress": {
        "cycle": 4,
        "puzzleIndex": 23,
        "elapsedMs": 812345,
        "results": [ { "id": "abcde", "solved": true, "ms": 21000 } ]
      },
      "history": [
        {
          "cycle": 3,
          "date": "2026-08-08T14:31:00Z",
          "totalMs": 2472000,
          "splits": { "abcde": 21000 },
          "misses": ["fghij", "klmno"]
        }
      ]
    }
  ]
}
```

`progress` is `null` when no cycle is underway, and `filters` is `null` for the
built-in set. Write to storage on every puzzle resolution and on
visibility-hidden. On load, if a program has `progress`, offer resume. First
launch (`configured: false`) asks for a target time once.

The v1 key `woodpecker.v1` is read once and folded into a single program named
"Woodpecker 50", preserving its target, cycle and history. The old blob is left
in place as a backup rather than deleted.

## Screens

1. **Home** — the list of save files: name, set size, cycles finished or the cycle
   in progress, best time. Plus "New set".
2. **Program** — one save file: its target time (editable), cycle history list
   (cycle #, date, total time vs target, miss count), and one primary button:
   "Start cycle N" or "Resume cycle N — puzzle X/50". When a cycle is stored, a
   secondary "Discard cycle" throws it away behind a confirmation. "Delete this
   set" removes the program entirely, and is hidden when it is the only one.
3. **Set builder** — name, puzzle count, rating range, how to pick ("most popular
   on Lichess" or "random in range"), and a theme list showing how many puzzles
   each theme has *inside the chosen band*. Ticking a theme reveals a quota box
   that claims whatever is still unallocated, so on a 50-puzzle set the first
   theme proposes 50, and after cutting it to 25 the next proposes 25. Quotas are
   filled first, the remainder comes from the whole band, and a theme with fewer
   matches than its quota contributes what it has. The finished set is emitted in
   pool order so quota themes are not clumped at the front of every cycle. A live
   preview spells out the mix ("25 endgame + 25 mate — 50 puzzles").
4. **Practice** — the board, clock vs target, "Puzzle X of 50", running ✓/✗ counts,
   thin progress bar, whose move it is, and the puzzle's rating and difficulty
   band. An "End" control leaves mid-cycle, keeping progress for later resume.
   Themes are never shown while solving — they would give the tactic away.
5. **Summary** (after the last puzzle) — cycle time vs target, vs the previous
   cycle and vs the best so far, miss list, and a button: review misses (untimed
   pass through only the missed puzzles, same solve rules, no clock, results not
   recorded). Then back to the program.

## Build order — implement one step per prompt, verify before continuing

0. Extraction script → `src/puzzles.json`. *Check: file exists, exactly 50 entries,
   all ratings in band, no moves ending in n/b/r.*
1. Vite scaffold; chessground board renders with brown/cburnett assets on desktop
   and phone. *Check: a hardcoded FEN displays correctly, pieces drag.*
2. Single-puzzle solve loop for puzzle #1: setup-move animation, legal-move dots,
   match/mismatch/checkmate-exception, solution flash on fail. *Check: solve it and
   fail it on purpose; both behave per Solve rules.*
3. Chain all 50 with the clock and clock-pause rules. *Check: background the tab
   mid-puzzle; clock stops and resumes.*
4. localStorage save/resume + Home screen + history. *Check: kill the tab at puzzle
   ~20, reopen, resume exactly there with time intact.*
5. Summary screen + miss review flow.
5b. Pool + named programs + set builder, migrating v1 storage. *Check:
   `npm run smoke` drives all five screens headlessly and passes.*
6. PWA (manifest + service worker via vite-plugin-pwa) + deploy to GitHub Pages
   (Vite `base` is the repo name; icons are generated by `scripts/make_icons.mjs`).
   Workbox's default 2 MiB precache limit is raised, or the pool-bearing bundle
   is silently skipped and the app will not open offline. *Check: install to phone
   home screen; open in airplane mode; complete a puzzle.*

## v2 backlog (recorded, not built)

Shuffle-order toggle · cycle-time charts · export/import of the localStorage blob
for cross-device use.
