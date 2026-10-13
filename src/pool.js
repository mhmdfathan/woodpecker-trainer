import pool from './pool.json';
import defaultSet from './puzzles.json';

// The pool ships in popularity order (see scripts/build_pool.py), so taking the
// first N of any filtered view means "most popular first" — the same ordering
// the original 50-puzzle set used.
const byId = new Map();
for (const puzzle of pool) byId.set(puzzle.id, puzzle);
// Defensive: the build script force-includes these, but the default set must
// resolve even if someone regenerates the pool without that step.
for (const puzzle of defaultSet) if (!byId.has(puzzle.id)) byId.set(puzzle.id, puzzle);

/** A theme is only worth offering as a filter if it has enough puzzles to fill a set. */
const MIN_THEME_COUNT = 50;

export const POOL_SIZE = pool.length;

export function puzzleById(id) {
  return byId.get(id);
}

/** Puzzle objects for a stored id list, dropping any the pool no longer knows. */
export function puzzlesFor(ids) {
  return ids.map(puzzleById).filter(Boolean);
}

export function defaultSetIds() {
  return defaultSet.map((puzzle) => puzzle.id);
}

export function ratingRange() {
  let min = Infinity;
  let max = -Infinity;
  for (const puzzle of pool) {
    if (puzzle.rating < min) min = puzzle.rating;
    if (puzzle.rating > max) max = puzzle.rating;
  }
  return { min, max };
}

/** Selectable themes with their pool counts, most common first. */
export function themeOptions() {
  const counts = new Map();
  for (const puzzle of pool) {
    for (const theme of puzzle.themes) counts.set(theme, (counts.get(theme) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, count]) => count >= MIN_THEME_COUNT)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([theme, count]) => ({ theme, count }));
}

function inBand(puzzle, minRating, maxRating) {
  return puzzle.rating >= minRating && puzzle.rating <= maxRating;
}

function shuffled(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pick puzzle ids for a new set.
 *
 * Each selected theme takes its quota first, in the order the quotas are given.
 * Whatever is left of `count` is filled from the whole rating band, so asking
 * for 50 with a quota of 25 endgame gives 25 endgame plus 25 of anything.
 *
 * `selection` decides which puzzles win a slot: 'popular' walks the pool in its
 * shipped popularity order and takes the most-played first; 'random' draws from
 * the band at random. Either way the finished set is emitted in popularity
 * order, so quota themes are not clumped at the front of every cycle.
 *
 * A theme with fewer matches than its quota simply contributes what it has, and
 * the shortfall falls through to the fill.
 */
export function buildSet({ count, minRating, maxRating, quotas = {}, selection = 'popular' }) {
  const band = pool.filter((puzzle) => inBand(puzzle, minRating, maxRating));
  const source = selection === 'random' ? shuffled(band) : band;
  const taken = new Set();

  for (const [theme, quota] of Object.entries(quotas)) {
    if (!(quota > 0)) continue;
    let got = 0;
    for (const puzzle of source) {
      if (got >= quota || taken.size >= count) break;
      if (taken.has(puzzle.id) || !puzzle.themes.includes(theme)) continue;
      taken.add(puzzle.id);
      got += 1;
    }
  }

  for (const puzzle of source) {
    if (taken.size >= count) break;
    taken.add(puzzle.id);
  }

  return band.filter((puzzle) => taken.has(puzzle.id)).map((puzzle) => puzzle.id);
}

/** How many puzzles each selectable theme has inside a rating band. */
export function countByTheme({ minRating, maxRating }) {
  const counts = new Map();
  for (const puzzle of pool) {
    if (!inBand(puzzle, minRating, maxRating)) continue;
    for (const theme of puzzle.themes) counts.set(theme, (counts.get(theme) ?? 0) + 1);
  }
  return counts;
}

/** How many puzzles the current filters can actually reach, for the live preview. */
export function countMatching({ minRating, maxRating, themes = [] }) {
  let total = 0;
  for (const puzzle of pool) {
    if (!inBand(puzzle, minRating, maxRating)) continue;
    if (themes.length && !puzzle.themes.some((theme) => themes.includes(theme))) continue;
    total += 1;
  }
  return total;
}
