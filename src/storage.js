import { defaultSetIds } from './pool.js';

// v2 introduced named programs (save files). The v1 blob is read once for
// migration and then left alone as a backup rather than deleted.
const KEY = 'woodpecker.v2';
const LEGACY_KEY = 'woodpecker.v1';

const DEFAULT_TARGET_SECONDS = 1800;
const DEFAULT_NAME = 'Woodpecker 100';

let nextId = 1;

/** Ids only need to be unique within one browser's storage. */
export function newId() {
  return `p${Date.now().toString(36)}${(nextId++).toString(36)}`;
}

export function makeProgram({ name, puzzleIds, targetSeconds = DEFAULT_TARGET_SECONDS, filters = null }) {
  return {
    id: newId(),
    name,
    createdAt: new Date().toISOString(),
    puzzleIds,
    targetSeconds,
    // What the set was built from, so the program screen can describe itself.
    filters,
    progress: null,
    history: [],
  };
}

function defaultProgram(extra = {}) {
  return { ...makeProgram({ name: DEFAULT_NAME, puzzleIds: defaultSetIds() }), id: 'default', ...extra };
}

function fresh() {
  const program = defaultProgram();
  // `configured` records that the user has set a target at least once.
  return { version: 2, configured: false, activeProgramId: program.id, programs: [program] };
}

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Fold a v1 blob into a single program holding its target, cycle and history. */
function migrate(v1) {
  const program = defaultProgram({
    targetSeconds: v1.settings?.targetSeconds ?? DEFAULT_TARGET_SECONDS,
    progress: v1.progress ?? null,
    history: Array.isArray(v1.history) ? v1.history : [],
  });
  return {
    version: 2,
    configured: v1.settings != null,
    activeProgramId: program.id,
    programs: [program],
  };
}

function normalize(state) {
  const programs = state.programs
    .filter((p) => p && typeof p.id === 'string' && Array.isArray(p.puzzleIds) && p.puzzleIds.length)
    .map((p) => ({
      ...p,
      name: p.name || DEFAULT_NAME,
      targetSeconds: Number(p.targetSeconds) || DEFAULT_TARGET_SECONDS,
      filters: p.filters ?? null,
      progress: p.progress ?? null,
      history: Array.isArray(p.history) ? p.history : [],
    }));
  if (!programs.length) return fresh();
  const active = programs.some((p) => p.id === state.activeProgramId)
    ? state.activeProgramId
    : programs[0].id;
  return { version: 2, configured: Boolean(state.configured), activeProgramId: active, programs };
}

export function load() {
  const current = read(KEY);
  if (current?.version === 2 && Array.isArray(current.programs)) return normalize(current);

  const legacy = read(LEGACY_KEY);
  if (legacy && (legacy.settings || legacy.progress || legacy.history?.length)) {
    const migrated = migrate(legacy);
    // Write straight away so the legacy blob is only ever interpreted once.
    save(migrated);
    return migrated;
  }

  return fresh();
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode or quota exhausted. Losing persistence should not stop a
    // cycle already in progress, so this is deliberately swallowed.
  }
}
