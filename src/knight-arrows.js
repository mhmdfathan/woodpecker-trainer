const NS = 'http://www.w3.org/2000/svg';

// chessground's stock brush colours, keyed the way its shapes report them.
const BRUSH_COLORS = {
  green: '#15781B',
  red: '#882020',
  blue: '#003088',
  yellow: '#e68f00',
};

// Matched to chessground's own arrow geometry so a bent arrow sits alongside a
// straight one without looking like it came from a different board.
const LINE_WIDTH = 10 / 64;
const ARROW_MARGIN = 10 / 64;

function isKnightMove(orig, dest) {
  const df = Math.abs(orig.charCodeAt(0) - dest.charCodeAt(0));
  const dr = Math.abs(orig.charCodeAt(1) - dest.charCodeAt(1));
  return (df === 1 && dr === 2) || (df === 2 && dr === 1);
}

/**
 * chessground draws every arrow as a straight line. This layer takes over the
 * ones that represent a knight's move and redraws them bent, tracing the L.
 *
 * It shares chessground's SVG coordinate space exactly — viewBox "-4 -4 8 8",
 * square centres at (file - 3.5, 3.5 - rank) after orientation — so the two
 * layers stay in register at any board size.
 */
export class KnightArrows {
  constructor(wrapElement) {
    this.orientation = 'white';
    this.shapes = [];

    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'cg-knight-arrows');
    this.svg.setAttribute('viewBox', '-4 -4 8 8');
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    this.defs = document.createElementNS(NS, 'defs');
    this.group = document.createElementNS(NS, 'g');
    this.svg.append(this.defs, this.group);

    // Appended after chessground's own svg.cg-shapes, so it paints above it.
    wrapElement.querySelector('cg-container')?.appendChild(this.svg);

    // chessground only fires drawable.onChange when its own shape list is
    // non-empty, so a left-click that erases would go unreported once every
    // remaining arrow lives here. Mirror its erase-on-click directly.
    this.onMouseDown = (event) => {
      if (event.button === 0) this.clear();
    };
    wrapElement.addEventListener('mousedown', this.onMouseDown);
  }

  setOrientation(color) {
    this.orientation = color;
    this.render();
  }

  /**
   * Claim the knight moves out of chessground's shape list and return what is
   * left for chessground to keep drawing.
   *
   * Toggling is handled here too: chessground toggles a repeated arrow off
   * against its own list, and these are no longer in it, so a shape arriving
   * that we already hold means the user drew it twice.
   */
  absorb(shapes) {
    const remaining = [];
    for (const shape of shapes) {
      if (!shape.dest || !shape.brush || !isKnightMove(shape.orig, shape.dest)) {
        remaining.push(shape);
        continue;
      }
      const existing = this.shapes.findIndex((s) => s.orig === shape.orig && s.dest === shape.dest);
      if (existing >= 0) this.shapes.splice(existing, 1);
      else this.shapes.push({ orig: shape.orig, dest: shape.dest, brush: shape.brush });
    }
    // An empty list means chessground was cleared; nothing of ours survives it.
    if (!shapes.length) this.shapes = [];
    this.render();
    return remaining;
  }

  clear() {
    if (!this.shapes.length) return;
    this.shapes = [];
    this.render();
  }

  /** Square centre in chessground's user coordinate space. */
  point(key) {
    let file = key.charCodeAt(0) - 97;
    let rank = key.charCodeAt(1) - 49;
    if (this.orientation === 'black') {
      file = 7 - file;
      rank = 7 - rank;
    }
    return [file - 3.5, 3.5 - rank];
  }

  render() {
    this.group.replaceChildren();
    this.defs.replaceChildren();

    const used = new Set();
    for (const shape of this.shapes) {
      const color = BRUSH_COLORS[shape.brush] ?? BRUSH_COLORS.green;
      if (!used.has(color)) {
        used.add(color);
        this.defs.appendChild(marker(color));
      }
      this.group.appendChild(this.path(shape, color));
    }
  }

  path({ orig, dest }, color) {
    const [x0, y0] = this.point(orig);
    const [x1, y1] = this.point(dest);

    // Travel the two-square leg first, then turn for the single square — the
    // usual way a knight's move is drawn.
    const longLegIsHorizontal = Math.abs(x1 - x0) === 2;
    const [cx, cy] = longLegIsHorizontal ? [x1, y0] : [x0, y1];

    // Pull the tip back so the arrowhead ends where a straight arrow's would.
    const dx = x1 - cx;
    const dy = y1 - cy;
    const length = Math.hypot(dx, dy) || 1;
    const ex = x1 - (dx / length) * ARROW_MARGIN;
    const ey = y1 - (dy / length) * ARROW_MARGIN;

    const el = document.createElementNS(NS, 'path');
    el.setAttribute('d', `M${x0},${y0} L${cx},${cy} L${ex},${ey}`);
    el.setAttribute('stroke', color);
    el.setAttribute('stroke-width', String(LINE_WIDTH));
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('fill', 'none');
    el.setAttribute('marker-end', `url(#knight-arrowhead-${color.slice(1)})`);
    return el;
  }

  destroy() {
    this.svg.remove();
  }
}

function marker(color) {
  const el = document.createElementNS(NS, 'marker');
  el.setAttribute('id', `knight-arrowhead-${color.slice(1)}`);
  el.setAttribute('orient', 'auto');
  el.setAttribute('overflow', 'visible');
  el.setAttribute('markerWidth', '4');
  el.setAttribute('markerHeight', '4');
  el.setAttribute('refX', '2.05');
  el.setAttribute('refY', '2');
  const head = document.createElementNS(NS, 'path');
  head.setAttribute('d', 'M0,0 V4 L3,2 Z');
  head.setAttribute('fill', color);
  el.appendChild(head);
  return el;
}
