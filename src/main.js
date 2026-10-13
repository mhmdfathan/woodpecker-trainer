import { PuzzleRunner } from './puzzle.js';
import { Clock, formatTime } from './clock.js';
import { load, save, makeProgram } from './storage.js';
import { puzzlesFor, themeOptions, buildSet, countMatching, countByTheme, ratingRange } from './pool.js';

// Stock lichess board look: base layout, brown squares, cburnett pieces. Every
// asset is an embedded data URI, so the board works offline with no requests.
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.brown.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';

import './style.css';

// Breathing room to take in the final position before the next puzzle loads.
const ADVANCE_DELAY = 700;

const el = {};
for (const id of [
  'home', 'program', 'builder', 'summary', 'practice',
  'program-list', 'new-set',
  'program-name', 'program-meta', 'first-run', 'target-input', 'primary', 'discard',
  'history', 'history-empty', 'delete-program',
  'set-name', 'set-count', 'set-min', 'set-max', 'set-selection', 'theme-list',
  'builder-preview', 'create-set',
  'summary-cycle', 'summary-time', 'summary-stats', 'summary-best', 'summary-miss-count',
  'summary-misses', 'summary-clean', 'review', 'done',
  'board', 'clock', 'target', 'counter', 'solved-count', 'missed-count',
  'remaining-count', 'progress-percent', 'progress-bar',
  'status', 'turn', 'puzzle-meta', 'end-cycle', 'show-solution', 'previous-puzzle', 'next-puzzle',
]) {
  // 'progress-bar' is reachable as el.progressBar.
  el[id.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = document.getElementById(id);
}

/**
 * Lichess-style difficulty bands. A set drawn from one narrow rating band will
 * show the same label throughout — the label only varies across wider sets.
 */
function difficultyOf(rating) {
  if (rating < 1200) return 'Easiest';
  if (rating < 1500) return 'Easy';
  if (rating < 1800) return 'Medium';
  if (rating < 2100) return 'Hard';
  if (rating < 2400) return 'Very hard';
  return 'Hardest';
}

const state = load();
const POOL_RATINGS = ratingRange();

// Active program (save file) and the puzzle objects its id list resolves to.
let program = null;
let puzzles = [];

// Cycle-in-flight state. `index` is the puzzle being solved; `results` holds the
// ones already resolved, so results.length is always the index of the next
// unsolved puzzle — that is what gets persisted as progress.puzzleIndex.
let index = 0;
let results = [];
let puzzleStartMs = 0;
// True only while a puzzle is interactive — the clock may run only then, so
// returning to a backgrounded tab between puzzles must not restart it.
let live = false;

// 'cycle' is the timed run; 'review' is the untimed pass over that cycle's
// misses, which records nothing and never touches the clock.
let mode = 'cycle';
let browseIndex = 0;
let reviewQueue = [];
let reviewPos = 0;

const clock = new Clock({ onTick: renderClock });

const runner = new PuzzleRunner(el.board, {
  onReady({ color }) {
    live = mode === 'cycle';
    setStatus('', '');
    el.showSolution.disabled = true;
    el.previousPuzzle.disabled = mode !== 'browse' || index <= 0;
    el.nextPuzzle.disabled = mode !== 'browse' || index >= puzzles.length - 1;
    // Only revealed once the setup move has landed, so it describes the
    // position the user actually has to solve.
    el.turn.textContent = `${color === 'white' ? 'White' : 'Black'} to move`;
    if (mode === 'review' || mode === 'browse') {
      if (mode === 'browse') {
        runner.setInteractive(false);
        setStatus('Browsing set — resume the cycle to continue', '');
      }
      return;
    }
    puzzleStartMs = clock.elapsedMs;
    // Do not start counting into a tab the user cannot see.
    if (document.visibilityState === 'visible') clock.start();
  },
  onMistake() {
    setStatus('Not quite — the board was reset. Try another move or show the solution.', 'retry');
    el.showSolution.disabled = false;
  },
  onResolved({ solved, line }) {
    live = false;
    if (!solved) setStatus(`Missed — ${line.join(' ')}`, 'missed');

    if (mode === 'review') {
      setTimeout(advanceReview, ADVANCE_DELAY);
      return;
    }

    clock.stop();
    results.push({ id: puzzles[index].id, solved, ms: clock.elapsedMs - puzzleStartMs });
    persistProgress();
    renderPractice();
    setTimeout(advance, ADVANCE_DELAY);
  },
});

/* ---------- helpers ---------- */

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatDelta(ms) {
  return `${ms >= 0 ? '+' : '−'}${formatTime(Math.abs(ms))}`;
}

function formatDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function deltaSpan(ms) {
  const span = element('span', 'delta', formatDelta(ms));
  span.dataset.over = String(ms >= 0);
  return span;
}

function showScreen(name) {
  for (const key of ['home', 'program', 'builder', 'summary', 'practice']) {
    el[key].hidden = key !== name;
  }
}

/* ---------- programs ---------- */

function selectProgram(id) {
  program = state.programs.find((p) => p.id === id) ?? state.programs[0];
  state.activeProgramId = program.id;
  puzzles = puzzlesFor(program.puzzleIds);
  save(state);
}

function nextCycleNumber() {
  return (program.history.at(-1)?.cycle ?? 0) + 1;
}

function describeProgram(entry) {
  const bits = [`${entry.puzzleIds.length} puzzles`];
  const filters = entry.filters;
  if (filters) {
    bits.push(`rating ${filters.minRating}–${filters.maxRating}`);
    const quotas = filters.quotas ?? {};
    const mix = (filters.themes ?? [])
      .filter((theme) => quotas[theme] > 0)
      .map((theme) => `${quotas[theme]} ${theme}`);
    if (mix.length) bits.push(mix.join(' + '));
    if (filters.selection === 'random') bits.push('random pick');
  }
  return bits.join(' · ');
}

function renderHome() {
  el.programList.replaceChildren(
    ...state.programs.map((entry) => {
      const bits = [`${entry.puzzleIds.length} puzzles`];
      if (entry.progress) {
        bits.push(`cycle ${entry.progress.cycle} in progress — puzzle ${entry.progress.puzzleIndex + 1}`);
      } else if (entry.history.length) {
        bits.push(`${entry.history.length} cycle${entry.history.length > 1 ? 's' : ''} done`);
      } else {
        bits.push('not started');
      }
      if (entry.history.length) {
        bits.push(`best ${formatTime(Math.min(...entry.history.map((h) => h.totalMs)))}`);
      }

      const button = element('button', 'program-button');
      button.type = 'button';
      button.dataset.id = entry.id;
      button.append(element('span', 'program-name', entry.name), element('span', 'program-meta', bits.join(' · ')));

      const item = element('li', 'program-item');
      item.append(button);
      return item;
    }),
  );
}

function renderProgram() {
  el.programName.textContent = program.name;
  el.programMeta.textContent = describeProgram(program);
  el.firstRun.hidden = state.configured;
  el.targetInput.value = Math.round(program.targetSeconds / 60);

  const progress = program.progress;
  el.primary.textContent = progress
    ? `Resume cycle ${progress.cycle} — puzzle ${progress.puzzleIndex + 1}/${puzzles.length}`
    : `Start cycle ${nextCycleNumber()}`;
  el.discard.hidden = !progress;
  el.deleteProgram.hidden = state.programs.length < 2;

  el.history.replaceChildren(
    ...[...program.history].reverse().map((entry) => {
      const item = element('li', 'history-item');
      const time = element('span', 'history-time', `${formatTime(entry.totalMs)} `);
      time.append(deltaSpan(entry.totalMs - program.targetSeconds * 1000));
      item.append(
        element('span', 'history-cycle', `Cycle ${entry.cycle}`),
        element('span', 'history-date', formatDate(entry.date)),
        time,
        element('span', 'history-misses', `${entry.misses.length} missed`),
      );
      return item;
    }),
  );
  el.historyEmpty.hidden = program.history.length > 0;
}

function openProgram(id) {
  selectProgram(id);
  renderProgram();
  showScreen('program');
}

/* ---------- set builder ---------- */

function renderThemeOptions() {
  el.themeList.replaceChildren(
    ...themeOptions().map(({ theme }) => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = theme;

      const quota = document.createElement('input');
      quota.type = 'number';
      quota.className = 'theme-quota';
      quota.min = 0;
      quota.inputMode = 'numeric';
      quota.hidden = true;

      // The quota input has to sit outside the label, or clicking it would
      // toggle the checkbox.
      const label = element('label');
      label.append(checkbox, element('span', 'theme-name', theme));

      const row = element('div', 'theme');
      row.dataset.theme = theme;
      row.append(label, element('span', 'theme-count'), quota);
      return row;
    }),
  );
}

