# Woodpecker

A personal chess puzzle cycle trainer implementing the Woodpecker Method: solve the
same fixed set of 100 master-game puzzles in repeated timed cycles, getting faster and more
accurate each cycle.

Single user, no accounts, no server. All state in `localStorage`. Ships as a static
PWA installable to a phone home screen.

See [SPEC.md](SPEC.md) for the full contract — scope, solve rules, clock rules,
persistence shape, and build order.

## Stack

- Vite + vanilla JavaScript, no framework
- [@lichess-org/chessground](https://github.com/lichess-org/chessground) for the
  board (stock brown theme + cburnett pieces). Note: SPEC.md names the `chessground`
  package; that name is deprecated on npm and the maintained release is the scoped
  `@lichess-org/chessground` v10.
- [chess.js](https://github.com/jhlywa/chess.js) for move legality and FEN handling

## Status

Feature complete for v1: SPEC steps 0–6, plus named save files and the set
builder. Installable to a phone home screen and fully usable offline.

## Development

Requires Node.js 24+.

```
npm install
npm run dev     # dev server, also bound to the LAN for phone testing
npm run smoke   # build, then drive all five screens headlessly in jsdom
```

Puzzle data is committed, so neither script below is needed for normal work. They
exist to regenerate it from the Lichess database (~290 MB, cached under
`scripts/data/` after the first run):

```
python scripts/select_master_set.py   # src/puzzles.json — the default 100-puzzle master-game set
python scripts/build_pool.py       # src/pool.json     — 10,000-puzzle pool
```
