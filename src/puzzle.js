import { Chess } from 'chess.js';
import { Chessground } from '@lichess-org/chessground';
import { KnightArrows } from './knight-arrows.js';

// Timings, all in ms. Tuned so the setup move reads as "the opponent just played
// that" and a failed line replays slowly enough to follow.
const ANIMATION = 250;
const SETUP_MOVE_DELAY = 400;
const OPPONENT_REPLY_DELAY = 250;
const SOLUTION_STEP = 700;

const COLORS = { w: 'white', b: 'black' };

/** Legal destinations per origin square, in the shape chessground wants. */
function toDests(chess) {
  const dests = new Map();
  for (const move of chess.moves({ verbose: true })) {
    const from = dests.get(move.from);
    if (from) from.push(move.to);
    else dests.set(move.from, [move.to]);
  }
  return dests;
}

function squares(uci) {
  return [uci.slice(0, 2), uci.slice(2, 4)];
}

/**
 * Runs one puzzle at a time on a chessground board, enforcing SPEC solve rules.
 *
 * Lichess puzzle format: `fen` is the position *before* the opponent's last move
 * and `moves[0]` is that move, so every puzzle opens by auto-playing moves[0].
 * The solver then plays the odd indices and the opponent's replies (even indices)
 * are auto-played.
 */
export class PuzzleRunner {
  /**
   * @param element host element for the board
   * @param handlers.onReady    fired when a puzzle becomes interactive (step 3 starts the clock here)
   * @param handlers.onMistake  fired with { line } after a wrong move
   * @param handlers.onResolved fired with { solved, line } when a puzzle ends
   */
  constructor(element, { onReady, onMistake, onResolved } = {}) {
    this.onReady = onReady;
    this.onMistake = onMistake;
    this.onResolved = onResolved;
    this.timers = [];
    this.chess = new Chess();
    this.puzzle = null;
    this.index = 0;
    this.lastMove = undefined;
    this.pendingLine = null;
    this.solutionRequested = false;
    this.state = 'idle';

    this.ground = Chessground(element, {
      coordinates: true,
      animation: { enabled: true, duration: ANIMATION },
      movable: { free: false, showDests: true, events: { after: (o, d) => this.handleUserMove(o, d) } },
      // Puzzles have no premoves.
      premovable: { enabled: false },
      // Right-click square highlights and right-drag arrows, with chessground's
      // stock lichess brushes and modifier keys. Shapes clear whenever the
      // position changes, which is chessground's own behaviour.
      drawable: {
        enabled: true,
        onChange: (shapes) => this.absorbKnightArrows(shapes),
      },
    });

    // chessground can only draw straight arrows; knight moves are handed to an
    // overlay that bends them into the L.
    this.knightArrows = new KnightArrows(element);
  }

  /** Load a puzzle and start it. Any in-flight animation from a previous one is dropped. */
  load(puzzle) {
    this.clearTimers();
    this.puzzle = puzzle;
    this.chess = new Chess(puzzle.fen);
    this.index = 0;
    this.lastMove = undefined;
    this.pendingLine = null;
    this.solutionRequested = false;
    this.state = 'setup';

    // The side to move in the raw FEN is the opponent, so the solver is the other.
    const solverColor = COLORS[this.chess.turn()] === 'white' ? 'black' : 'white';
    this.solverColor = solverColor;

    // Jump to the start position without animating in from the previous puzzle.
    this.ground.set({ animation: { enabled: false } });
    this.sync({ interactive: false });
    this.ground.set({ animation: { enabled: true } });
    this.ground.set({ orientation: solverColor });
    this.knightArrows.setOrientation(solverColor);

    this.wait(() => this.playSetupMove(), SETUP_MOVE_DELAY);
  }

  playSetupMove() {
    const setup = this.puzzle.moves[0];
    this.apply(setup);
    this.index = 1;
    this.sync({ interactive: false });

    // Only hand over control once the move has finished animating — that is the
    // moment the puzzle is "live" and the clock should start.
    this.wait(() => {
      this.state = 'solving';
      this.sync({ interactive: true });
      this.onReady?.({ color: this.solverColor });
    }, ANIMATION);
  }