function themeRows() {
  return [...el.themeList.querySelectorAll('.theme')];
}

function rowParts(row) {
  return {
    theme: row.dataset.theme,
    checkbox: row.querySelector('input[type="checkbox"]'),
    quota: row.querySelector('.theme-quota'),
    count: row.querySelector('.theme-count'),
  };
}

function builderBand() {
  const min = Math.max(POOL_RATINGS.min, Math.min(Number(el.setMin.value) || POOL_RATINGS.min, POOL_RATINGS.max));
  const max = Math.max(min, Math.min(Number(el.setMax.value) || POOL_RATINGS.max, POOL_RATINGS.max));
  return { minRating: min, maxRating: max };
}

function builderCount() {
  return Math.min(1000, Math.max(5, Math.round(Number(el.setCount.value) || 50)));
}

function builderFilters() {
  const quotas = {};
  const themes = [];
  for (const row of themeRows()) {
    const { theme, checkbox, quota } = rowParts(row);
    if (!checkbox.checked) continue;
    themes.push(theme);
    quotas[theme] = Math.max(0, Math.round(Number(quota.value) || 0));
  }
  return {
    ...builderBand(),
    count: builderCount(),
    themes,
    quotas,
    selection: el.setSelection.value,
  };
}

/** Puzzles still unspoken for after the ticked themes have taken their quotas. */
function unallocated(filters) {
  const spent = Object.values(filters.quotas).reduce((sum, n) => sum + n, 0);
  return Math.max(0, filters.count - spent);
}

