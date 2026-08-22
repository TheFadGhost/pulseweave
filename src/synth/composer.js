import { mulberry32 } from '../core/rng.js';

export const LEAD_IN_S = 2.0;
export const SAMPLE_RATE = 44100;

const EPS = 1e-4;
const SCALE_MINOR = [0, 2, 3, 5, 7, 8, 10];

const DEFAULT_DRUMS = {
  kick: { low: 'x.......x.......', mid: 'x...x...x...x...', high: 'x...x..xx...x...', peak: 'x..xx..xx...x..x' },
  snare: { low: null, mid: '....x.......x...', high: '....x..x....x.x.', peak: '....x..x..x.x.x.' },
  hat: { low: '..x...x...x...x.', mid: '..x...x...x...x.', high: '..x.x.x.x.x.x.x.', peak: 'x.xxx.xxx.xxx.xx' },
};

const DEFAULT_BASS_DEGREES = [0, 5, 3, 6];
const DEFAULT_LEAD_PATTERNS = ['..1.3.5.'];

function resolvePattern(raw, energy, fallback) {
  let p = null;
  if (typeof raw === 'string') p = raw;
  else if (raw && typeof raw === 'object') p = raw[energy] || raw.mid || raw.high || raw.low || null;
  if (!p && fallback) {
    const f = typeof fallback === 'function' ? fallback(energy) : fallback[energy];
    return typeof f === 'string' && f.length > 0 ? f : null;
  }
  return typeof p === 'string' && p.length > 0 ? p : null;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function composeTimeline(trackDef) {
  const bpm = trackDef.bpm;
  const bars = Math.floor(trackDef.bars);
  const rootMidi = trackDef.rootMidi;
  if (!(bpm > 0) || !(bars >= 1) || !Number.isFinite(rootMidi)) {
    throw new Error('composer: trackDef needs numeric bpm>0, bars>=1, rootMidi');
  }

  const beatSec = 60 / bpm;
  const stepSec = beatSec / 4;
  const barSec = beatSec * 4;
  const offsetMs = LEAD_IN_S * 1000;
  const durationMs = Math.round(bars * barSec * 1000 + offsetMs);
  const stepMs = stepSec * 1000;

  const degMidi = (deg) => {
    const oct = Math.floor(deg / 7);
    const idx = ((deg % 7) + 7) % 7;
    return rootMidi + SCALE_MINOR[idx] + oct * 12;
  };
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const rng = mulberry32(trackDef.seed >>> 0);

  const sections =
    Array.isArray(trackDef.sections) && trackDef.sections.length
      ? [...trackDef.sections].sort((a, b) => a.startBar - b.startBar)
      : [{ startBar: 0, energy: 'mid' }];
  const energyAtBar = (bar) => {
    let e = 'low';
    for (const s of sections) if (bar >= s.startBar) e = s.energy;
    return e;
  };

  const events = [];
  const push = (tMs, kind, vel, extra) => {
    events.push(extra ? Object.assign({ tMs, kind, vel }, extra) : { tMs, kind, vel });
  };

  const drums = trackDef.drums || {};
  const bassline = trackDef.bassline || {};
  const leadCfg = trackDef.lead || {};

  const bassDegrees =
    Array.isArray(bassline.degrees) && bassline.degrees.length > 0
      ? bassline.degrees
      : DEFAULT_BASS_DEGREES;
  const leadPatterns =
    Array.isArray(leadCfg.patterns) && leadCfg.patterns.length > 0
      ? leadCfg.patterns
      : DEFAULT_LEAD_PATTERNS;
  const leadOctave = Number.isFinite(leadCfg.octave) ? leadCfg.octave : 5;
  const leadBaseMidi = rootMidi + 12 * (leadOctave - 4);

  for (let bar = 0; bar < bars; bar++) {
    const energy = energyAtBar(bar);
    const barTms = offsetMs + bar * barSec * 1000;

    const kickPat = resolvePattern(drums.kick, energy, DEFAULT_DRUMS.kick);
    const snarePat = resolvePattern(drums.snare, energy, DEFAULT_DRUMS.snare);
    const hatPat = resolvePattern(drums.hat, energy, DEFAULT_DRUMS.hat);

    for (let s = 0; s < 16; s++) {
      const tMs = barTms + s * stepMs;
      if (kickPat) {
        const ch = kickPat[s % kickPat.length];
        if (ch === 'x' || ch === 'X') {
          push(tMs, 'kick', clamp01((ch === 'X' ? 1 : 0.88) * (energy === 'peak' ? 1 : 0.94)));
        }
      }
      if (snarePat) {
        const ch = snarePat[s % snarePat.length];
        if (ch === 'x' || ch === 'X') {
          push(tMs, 'snare', clamp01(ch === 'X' ? 0.95 : 0.78));
        }
      }
      if (hatPat) {
        const ch = hatPat[s % hatPat.length];
        if (ch === 'x' || ch === 'X') {
          push(tMs, 'hat', clamp01((ch === 'X' ? 0.68 : 0.42) * (0.88 + rng() * 0.24)));
        }
      }
    }

    const bassPat = resolvePattern(
      bassline.rhythm,
      energy,
      () => (energy === 'low' ? 'x.......x.......' : 'x..x..x.')
    );
    if (bassPat) {
      const deg = bassDegrees[bar % bassDegrees.length];
      for (let s = 0; s < 16; s++) {
        const ch = bassPat[s % bassPat.length];
        if (ch === 'x' || ch === 'X') {
          const fifth = (energy === 'high' || energy === 'peak') && s % 4 === 3;
          const d = fifth ? deg + 4 : deg;
          push(barTms + s * stepMs, 'bass', ch === 'X' ? 0.95 : 0.8, { freq: hz(degMidi(d) - 24) });
        }
      }
    }

    if (energy !== 'low' && (energy !== 'mid' || bar % 2 === 1)) {
      const pat = String(leadPatterns[bar % leadPatterns.length]);
      for (let s = 0; s < pat.length && s < 16; s++) {
        const c = pat[s];
        if (c >= '1' && c <= '9') {
          const idx = c.charCodeAt(0) - 49;
          const midi = leadBaseMidi + SCALE_MINOR[idx % 7] + Math.floor(idx / 7) * 12;
          push(barTms + s * stepMs, 'lead', clamp01(0.58 + rng() * 0.18), { freq: hz(midi) });
        }
      }
    }
  }

  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    if (!(sec.startBar < bars)) continue;
    const endBar = si + 1 < sections.length ? Math.min(sections[si + 1].startBar, bars) : bars;
    for (let b = sec.startBar; b < endBar; b += 2) {
      const span = Math.min(2, endBar - b);
      const dg = bassDegrees[b % bassDegrees.length];
      const freqs = [0, 2, 4].map((k) => hz(degMidi(dg + k) - 12));
      push(offsetMs + b * barSec * 1000, 'pad', 0.34, {
        freq: freqs[0],
        durMs: span * barSec * 1000,
        freqs,
      });
    }
  }

  push(offsetMs, 'impact', 0.8, { freq: hz(rootMidi - 24) });
  const impactBars = new Set([0]);
  for (let si = 1; si < sections.length; si++) {
    const b = sections[si].startBar;
    if (!(b >= 1) || b > bars) continue;
    push(offsetMs + (b - 1) * barSec * 1000, 'riser', 0.55, { durMs: barSec * 1000 });
    if (b < bars) {
      push(offsetMs + b * barSec * 1000, 'impact', 0.95, { freq: hz(rootMidi - 24) });
      impactBars.add(b);
    }
  }
  if (!impactBars.has(bars - 1)) {
    push(offsetMs + (bars - 1) * barSec * 1000, 'impact', 0.95, { freq: hz(rootMidi - 24) });
  }

  events.sort((a, b) => a.tMs - b.tMs);

  return { events, bpm, offsetMs, durationMs };
}

