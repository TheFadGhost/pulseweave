export const LANE_KEYS = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
export const KEY_LABELS = ['D', 'F', 'J', 'K'];

const CODE_TO_LANE = new Map([
  [LANE_KEYS[0], 0],
  [LANE_KEYS[1], 1],
  [LANE_KEYS[2], 2],
  [LANE_KEYS[3], 3],
  ['ArrowLeft', 0],
  ['ArrowDown', 1],
  ['ArrowUp', 2],
  ['ArrowRight', 3],
]);

let handler = null;
let onLaneDown = null;

export function initInput({ onLaneDown: cb }) {
  if (handler) return;
  onLaneDown = cb;
  // perfTs must be the first statement: every check before it inflates input latency.
  const onKeyDown = (e) => {
    const perfTs = performance.now();
    if (e.repeat) return;
    const lane = CODE_TO_LANE.get(e.code);
    if (lane === undefined) return;
    e.preventDefault();
    onLaneDown(lane, perfTs);
  };
  window.addEventListener('keydown', onKeyDown, true);
  handler = onKeyDown;
}

export function detachInput() {
  if (!handler) return;
  window.removeEventListener('keydown', handler, true);
  handler = null;
  onLaneDown = null;
}

export function injectLaneDown(lane, perfTs) {
  if (onLaneDown === null || lane < 0 || lane > 3) return;
  onLaneDown(lane, perfTs);
}
