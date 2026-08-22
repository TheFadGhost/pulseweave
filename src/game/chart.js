import { mulberry32, hashInt } from '../core/rng.js';

export const MIN_GAP_MS = { EASY: 400, NORMAL: 260, HARD: 150 };

const DIFFICULTIES = new Set(['EASY', 'NORMAL', 'HARD']);

const KIND_FILTERS = {
  EASY: new Set(['kick', 'snare', 'impact']),
  NORMAL: new Set(['kick', 'snare', 'impact', 'bass']),
  HARD: new Set(['kick', 'snare', 'impact', 'bass', 'hat', 'lead']),
};

const STRENGTH = { impact: 1.0, snare: 0.9, kick: 0.9, bass: 0.7, lead: 0.6, hat: 0.4 };

const PERCUSSIVE = new Set(['kick', 'snare', 'hat', 'impact']);

const MIDI_LOW = 24;
const MIDI_HIGH = 96;

function laneFromPercussion(eventIndex, seed) {
  const rng = mulberry32((eventIndex * 2654435761) ^ seed);
  return Math.floor(rng() * 4);
}

function laneFromPitch(freq) {
  const midi = 69 + 12 * Math.log2(freq / 440);
  const bucket = Math.floor(((midi - MIDI_LOW) / (MIDI_HIGH - MIDI_LOW)) * 4);
  return Math.max(0, Math.min(3, bucket));
}

function laneFromKind(kind) {
  let h = 0x811c9dc5;
  for (let i = 0; i < kind.length; i++) {
    h ^= kind.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return hashInt(h) % 4;
}

export function buildChart(trackDef, events, difficulty) {
  if (!trackDef || typeof trackDef !== 'object' || Array.isArray(trackDef)) {
    throw new Error('chart: trackDef must be an object');
  }
  if (typeof trackDef.id !== 'string' || trackDef.id.length === 0) {
    throw new Error('chart: trackDef.id must be a non-empty string');
  }
  if (!Array.isArray(events)) throw new Error('chart: events must be an array');
  if (!DIFFICULTIES.has(difficulty)) throw new Error('chart: unknown difficulty ' + difficulty);

  const allowed = KIND_FILTERS[difficulty];
  const gap = MIN_GAP_MS[difficulty];
  const seed = trackDef.seed | 0;

  const candidates = [[], [], [], []];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || typeof ev.kind !== 'string' || !allowed.has(ev.kind)) continue;
    const t = ev.tMs;
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) continue;
    const strength = STRENGTH[ev.kind];
    let lane;
    if (PERCUSSIVE.has(ev.kind)) {
      lane = laneFromPercussion(i, seed);
    } else if (typeof ev.freq === 'number' && Number.isFinite(ev.freq) && ev.freq > 0) {
      lane = laneFromPitch(ev.freq);
    } else {
      lane = laneFromKind(ev.kind);
    }
    candidates[lane].push({ t, lane, strength });
  }

  const kept = [];
  for (let lane = 0; lane < 4; lane++) {
    const cand = candidates[lane];
    cand.sort((a, b) => b.strength - a.strength || a.t - b.t);
    const accepted = [];
    for (let i = 0; i < cand.length; i++) {
      const c = cand[i];
      let conflict = false;
      for (let j = 0; j < accepted.length; j++) {
        const a = accepted[j];
        if (a.t - c.t >= gap) break;
        if (Math.abs(a.t - c.t) < gap) {
          conflict = true;
          break;
        }
      }
      if (conflict) continue;
      let pos = accepted.length;
      while (pos > 0 && accepted[pos - 1].t > c.t) pos--;
      accepted.splice(pos, 0, c);
    }
    for (let i = 0; i < accepted.length; i++) kept.push(accepted[i]);
  }

  kept.sort((a, b) => a.t - b.t || a.lane - b.lane);
  const notes = new Array(kept.length);
  for (let i = 0; i < kept.length; i++) notes[i] = [kept[i].t, kept[i].lane, kept[i].strength];

  const chart = {
    version: 1,
    trackId: trackDef.id,
    difficulty,
    bpm: trackDef.bpm,
    offsetMs: typeof trackDef.offsetMs === 'number' && Number.isFinite(trackDef.offsetMs) ? trackDef.offsetMs : 0,
    notes,
  };
  validateChart(chart);
  return chart;
}

export function validateChart(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('chart: payload is not an object');
  }
  if (obj.version !== 1) throw new Error('chart: unsupported version ' + obj.version);
  if (typeof obj.trackId !== 'string' || obj.trackId.length === 0) {
    throw new Error('chart: trackId must be a non-empty string');
  }
  if (!DIFFICULTIES.has(obj.difficulty)) throw new Error('chart: unknown difficulty ' + obj.difficulty);
  if (typeof obj.bpm !== 'number' || !Number.isFinite(obj.bpm) || obj.bpm <= 0) {
    throw new Error('chart: bpm must be a positive finite number');
  }
  if (typeof obj.offsetMs !== 'number' || !Number.isFinite(obj.offsetMs) || obj.offsetMs < 0) {
    throw new Error('chart: offsetMs must be a finite number >= 0');
  }
  if (!Array.isArray(obj.notes)) throw new Error('chart: notes must be an array');
  const lastTByLane = [-1, -1, -1, -1];
  let prevT = -1;
  for (let i = 0; i < obj.notes.length; i++) {
    const n = obj.notes[i];
    if (!Array.isArray(n) || n.length !== 3) {
      throw new Error('chart: note ' + i + ' is not [tMs,lane,strength]');
    }
    const t = n[0];
    const lane = n[1];
    const strength = n[2];
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) {
      throw new Error('chart: note ' + i + ' tMs must be a finite number >= 0');
    }
    if (t < prevT) throw new Error('chart: note ' + i + ' out of order, notes must be sorted by tMs');
    if (!Number.isInteger(lane) || lane < 0 || lane > 3) {
      throw new Error('chart: note ' + i + ' lane must be an integer in 0..3');
    }
    if (typeof strength !== 'number' || !Number.isFinite(strength) || strength <= 0 || strength > 1) {
      throw new Error('chart: note ' + i + ' strength must be a finite number in (0,1]');
    }
    if (t === lastTByLane[lane]) {
      throw new Error('chart: duplicate time ' + t + ' on lane ' + lane);
    }
    lastTByLane[lane] = t;
    prevT = t;
  }
}

export function serializeChart(chart) {
  validateChart(chart);
  return JSON.stringify(chart);
}

export function parseChart(json) {
  let obj;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new Error('chart: invalid JSON payload');
  }
  validateChart(obj);
  return obj;
}