function makeNoiseBuffer(ctx, rng, seconds) {
  const len = Math.ceil(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = rng() * 2 - 1;
  return buf;
}

function startNoise(ctx, buf, rng, t, durSec) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = durSec > buf.duration - 0.01;
  const off = Math.floor(rng() * buf.duration * 0.5);
  src.start(t, off);
  return src;
}

function trigKick(ctx, out, nb, rng, t, vel) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(165, t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.085);
  o.frequency.exponentialRampToValueAtTime(41, t + 0.26);
  const g = ctx.createGain();
  g.gain.setValueAtTime(EPS, t);
  g.gain.exponentialRampToValueAtTime(Math.max(vel, 0.01), t + 0.004);
  g.gain.exponentialRampToValueAtTime(EPS, t + 0.3);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.32);

  const n = startNoise(ctx, nb, rng, t, 0.03);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(vel * 0.35, t);
  ng.gain.exponentialRampToValueAtTime(EPS, t + 0.022);
  n.connect(hp).connect(ng).connect(out);
  n.stop(t + 0.03);
}

function trigSnare(ctx, out, nb, rng, t, vel) {
  const tone = ctx.createOscillator();
  tone.type = 'sine';
  tone.frequency.setValueAtTime(182, t);
  tone.frequency.exponentialRampToValueAtTime(158, t + 0.07);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(vel * 0.5, t);
  tg.gain.exponentialRampToValueAtTime(EPS, t + 0.08);
  tone.connect(tg).connect(out);
  tone.start(t);
  tone.stop(t + 0.09);

  const n = startNoise(ctx, nb, rng, t, 0.18);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1700;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(vel * 0.8, t);
  ng.gain.exponentialRampToValueAtTime(EPS, t + 0.16);
  n.connect(hp).connect(ng).connect(out);
  n.stop(t + 0.18);
}