  handleUserMove(orig, dest) {
    if (this.state !== 'solving') return;

    // Auto-queen: underpromotions were filtered out of the puzzle set in step 0.
    const piece = this.chess.get(orig);
    const promoting = piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1');
    const uci = orig + dest + (promoting ? 'q' : '');

    const expected = this.puzzle.moves[this.index];
    const before = this.lastMove;
    const fenBefore = this.chess.fen();
    this.apply(uci);

    if (uci === expected) {
      this.index += 1;
      const reply = this.puzzle.moves[this.index];
      if (!reply) {
        // That was the last solution move — solved.
        this.sync({ interactive: false });
        this.resolve(true);
        return;
      }
      this.state = 'replying';
      this.sync({ interactive: false });
      this.wait(() => {
        this.apply(reply);
        this.index += 1;
        this.state = 'solving';
        this.sync({ interactive: true });
      }, OPPONENT_REPLY_DELAY);
      return;
    }

    // Mismatch that mates anyway counts as solved (lichess convention).
    if (this.chess.isCheckmate()) {
      this.sync({ interactive: false });
      this.resolve(true);
      return;
    }

    // Reset immediately to the exact pre-move position. The incorrect move is
    // never left on the board, preventing visual distortion while the user
    // chooses whether to retry or reveal the solution.
    const line = this.sanLine(fenBefore);
    this.chess.undo();
    this.lastMove = before;
    this.state = 'solving';
    this.sync({ interactive: true });
    this.pendingLine = line;
    this.onMistake?.({ line });
  }

  revealSolution() {
    if (this.state !== 'solving' || !this.pendingLine) return;
    this.solutionRequested = true;
    this.state = 'revealing';
    this.showSolution(this.pendingLine ?? []);
  }

  /** Replay the moves the solver should have played, one at a time. */
  showSolution(line) {
    if (!this.solutionRequested) return;
    const step = () => {
      const move = this.puzzle.moves[this.index];
      if (!move) {
        this.resolve(false, line);
        return;
      }
      this.apply(move);
      this.index += 1;
      this.sync({ interactive: false });
      this.wait(step, SOLUTION_STEP);
    };
    this.wait(step, SOLUTION_STEP / 2);
  }

  /**
   * SAN for the remaining solution. Takes the FEN from before the wrong move —
   * a Chess built from a FEN has no history, so it could not be undone here.
   */
  sanLine(fenBefore) {
    const preview = new Chess(fenBefore);
    const san = [];
    for (const uci of this.puzzle.moves.slice(this.index)) {
      const [from, to] = squares(uci);
      san.push(preview.move({ from, to, promotion: uci[4] || 'q' }).san);
    }
    return san;
  }

  apply(uci) {
    const [from, to] = squares(uci);
    const move = uci[4] ? { from, to, promotion: uci[4] } : { from, to };
    this.chess.move(move);
    this.lastMove = [from, to];
  }

  /**
   * Hand knight moves to the overlay and leave chessground the rest. Called
   * from drawable.onChange; setShapes does not fire onChange, so this cannot
   * loop back on itself.
   */
  absorbKnightArrows(shapes) {
    const remaining = this.knightArrows.absorb(shapes);
    if (remaining.length !== shapes.length) this.ground.setShapes(remaining);
  }

  /** Push the chess.js position onto the board. */
  sync({ interactive }) {
    // chessground drops its own shapes whenever the position changes; the
    // knight overlay has to follow suit or it would outlive the position.
    this.knightArrows.clear();
    const turn = COLORS[this.chess.turn()];
    this.ground.set({
      fen: this.chess.fen(),
      turnColor: turn,
      lastMove: this.lastMove,
      check: this.chess.isCheck() ? turn : false,
      movable: {
        color: interactive ? this.solverColor : undefined,
        dests: interactive ? toDests(this.chess) : new Map(),
      },
    });
  }

  resolve(solved, line = null) {
    this.state = 'resolved';
    this.clearTimers();
    this.onResolved?.({ solved, line });
  }

  /**
   * Abandon the current puzzle without resolving it — used when the user leaves
   * the Practice screen mid-cycle. Pending timers must die, or a solution flash
   * would resolve a puzzle the user is no longer looking at.
   */
  halt() {
    this.clearTimers();
    this.state = 'idle';
  }

  wait(fn, ms) {
    this.timers.push(setTimeout(fn, ms));
  }

  clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  destroy() {
    this.clearTimers();
    this.knightArrows.destroy();
    this.ground.destroy();
  }
}
