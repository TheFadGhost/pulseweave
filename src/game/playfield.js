import { WINDOWS, judgeDelta } from './timing.js';
import { validateChart } from './chart.js';

const LANE_COUNT = 4;

export class Playfield {
  constructor(chart) {
    validateChart(chart);
    this.chart = chart;
    this.lanes = [[], [], [], []];
    const notes = chart.notes;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      this.lanes[n[1]].push({ t: n[0], lane: n[1], strength: n[2], judged: false });
    }
    this.pointers = [0, 0, 0, 0];
    this._counts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
    this._total = notes.length;
    this._judged = 0;
  }

  update(songTimeMs) {
    const missed = [];
    const cutoff = songTimeMs - WINDOWS.GOOD;
    for (let lane = 0; lane < LANE_COUNT; lane++) {
      const q = this.lanes[lane];
      let i = this.pointers[lane];
      while (i < q.length) {
        const n = q[i];
        if (n.judged) {
          i++;
          continue;
        }
        if (n.t >= cutoff) break;
        n.judged = true;
        this._counts.MISS++;
        this._judged++;
        missed.push({ note: n, deltaMs: songTimeMs - n.t });
        i++;
      }
      this.pointers[lane] = i;
    }
    return missed;
  }

  tap(lane, inputSongTMs) {
    if (!Number.isInteger(lane) || lane < 0 || lane >= LANE_COUNT) return null;
    if (typeof inputSongTMs !== 'number' || !Number.isFinite(inputSongTMs)) return null;
    const q = this.lanes[lane];
    const lo = inputSongTMs - WINDOWS.GOOD;
    const hi = inputSongTMs + WINDOWS.GOOD;
    let result = null;
    let i = this.pointers[lane];
    while (i < q.length) {
      const n = q[i];
      if (n.judged) {
        i++;
        continue;
      }
      if (n.t > hi) break;
      if (n.t >= lo) {
        const deltaMs = inputSongTMs - n.t;
        const verdict = judgeDelta(deltaMs);
        if (verdict === null) break;
        n.judged = true;
        this._counts[verdict]++;
        this._judged++;
        result = { verdict, deltaMs, note: n };
        break;
      }
      i++;
    }
    this._advance(lane);
    return result;
  }

  pendingNotes(fromTMs, toTMs) {
    const out = [];
    if (typeof fromTMs !== 'number' || typeof toTMs !== 'number') return out;
    if (!(toTMs >= fromTMs)) return out;
    for (let lane = 0; lane < LANE_COUNT; lane++) {
      const q = this.lanes[lane];
      let lo = 0;
      let hi = q.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (q[mid].t < fromTMs) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < q.length && q[i].t <= toTMs; i++) {
        if (!q[i].judged) out.push(q[i]);
      }
    }
    out.sort(byTimeThenLane);
    return out;
  }

  get counts() {
    return this._counts;
  }

  done() {
    return this._judged === this._total;
  }

  _advance(lane) {
    const q = this.lanes[lane];
    let i = this.pointers[lane];
    while (i < q.length && q[i].judged) i++;
    this.pointers[lane] = i;
  }
}

function byTimeThenLane(a, b) {
  return a.t - b.t || a.lane - b.lane;
}

export default Playfield;
