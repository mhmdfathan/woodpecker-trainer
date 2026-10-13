# 100-Puzzle Master-Game Woodpecker Trainer

## Goal
Create the first useful experiment for 100–1000 Elo players: a fixed 100-puzzle set sourced from master/GM games, but selected for accessible tactical difficulty and repetition training.

## Product decisions
- Source provenance: Lichess puzzles tagged `master` or `masterVsMaster`.
- Difficulty: use Lichess puzzle rating as a selection signal, not as player Elo or game-player strength.
- Target band: favor puzzles rated 800–1200, with a controlled number up to 1400 so the set is not trivial.
- Tactical accessibility: prefer `short`, `oneMove`, `mateIn1`, `mateIn2`, `fork`, `pin`, `skewer`, `hangingPiece`, `discoveredAttack`, `deflection`, and `capture`-style motifs; exclude underpromotions and very long lines.
- Dataset size: exactly 100 unique puzzles, deterministic ordering and selection.
- Preserve offline operation and localStorage progress.

## Implementation steps
1. Extend the offline selector to support the 100-puzzle master-game recipe and produce `src/puzzles.json`.
2. Validate provenance tags, rating range, line length, uniqueness, and exact count.
3. Update the default set name and copy from 50 to 100 puzzles.
4. Update smoke tests and any hard-coded 50-puzzle expectations.
5. Build and run the complete smoke suite.
6. Deploy the corrected build to the live GitHub Pages project and verify the public app loads the 100-puzzle default set and opens New set.

## Acceptance criteria
- `src/puzzles.json` contains exactly 100 unique puzzles.
- Every puzzle has `master` or `masterVsMaster` provenance and no underpromotion.
- The default home screen says `100 puzzles`.
- The default training counter says `Puzzle 1 of 100`.
- Existing local progress migration remains non-destructive.
- `npm run smoke` and `npm run build` pass.
- Public deployment serves JavaScript from the correct repository base path.
