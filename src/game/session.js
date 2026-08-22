import Playfield from './playfield.js';
import { WEIGHTS, accuracy, grade, comboMultiplier } from './timing.js';

export class Session {
  constructor(chart) {
    this.chart = chart;
    this.playfield = new Playfield(chart);
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.total = chart.notes.length;
    this.counts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
  }

  onTap(lane, inputSongTMs) {
    const hit = this.playfield.tap(lane, inputSongTMs);
    if (!hit) return null;
    if (!WEIGHTS[hit.verdict]) return this._registerMiss(hit.deltaMs ?? 0, hit.note);
    this.score += WEIGHTS[hit.verdict] * comboMultiplier(this.combo);
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.counts[hit.verdict]++;
    return {
      verdict: hit.verdict,
      deltaMs: hit.deltaMs,
      note: hit.note,
      score: this.score,
      combo: this.combo,
    };
  }

  _registerMiss(deltaMs, note) {
    this.counts.MISS++;
    this.combo = 0;
    return { verdict: 'MISS', deltaMs, note, score: this.score, combo: this.combo };
  }

  sweep(songTimeMs) {
    const missed = this.playfield.update(songTimeMs);
    for (let i = 0; i < missed.length; i++) {
      this.counts.MISS++;
      this.combo = 0;
    }
    return missed;
  }

  get stats() {
    const judged =
      this.counts.PERFECT + this.counts.GREAT + this.counts.GOOD + this.counts.MISS;
    const acc = accuracy(this.counts);
    return {
      score: this.score,
      combo: this.combo,
      maxCombo: this.maxCombo,
      counts: { ...this.counts },
      acc,
      grade: grade(acc),
      total: this.total,
      judged,
    };
  }

  done() {
    return this.playfield.done();
  }
}

export default Session;