function trigHat(ctx, out, nb, rng, t, vel) {
  const n = startNoise(ctx, nb, rng, t, 0.05);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7500;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 10000;
  bp.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel, t);
  g.gain.exponentialRampToValueAtTime(EPS, t + 0.042);
  n.connect(hp).connect(bp).connect(g).connect(out);
  n.stop(t + 0.05);
}

function trigBass(ctx, out, t, vel, freq, durSec) {
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(freq, t);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 3;
  lp.frequency.setValueAtTime(Math.min(freq * 12, 4200), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(freq * 1.6, 80), t + Math.min(0.22, durSec));
  const g = ctx.createGain();
  g.gain.setValueAtTime(EPS, t);
  g.gain.linearRampToValueAtTime(vel * 0.85, t + 0.006);
  g.gain.setValueAtTime(vel * 0.85, t + durSec * 0.75);
  g.gain.exponentialRampToValueAtTime(EPS, t + durSec);
  o.connect(lp).connect(g).connect(out);
  o.start(t);
  o.stop(t + durSec + 0.05);
}

function trigLead(ctx, out, t, vel, freq, durSec) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 5200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(EPS, t);
  g.gain.linearRampToValueAtTime(vel * 0.6, t + 0.005);
  g.gain.exponentialRampToValueAtTime(Math.max(vel * 0.38, EPS), t + 0.09);
  g.gain.setValueAtTime(vel * 0.38, t + durSec * 0.7);
  g.gain.exponentialRampToValueAtTime(EPS, t + durSec + 0.02);
  for (let i = 0; i < 2; i++) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = i === 0 ? -6 : 6;
    o.connect(lp);
    o.start(t);
    o.stop(t + durSec + 0.05);
  }
  lp.connect(g).connect(out);
}

function trigPad(ctx, out, t, vel, freqs, durSec) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  lp.Q.value = 0.4;
  const g = ctx.createGain();
  const peak = (vel * 0.9) / freqs.length / 2;
  const atk = Math.min(0.8, durSec * 0.3);
  g.gain.setValueAtTime(EPS, t);
  g.gain.linearRampToValueAtTime(peak, t + atk);
  g.gain.setValueAtTime(peak, t + durSec * 0.8);
  g.gain.exponentialRampToValueAtTime(EPS, t + durSec * 1.02);
  for (const f of freqs) {
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      o.detune.value = i === 0 ? -7 : 7;
      o.connect(lp);
      o.start(t);
      o.stop(t + durSec * 1.03 + 0.05);
    }
  }
  lp.connect(g).connect(out);
}