function renderBuilderPreview() {
  const filters = builderFilters();
  const available = countMatching({ ...builderBand(), themes: [] });
  const perTheme = countByTheme(builderBand());

  // Availability is band-dependent, so it is refreshed alongside the preview.
  for (const row of themeRows()) {
    const { theme, checkbox, quota, count } = rowParts(row);
    const have = perTheme.get(theme) ?? 0;
    count.textContent = String(have);
    quota.hidden = !checkbox.checked;
    quota.max = Math.min(have, filters.count);
    row.dataset.short = String(checkbox.checked && Number(quota.value) > have);
  }

  const parts = [];
  for (const theme of filters.themes) {
    const want = filters.quotas[theme];
    const have = perTheme.get(theme) ?? 0;
    if (want > 0) parts.push(`${Math.min(want, have)} ${theme}`);
  }
  const rest = unallocated(filters);
  if (rest > 0 || !parts.length) {
    parts.push(`${rest} ${filters.selection === 'random' ? 'random' : 'most popular'}`);
  }

  const total = Math.min(filters.count, available);
  el.builderPreview.textContent = available
    ? `${parts.join(' + ')} — ${total} puzzles from ${available.toLocaleString()} in range.`
    : 'Nothing matches this rating range.';
  el.createSet.disabled = available === 0;
}

/**
 * A newly ticked theme claims whatever is still unallocated, so ticking endgame
 * on a 50-puzzle set proposes 50, and after cutting that to 25 the next theme
 * ticked proposes the remaining 25.
 */
