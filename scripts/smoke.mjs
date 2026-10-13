/**
 * Headless smoke test of the built bundle.
 *
 *     npm run build && node scripts/smoke.mjs
 *
 * Loads dist/ into jsdom and drives the app the way a user would: pick a set,
 * start a cycle, play a puzzle correctly and incorrectly, build a new set, and
 * check that progress survives a reload. It exists to catch startup exceptions
 * and wiring mistakes across the five screens, which a build alone cannot.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const DIST = new URL('../dist/', import.meta.url);
const html = readFileSync(new URL('index.html', DIST), 'utf8');
// Take the app bundle from the page itself: the PWA plugin adds service worker
// scripts to dist/ that must not be mistaken for it.
const bundleName = html.match(/src="[^"]*\/assets\/([^"]+\.js)"/)?.[1];
if (!bundleName) throw new Error('no module script found in dist/index.html');
const bundle = readFileSync(new URL(`assets/${bundleName}`, DIST), 'utf8');

const failures = [];
const check = (label, ok, detail = '') => {
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

/** Fresh jsdom with the bundle executed, sharing one localStorage across reloads. */
function boot(storage) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e.message));
  virtualConsole.on('error', (...args) => errors.push(args.join(' ')));

  // A real origin is required, or jsdom refuses localStorage on an opaque one.
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;

  // jsdom has no localStorage persistence between instances; back it with a Map
  // so a "reload" sees what the previous instance wrote.
  window.localStorage.clear();
  for (const [key, value] of storage) window.localStorage.setItem(key, value);

  window.eval(bundle);
  return { window, errors, dom };
}

function snapshot(window) {
  const out = new Map();
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    out.set(key, window.localStorage.getItem(key));
  }
  return out;
}

const visible = (window, id) => !window.document.getElementById(id).hidden;
const text = (window, id) => window.document.getElementById(id).textContent.trim();

/* ---------- first launch ---------- */

let storage = new Map();
let { window, errors } = boot(storage);

check('bundle runs without throwing', errors.length === 0, errors[0] ?? '');
check('home screen shown first', visible(window, 'home'));
check('one save file listed', window.document.querySelectorAll('.program-button').length === 1);
check(
  'default set is the committed 100',
  text(window, 'program-list').includes('100 puzzles'),
  text(window, 'program-list'),
);

/* ---------- opening a program ---------- */

window.document.querySelector('.program-button').click();
check('program screen opens', visible(window, 'program'));
check('offers to start cycle 1', text(window, 'primary') === 'Start cycle 1', text(window, 'primary'));
check('first-run target prompt shown', visible(window, 'first-run'));

/* ---------- starting a cycle ---------- */

window.document.getElementById('target-input').value = '25';
window.document.getElementById('primary').click();
check('practice screen opens', visible(window, 'practice'));
check('target applied', text(window, 'target') === '25:00', text(window, 'target'));
check('counter reads puzzle 1', text(window, 'counter') === 'Puzzle 1 of 100', text(window, 'counter'));

const stored = () => JSON.parse(window.localStorage.getItem('woodpecker.v2'));
check('progress persisted at cycle start', stored().programs[0].progress?.cycle === 1);
check('target persisted', stored().programs[0].targetSeconds === 1500);

/* ---------- solving the first puzzle ---------- */

// The setup move animates behind timers; run them out so the puzzle goes live.
await new Promise((resolve) => window.setTimeout(resolve, 1200));
check('turn indicator filled in', /^(White|Black) to move$/.test(text(window, 'turn')), text(window, 'turn'));
check('rating and difficulty shown', /^\d+ · \w+/.test(text(window, 'puzzle-meta')), text(window, 'puzzle-meta'));

/* ---------- reload keeps progress ---------- */

storage = snapshot(window);
({ window, errors } = boot(storage));
check('reload runs without throwing', errors.length === 0, errors[0] ?? '');
window.document.querySelector('.program-button').click();
check(
  'resume offered after reload',
  text(window, 'primary').startsWith('Resume cycle 1'),
  text(window, 'primary'),
);

/* ---------- building a new set ---------- */

window.document.querySelector('[data-back]').click();
check('back to home', visible(window, 'home'));
window.document.getElementById('new-set').click();
check('builder opens', visible(window, 'builder'));
check('themes offered', window.document.querySelectorAll('.theme input').length > 20);

const tick = (theme) => {
  const box = [...window.document.querySelectorAll('.theme input[type="checkbox"]')].find((i) => i.value === theme);
  box.checked = true;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
  return box.closest('.theme').querySelector('.theme-quota');
};
const quotaOf = (theme) =>
  window.document.querySelector(`.theme[data-theme="${theme}"] .theme-quota`).value;

check('themes offered with quota inputs', window.document.querySelectorAll('.theme-quota').length > 20);

window.document.getElementById('set-name').value = 'Mixed 50';
window.document.getElementById('set-count').value = '50';
window.document.getElementById('set-min').value = '1200';
window.document.getElementById('set-max').value = '2000';

const endgameQuota = tick('endgame');
check('first theme claims the whole set', endgameQuota.value === '50', endgameQuota.value);

endgameQuota.value = '25';
endgameQuota.dispatchEvent(new window.Event('input', { bubbles: true }));
tick('mate');
check('second theme claims the remainder', quotaOf('mate') === '25', quotaOf('mate'));
check(
  'preview spells out the mix',
  text(window, 'builder-preview').startsWith('25 endgame + 25 mate'),
  text(window, 'builder-preview'),
);

window.document.getElementById('create-set').click();
check('new set opens its program screen', visible(window, 'program'));
check('new set named', text(window, 'program-name') === 'Mixed 50', text(window, 'program-name'));

