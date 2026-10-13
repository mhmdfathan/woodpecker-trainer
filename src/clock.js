// Display only needs second resolution; 250ms keeps the seconds digit honest
// without pointless repaints.
const TICK = 250;

/**
 * Count-up stopwatch for one cycle.
 *
 * Accumulates across starts and stops, so it can be paused between puzzles and
 * while the tab is hidden and still report one continuous cycle total. Uses
 * performance.now() so a system clock change cannot move time backwards.
 */
export class Clock {
  constructor({ onTick } = {}) {
    this.onTick = onTick;
    this.banked = 0;
    this.startedAt = null;
    this.interval = null;
  }

  get running() {
    return this.startedAt !== null;
  }

  get elapsedMs() {
    return this.running ? this.banked + (performance.now() - this.startedAt) : this.banked;
  }

  start() {
    if (this.running) return;
    this.startedAt = performance.now();
    this.interval = setInterval(() => this.onTick?.(this.elapsedMs), TICK);
    this.onTick?.(this.elapsedMs);
  }

  stop() {
    if (!this.running) return;
    this.banked = this.elapsedMs;
    this.startedAt = null;
    clearInterval(this.interval);
    this.interval = null;
    this.onTick?.(this.elapsedMs);
  }

  /** Set the accumulated total, e.g. when resuming a stored cycle (step 4). */
  reset(ms = 0) {
    this.stop();
    this.banked = ms;
    this.onTick?.(this.elapsedMs);
  }
}

/** m:ss, or h:mm:ss once past an hour. */
export function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