function onThemeToggled(checkbox) {
  const row = checkbox.closest('.theme');
  const { theme, quota } = rowParts(row);
  if (checkbox.checked) {
    const perTheme = countByTheme(builderBand());
    const free = unallocated(builderFilters());
    quota.value = Math.min(free, perTheme.get(theme) ?? 0);
  } else {
    quota.value = '';
  }
  renderBuilderPreview();
}

function openBuilder() {
  el.setName.value = `Set ${state.programs.length + 1}`;
  el.setCount.value = 100;
  el.setMin.value = 800;
  el.setMax.value = 1400;
  el.setMin.min = POOL_RATINGS.min;
  el.setMax.min = POOL_RATINGS.min;
  el.setMin.max = POOL_RATINGS.max;
  el.setMax.max = POOL_RATINGS.max;
  el.setSelection.value = 'popular';
  for (const row of themeRows()) {
    const { checkbox, quota } = rowParts(row);
    checkbox.checked = false;
    quota.value = '';
  }
  renderBuilderPreview();
  showScreen('builder');
}

function createSet() {
  const filters = builderFilters();
  const puzzleIds = buildSet(filters);
  if (!puzzleIds.length) return;

  const entry = makeProgram({
    name: el.setName.value.trim() || `Set ${state.programs.length + 1}`,
    puzzleIds,
    targetSeconds: program?.targetSeconds ?? 1800,
    filters: {
      minRating: filters.minRating,
      maxRating: filters.maxRating,
      themes: filters.themes,
      quotas: filters.quotas,
      selection: filters.selection,
    },
  });
  state.programs.push(entry);
  save(state);
  openProgram(entry.id);
}

/* ---------- cycle ---------- */

function commitTarget() {
  const minutes = Number(el.targetInput.value);
  const clamped = Number.isFinite(minutes) ? Math.min(600, Math.max(1, Math.round(minutes))) : 30;
  el.targetInput.value = clamped;
  program.targetSeconds = clamped * 60;
  state.configured = true;
  save(state);
}

function startCycle() {
  commitTarget();
  index = 0;
  results = [];
  clock.reset(0);
  persistProgress(nextCycleNumber());
  enterPractice();
}

function resumeCycle() {
  const progress = program.progress;
  results = progress.results ?? [];
  // results.length is authoritative: puzzleIndex is written from it, and using
  // it here keeps a hand-edited or truncated blob self-consistent.
  index = Math.min(results.length, puzzles.length - 1);
  // Time already banked against the interrupted puzzle stays in the cycle total
  // but is not re-attributed to that puzzle's split, which restarts from here.
  clock.reset(progress.elapsedMs ?? 0);
  enterPractice();
}

function enterPractice() {
  mode = 'cycle';
  el.practice.dataset.mode = 'cycle';
  el.endCycle.textContent = 'Pause cycle';
  el.target.textContent = formatTime(program.targetSeconds * 1000);
  showScreen('practice');
  renderPractice();
  loadPuzzle(index);
}

function advance() {
  index += 1;
  if (index >= puzzles.length) {
    finishCycle();
    return;
  }
  renderPractice();
  loadPuzzle(index);
}

function finishCycle() {
  const splits = {};
  const misses = [];
  for (const result of results) {
    splits[result.id] = result.ms;
    if (!result.solved) misses.push(result.id);
  }
  const entry = {
    cycle: program.progress?.cycle ?? nextCycleNumber(),
    date: new Date().toISOString(),
    totalMs: clock.elapsedMs,
    splits,
    misses,
  };
  program.history.push(entry);
  // No cycle underway any more.
  program.progress = null;
  save(state);

  renderProgram();
  renderSummary(entry);
  showScreen('summary');
}

function persistProgress(cycle) {
  program.progress = {
    cycle: cycle ?? program.progress?.cycle ?? nextCycleNumber(),
    puzzleIndex: results.length,
    elapsedMs: clock.elapsedMs,
    results,
  };
  save(state);
}