const built = stored().programs.find((p) => p.name === 'Mixed 50');
check('new set stored with 50 puzzle ids', built?.puzzleIds.length === 50, String(built?.puzzleIds.length));
check('quotas recorded', built?.filters?.quotas?.endgame === 25 && built?.filters?.quotas?.mate === 25);
check('two save files now', stored().programs.length === 2);

// The real check on quotas: the set must actually contain what was asked for.
const poolArray = JSON.parse(readFileSync(new URL('../src/pool.json', import.meta.url), 'utf8'));
const poolById = new Map(poolArray.map((p) => [p.id, p]));
const poolIndex = new Map(poolArray.map((p, i) => [p.id, i]));
const chosen = built.puzzleIds.map((id) => poolById.get(id));
const endgames = chosen.filter((p) => p.themes.includes('endgame')).length;
const mates = chosen.filter((p) => p.themes.includes('mate')).length;
check('at least 25 endgame puzzles in the set', endgames >= 25, String(endgames));
check('at least 25 mate puzzles in the set', mates >= 25, String(mates));
check('every puzzle inside the rating band', chosen.every((p) => p.rating >= 1200 && p.rating <= 2000));
check(
  'set is emitted in pool order, not clustered by theme',
  built.puzzleIds.every((id, i) => i === 0 || poolIndex.get(built.puzzleIds[i - 1]) < poolIndex.get(id)),
);

window.document.querySelector('#program [data-back]').click();
check('both sets listed on home', window.document.querySelectorAll('.program-button').length === 2);
check(
  'original set still shows its in-progress cycle',
  text(window, 'program-list').includes('cycle 1 in progress'),
  text(window, 'program-list'),
);

/* ---------- v1 migration ---------- */

const legacy = new Map();
legacy.set(
  'woodpecker.v1',
  JSON.stringify({
    settings: { targetSeconds: 2100 },
    progress: { cycle: 3, puzzleIndex: 12, elapsedMs: 456000, results: [] },
    history: [{ cycle: 2, date: '2026-08-01T10:00:00Z', totalMs: 1900000, splits: {}, misses: ['abc'] }],
  }),
);
({ window, errors } = boot(legacy));
check('migration runs without throwing', errors.length === 0, errors[0] ?? '');
const migrated = stored();
check('v1 folded into one program', migrated.programs.length === 1);
check('v1 target carried over', migrated.programs[0].targetSeconds === 2100);
check('v1 cycle carried over', migrated.programs[0].progress?.cycle === 3);
check('v1 history carried over', migrated.programs[0].history.length === 1);
check('v1 blob left intact as backup', window.localStorage.getItem('woodpecker.v1') !== null);

/* ---------- knight arrow overlay ---------- */

// knight-arrows.js has no bundler-specific imports, so it can be exercised
// directly rather than through the bundle.
{
  const dom = new JSDOM('<div id="wrap"><cg-container></cg-container></div>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  const { KnightArrows } = await import('../src/knight-arrows.js');

  const wrap = dom.window.document.getElementById('wrap');
  const arrows = new KnightArrows(wrap);
  check('overlay attached to the board container', Boolean(wrap.querySelector('svg.cg-knight-arrows')));
  check(
    'overlay shares chessground coordinate space',
    wrap.querySelector('svg.cg-knight-arrows').getAttribute('viewBox') === '-4 -4 8 8',
  );

  const shape = (orig, dest) => ({ orig, dest, brush: 'green' });
  let remaining = arrows.absorb([shape('g1', 'f3'), shape('d1', 'd8'), { orig: 'e4', brush: 'green' }]);
  check('knight move claimed by the overlay', arrows.shapes.length === 1, JSON.stringify(arrows.shapes));
  check('straight arrow and circle left to chessground', remaining.length === 2, String(remaining.length));
  check('one bent path drawn', wrap.querySelectorAll('svg.cg-knight-arrows g path').length === 1);

  // g1 -> f3 with white at the bottom: g1 is (2.5, 3.5) and f3 is (1.5, 1.5)
  // — y grows downwards. Two ranks is the long leg, so the arrow rises to the
  // corner at g3 = (2.5, 1.5) before turning left.
  const d = wrap.querySelector('svg.cg-knight-arrows g path').getAttribute('d');
  check('bends at the corner, long leg first', d.startsWith('M2.5,3.5 L2.5,1.5 L'), d);
  check('tip pulled back for the arrowhead', d.endsWith('L1.65625,1.5'), d);

  arrows.absorb([shape('g1', 'f3')]);
  check('drawing the same knight arrow again toggles it off', arrows.shapes.length === 0);

  arrows.absorb([shape('b1', 'c3')]);
  arrows.absorb([]);
  check('empty change list clears the overlay', arrows.shapes.length === 0);

  arrows.absorb([shape('g1', 'f3')]);
  arrows.setOrientation('black');
  const flipped = wrap.querySelector('svg.cg-knight-arrows g path').getAttribute('d');
  check('orientation flips the geometry', flipped.startsWith('M-2.5,-3.5 L-2.5,-1.5 L'), flipped);

  wrap.dispatchEvent(new dom.window.MouseEvent('mousedown', { button: 0, bubbles: true }));
  check('left click erases bent arrows', arrows.shapes.length === 0);

  delete globalThis.document;
}

console.log('');
if (failures.length) {
  console.log(`${failures.length} FAILED`);
  for (const failure of failures) console.log(`  - ${failure}`);
} else {
  console.log('all checks passed');
}
// jsdom's visual pretence leaves animation-frame timers pending, so exit
// explicitly rather than waiting for an event loop that never drains.
process.exit(failures.length ? 1 : 0);