function trigImpact(ctx, out, nb, rng, t, vel, freq, endT) {
  const boomDur = Math.min(1.15, endT - t);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(Math.max(freq, 40), t);
  o.frequency.exponentialRampToValueAtTime(Math.max(freq * 0.45, 28), t + boomDur * 0.8);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel * 0.9, t);
  g.gain.exponentialRampToValueAtTime(EPS, t + boomDur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + boomDur + 0.05);

  const washDur = Math.min(0.9, endT - t);
  const n = startNoise(ctx, nb, rng, t, washDur);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2800, t);
  lp.frequency.exponentialRampToValueAtTime(200, t + washDur);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(vel * 0.5, t);
  ng.gain.exponentialRampToValueAtTime(EPS, t + washDur);
  n.connect(lp).connect(ng).connect(out);
  n.stop(t + washDur + 0.02);
}

function trigRiser(ctx, out, nb, rng, t, vel, durSec) {
  const n = startNoise(ctx, nb, rng, t, durSec);
  n.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(240, t);
  bp.frequency.exponentialRampToValueAtTime(3800, t + durSec * 0.96);
  const g = ctx.createGain();
  g.gain.setValueAtTime(EPS, t);
  g.gain.linearRampToValueAtTime(vel * 0.9, t + durSec * 0.92);
  g.gain.exponentialRampToValueAtTime(EPS, t + durSec + 0.04);
  n.connect(bp).connect(g).connect(out);
  n.stop(t + durSec + 0.08);
}

const BUS_LEVELS = { kick: 0.95, snare: 0.6, hat: 0.3, bass: 0.52, lead: 0.34, pad: 0.42, impact: 0.72, riser: 0.46 };
const BUS_PANS = { kick: 0, snare: 0.08, hat: -0.18, bass: 0, lead: 0.14, pad: -0.04, impact: 0, riser: 0.1 };

export async function renderTrackAudio(trackDef) {
  const timeline = composeTimeline(trackDef);
  const sr = SAMPLE_RATE;
  const frames = Math.max(1, Math.ceil((timeline.durationMs / 1000) * sr));
  const ctx = new OfflineAudioContext(2, frames, sr);
  const endT = frames / sr - 0.02;

  const nrng = mulberry32(((trackDef.seed >>> 0) ^ 0x9e3779b9) >>> 0);
  const nb = makeNoiseBuffer(ctx, nrng, 2);

  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 18;
  comp.ratio.value = 5;
  comp.attack.value = 0.004;
  comp.release.value = 0.22;
  master.connect(comp).connect(ctx.destination);

  const buses = {};
  for (const kind of Object.keys(BUS_LEVELS)) {
    const bus = ctx.createGain();
    bus.gain.value = BUS_LEVELS[kind];
    const pan = new StereoPannerNode(ctx, { pan: BUS_PANS[kind] });
    bus.connect(pan).connect(master);
    buses[kind] = bus;
  }

  for (const ev of timeline.events) {
    const t = ev.tMs / 1000;
    if (t >= endT) continue;
    switch (ev.kind) {
      case 'kick':
        trigKick(ctx, buses.kick, nb, nrng, t, ev.vel);
        break;
      case 'snare':
        trigSnare(ctx, buses.snare, nb, nrng, t, ev.vel);
        break;
      case 'hat':
        trigHat(ctx, buses.hat, nb, nrng, t, ev.vel);
        break;
      case 'bass':
        trigBass(ctx, buses.bass, t, ev.vel, ev.freq || 55, stepSecOf(timeline) * 0.9);
        break;
      case 'lead':
        trigLead(ctx, buses.lead, t, ev.vel, ev.freq || 440, stepSecOf(timeline) * 0.92);
        break;
      case 'pad':
        trigPad(ctx, buses.pad, t, ev.vel, ev.freqs || [ev.freq || 220], (ev.durMs || 2000) / 1000);
        break;
      case 'impact':
        trigImpact(ctx, buses.impact, nb, nrng, t, ev.vel, ev.freq || 55, endT);
        break;
      case 'riser':
        trigRiser(ctx, buses.riser, nb, nrng, t, ev.vel, Math.min((ev.durMs || 2000) / 1000, endT - t));
        break;
    }
  }

  const buffer = await ctx.startRendering();
  return { buffer, timeline };
}

function stepSecOf(timeline) {
  return 60 / timeline.bpm / 4;
}