/* ---------- summary ---------- */

function renderSummary(entry) {
  const prior = program.history.slice(0, -1);
  el.summaryCycle.textContent = entry.cycle;
  el.summaryTime.textContent = formatTime(entry.totalMs);

  const stats = [{ label: 'Target', ms: program.targetSeconds * 1000 }];
  if (prior.length) {
    const previous = prior.at(-1);
    stats.push({ label: `Cycle ${previous.cycle}`, ms: previous.totalMs });
    const best = Math.min(...prior.map((e) => e.totalMs));
    if (best !== previous.totalMs) stats.push({ label: 'Best so far', ms: best });
    el.summaryBest.hidden = entry.totalMs >= best;
  } else {
    el.summaryBest.hidden = true;
  }

  el.summaryStats.replaceChildren(
    ...stats.map(({ label, ms }) => {
      const value = element('span', null, `${formatTime(ms)} `);
      value.append(deltaSpan(entry.totalMs - ms));
      const item = document.createElement('li');
      item.append(element('span', null, label), value);
      return item;
    }),
  );

  el.summaryMissCount.textContent = entry.misses.length ? `(${entry.misses.length})` : '';
  el.summaryMisses.replaceChildren(
    ...entry.misses.map((id) => {
      const position = puzzles.findIndex((p) => p.id === id);
      const puzzle = puzzles[position];
      const item = element('li', 'miss-item');
      item.append(
        element('span', null, `Puzzle ${position + 1}`),
        element('span', 'miss-meta', `${puzzle?.rating ?? '?'} · ${formatTime(entry.splits[id] ?? 0)}`),
      );
      return item;
    }),
  );
  el.summaryClean.hidden = entry.misses.length > 0;
  el.review.hidden = entry.misses.length === 0;
}

/* ---------- miss review (untimed, nothing recorded) ---------- */

function startReview() {
  reviewQueue = results.filter((r) => !r.solved).map((r) => puzzles.findIndex((p) => p.id === r.id));
  if (!reviewQueue.length) return;
  mode = 'review';
  reviewPos = 0;
  el.practice.dataset.mode = 'review';
  el.endCycle.textContent = 'End review';
  showScreen('practice');
  renderReview();
  loadPuzzle(reviewQueue[reviewPos]);
}

function advanceReview() {
  reviewPos += 1;
  if (reviewPos >= reviewQueue.length) {
    mode = 'cycle';
    el.practice.dataset.mode = 'cycle';
    showScreen('summary');
    return;
  }
  renderReview();
  loadPuzzle(reviewQueue[reviewPos]);
}

function renderReview() {
  el.counter.textContent = `Review ${reviewPos + 1} of ${reviewQueue.length}`;
  el.progressBar.style.width = `${(reviewPos / reviewQueue.length) * 100}%`;
}

/* ---------- practice rendering ---------- */

function renderPractice() {
  const solved = results.filter((r) => r.solved).length;
  const completed = results.length;
  const percent = Math.round((completed / puzzles.length) * 100);
  const current = `Puzzle ${Math.min(index + 1, puzzles.length)} of ${puzzles.length}`;
  el.counter.textContent = current;
  el.previousPuzzle.disabled = mode !== 'browse' || index <= 0;
  el.nextPuzzle.disabled = mode !== 'browse' || index >= puzzles.length - 1;
  el.solvedCount.textContent = solved;
  el.missedCount.textContent = completed - solved;
  el.remainingCount.textContent = puzzles.length - completed;
  el.progressPercent.textContent = `${percent}%`;
  el.progressBar.style.width = `${percent}%`;
  renderClock(clock.elapsedMs);
}

/** Load a puzzle by index and show what is known about it before the first move. */
function loadPuzzle(i) {
  const puzzle = puzzles[i];
  // Blank until the setup move lands; onReady fills in whose move it is.
  el.turn.textContent = '';
  el.puzzleMeta.textContent = `${puzzle.rating} · ${difficultyOf(puzzle.rating)}`;
  runner.load(puzzle);
}

