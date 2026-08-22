import { renderTrackAudio } from '../synth/composer.js';

const FFT_SIZE = 1024;
const SMOOTH_ATTACK = 0.5;
const SMOOTH_RELEASE = 0.14;
const METRO_POLL_MS = 25;
const METRO_LOOKAHEAD_S = 0.12;

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.comp = null;
    this.analyser = null;
    this.volume = 0.8;

    this.trackCache = new Map();
    this.playSource = null;
    this.startTime = null;
    this.playing = false;
    this.paused = false;
    this.handle = null;
    this.onEnd = null;

    this.pumpIdx = 0;
    this._pumpOut = [];

    this._fft = null;
    this._binEndBass = 3;
    this._binEndMid = 46;
    this._binEndTreb = 186;
    this._bands = { bass: 0, mid: 0, treb: 0 };

    this.hitBuffers = {};

    this.metroOn = false;
    this.metroBpm = 120;
    this.metroNext = 0;
    this.metroBeats = 0;
    this.metroTimer = null;
  }

  async init() {
    if (this.ctx) {
      await this.ensureRunning();
      return;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) throw new Error('audio: Web Audio not supported');
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0.35;
    this.master.connect(this.comp).connect(this.analyser).connect(ctx.destination);

    this._fft = new Uint8Array(this.analyser.frequencyBinCount);
    const binHz = ctx.sampleRate / FFT_SIZE;
    this._binEndBass = Math.max(1, Math.round(120 / binHz));
    this._binEndMid = Math.min(this._fft.length - 1, Math.round(2000 / binHz));
    this._binEndTreb = Math.min(this._fft.length, Math.round(8000 / binHz));

    await this._buildHitSounds();
    await this.ensureRunning();
  }

  ensureRunning() {
    if (!this.ctx) return Promise.resolve();
    if (this.ctx.state !== 'running') {
      return this.ctx.resume().catch(() => {});
    }
    return Promise.resolve();
  }

  async renderTrack(trackDef) {
    if (!this.ctx) throw new Error('audio: init() before renderTrack()');
    const cached = this.trackCache.get(trackDef.id);
    if (cached) return cached;
    const { buffer, timeline } = await renderTrackAudio(trackDef);
    const handle = { id: trackDef.id, buffer, durationMs: timeline.durationMs, timeline };
    this.trackCache.set(handle.id, handle);
    return handle;
  }

  play(handle, { onEnd } = {}) {
    if (!this.ctx || !handle || !handle.buffer) return;
    this._teardownSource();
    const src = this.ctx.createBufferSource();
    src.buffer = handle.buffer;
    src.connect(this.master);
    this.playSource = src;
    this.handle = handle;
    this.startTime = this.ctx.currentTime;
    this.playing = true;
    this.paused = false;
    this.onEnd = onEnd || null;
    this.pumpIdx = 0;
    src.onended = () => {
      if (this.playSource !== src) return;
      this.playSource = null;
      this.playing = false;
      this.paused = false;
      const cb = this.onEnd;
      this.onEnd = null;
      if (cb) cb();
    };
    src.start(this.ctx.currentTime, 0);
  }

  stop() {
    this.playing = false;
    this.paused = false;
    this.onEnd = null;
    this.handle = null;
    this._teardownSource();
  }

  _teardownSource() {
    const src = this.playSource;
    this.playSource = null;
    if (!src) return;
    try {
      src.stop();
    } catch (e) {}
    src.disconnect();
  }

  async pause() {
    if (!this.ctx || this.paused) return;
    this.paused = true;
    await this.ctx.suspend().catch(() => {});
  }

  async resume() {
    if (!this.ctx) return;
    if (this.playing) this.paused = false;
    await this.ctx.resume().catch(() => {});
  }

  getSongTimeMs() {
    if (!this.ctx || this.startTime == null) return 0;
    return Math.max(0, (this.ctx.currentTime - this.startTime) * 1000);
  }

  pumpEvents(lookAheadMs) {
    const out = this._pumpOut;
    out.length = 0;
    if (!this.playing || !this.handle) return out;
    const evs = this.handle.timeline.events;
    const horizon = this.getSongTimeMs() + lookAheadMs;
    while (this.pumpIdx < evs.length && evs[this.pumpIdx].tMs <= horizon) {
      out.push(evs[this.pumpIdx++]);
    }
    return out;
  }

  getBands() {
    const b = this._bands;
    if (!this.ctx || !this.analyser) {
      b.bass = 0;
      b.mid = 0;
      b.treb = 0;
      return b;
    }
    this.analyser.getByteFrequencyData(this._fft);
    const f = this._fft;
    const avg = (from, to, scale) => {
      let s = 0;
      for (let i = from; i < to; i++) s += f[i];
      const v = (s / ((to - from) * 255)) * scale;
      return v > 1 ? 1 : v;
    };
    const tb = avg(0, this._binEndBass, 1.05);
    const tm = avg(this._binEndBass, this._binEndMid, 1.25);
    const tt = avg(this._binEndMid, Math.max(this._binEndMid + 1, this._binEndTreb), 1.7);
    const lerp = (cur, target) =>
      cur + (target - cur) * (target > cur ? SMOOTH_ATTACK : SMOOTH_RELEASE);
    b.bass = lerp(b.bass, tb);
    b.mid = lerp(b.mid, tm);
    b.treb = lerp(b.treb, tt);
    return b;
  }

  hitSound(verdict) {
    const key = verdict == null ? 'MISS' : String(verdict).toUpperCase();
    const buf = this.hitBuffers[key] || this.hitBuffers.GOOD;
    if (!this.ctx || !buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.master);
    src.onended = () => src.disconnect();
    src.start(this.ctx.currentTime);
  }

  metronome(on, bpm = 120) {
    if (on) {
      if (!this.ctx) return;
      if (this.metroTimer) clearInterval(this.metroTimer);
      this.metroOn = true;
      this.metroBpm = bpm > 20 ? bpm : 120;
      this.metroNext = this.ctx.currentTime + 0.08;
      this.metroBeats = 0;
      if (!this.playing) this.startTime = this.metroNext;
      this.metroTimer = setInterval(() => this._metroTick(), METRO_POLL_MS);
    } else {
      this.metroOn = false;
      if (!this.playing) this.startTime = null;
      if (this.metroTimer) {
        clearInterval(this.metroTimer);
        this.metroTimer = null;
      }
    }
  }

  _metroTick() {
    if (!this.metroOn || !this.ctx) return;
    const spb = 60 / this.metroBpm;
    const horizon = this.ctx.currentTime + METRO_LOOKAHEAD_S;
    while (this.metroNext < horizon) {
      const accented = this.metroBeats % 4 === 0;
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = accented ? 1320 : 880;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(accented ? 0.22 : 0.14, this.metroNext);
      g.gain.exponentialRampToValueAtTime(0.001, this.metroNext + 0.055);
      o.connect(g).connect(this.master);
      o.onended = () => {
        o.disconnect();
        g.disconnect();
      };
      o.start(this.metroNext);
      o.stop(this.metroNext + 0.07);
      this.metroBeats++;
      this.metroNext += spb;
    }
  }

  setVolume(v) {
    this.volume = v < 0 ? 0 : v > 1 ? 1 : v;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  get contextTime() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  get isPlaying() {
    return this.playing;
  }

  async _buildHitSounds() {
    this.hitBuffers.PERFECT = await this._blip(0.14, (ctx, out) => {
      for (const [f, v] of [[1568, 0.5], [2349, 0.18]]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(v, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.13);
        o.connect(g).connect(out);
        o.start(ctx.currentTime);
        o.stop(ctx.currentTime + 0.14);
      }
    });
    this.hitBuffers.GREAT = await this._blip(0.13, (ctx, out) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 1046;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.42, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      o.connect(g).connect(out);
      o.start(ctx.currentTime);
      o.stop(ctx.currentTime + 0.13);
    });
    this.hitBuffers.GOOD = await this._blip(0.12, (ctx, out) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 523;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.4, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.11);
      o.connect(lp).connect(g).connect(out);
      o.start(ctx.currentTime);
      o.stop(ctx.currentTime + 0.12);
    });
    this.hitBuffers.MISS = await this._blip(0.22, (ctx, out) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(65, ctx.currentTime + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.55, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      o.connect(g).connect(out);
      o.start(ctx.currentTime);
      o.stop(ctx.currentTime + 0.22);
    });
  }

  async _blip(durSec, build) {
    const sr = 44100;
    const octx = new OfflineAudioContext(1, Math.max(1, Math.ceil(durSec * sr)), sr);
    const g = octx.createGain();
    g.gain.value = 1;
    g.connect(octx.destination);
    build(octx, g);
    return octx.startRendering();
  }
}

export const audio = new AudioEngine();