function browsePuzzle(delta) {
  if (!puzzles.length) return;
  if (mode === 'cycle') {
    runner.halt();
    clock.stop();
    live = false;
    persistProgress();
    mode = 'browse';
    browseIndex = index;
  }
  browseIndex = Math.max(0, Math.min(puzzles.length - 1, browseIndex + delta));
  index = browseIndex;
  renderPractice();
  loadPuzzle(index);
}

function renderClock(ms) {
  el.clock.textContent = formatTime(ms);
}

function setStatus(text, result) {
  el.status.textContent = text;
  el.status.dataset.result = result;
}

/* ---------- wiring ---------- */

el.programList.addEventListener('click', (event) => {
  const button = event.target.closest('.program-button');
  if (button) openProgram(button.dataset.id);
});

el.newSet.addEventListener('click', openBuilder);

for (const button of document.querySelectorAll('[data-back]')) {
  button.addEventListener('click', () => {
    renderHome();
    showScreen('home');
  });
}

el.themeList.addEventListener('change', (event) => {
  if (event.target.type === 'checkbox') onThemeToggled(event.target);
  else renderBuilderPreview();
});
el.themeList.addEventListener('input', (event) => {
  if (event.target.classList.contains('theme-quota')) renderBuilderPreview();
});
for (const input of [el.setCount, el.setMin, el.setMax]) {
  input.addEventListener('input', renderBuilderPreview);
}
el.setSelection.addEventListener('change', renderBuilderPreview);
el.createSet.addEventListener('click', createSet);

el.primary.addEventListener('click', () => {
  if (program.progress) resumeCycle();
  else startCycle();
});

el.targetInput.addEventListener('change', () => {
  commitTarget();
  renderProgram();
});

el.discard.addEventListener('click', () => {
  const progress = program.progress;
  if (!progress) return;
  const message = `Discard cycle ${progress.cycle}? ${progress.puzzleIndex} finished puzzles and ${formatTime(progress.elapsedMs)} will be lost.`;
  if (!confirm(message)) return;
  program.progress = null;
  save(state);
  renderProgram();
});

el.deleteProgram.addEventListener('click', () => {
  if (state.programs.length < 2) return;
  if (!confirm(`Delete "${program.name}" and its ${program.history.length} recorded cycles?`)) return;
  state.programs = state.programs.filter((p) => p.id !== program.id);
  selectProgram(state.programs[0].id);
  renderHome();
  showScreen('home');
});

el.review.addEventListener('click', startReview);

el.previousPuzzle.addEventListener('click', () => browsePuzzle(-1));
el.nextPuzzle.addEventListener('click', () => browsePuzzle(1));

el.showSolution.addEventListener('click', () => {
  runner.revealSolution();
  el.showSolution.disabled = true;
  setStatus('Solution', 'solution');
});

el.done.addEventListener('click', () => {
  renderProgram();
  showScreen('program');
});

// Leave the Practice screen without finishing. A cycle keeps its progress, so
// the set screen offers Resume; a review just returns to the Summary.
el.endCycle.addEventListener('click', () => {
  runner.halt();
  live = false;
  if (mode === 'review') {
    mode = 'cycle';
    el.practice.dataset.mode = 'cycle';
    showScreen('summary');
    return;
  }
  clock.stop();
  persistProgress();
  renderProgram();
  showScreen('program');
});

// SPEC clock rule: pause when the app is backgrounded, resume on return — but
// only if a puzzle is actually live. Persisting here means a tab killed while
// hidden keeps every second it had banked. Review is untimed, so it is exempt.
document.addEventListener('visibilitychange', () => {
  if (mode === 'review') return;
  if (document.hidden) {
    clock.stop();
    if (program?.progress) persistProgress();
  } else if (live) {
    clock.start();
  }
});

selectProgram(state.activeProgramId);
renderThemeOptions();
renderHome();
showScreen('home');
