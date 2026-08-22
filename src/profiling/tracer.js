const CAP = 2048;
const LANES = 4;
const DEPTH = 16;
const WINDOW_MS = 50;
const RECENT = 6;
const FPS_CAP = 120;
const OVERLAY_HZ = 100;
const FRAME_STALL_MS = 250;
const VERDICT_CODES = { PERFECT: 0, GREAT: 1, GOOD: 2, MISS: 3 };

function asc(a, b) {
  return a - b;
}

function nearestRank(sorted, p) {
  const n = sorted.length;
  if (n === 0) return 0;
  let k = Math.ceil((p / 100) * n);
  if (k < 1) k = 1;
  if (k > n) k = n;
  return sorted[k - 1];
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

function meterBar(v, w = 10) {
  const x = v < 0 ? 0 : v > 1 ? 1 : v;
  const f = Math.round(x * w);
  return '█'.repeat(f) + '░'.repeat(w - f);
}

export class Tracer {
  constructor() {
    this._inLane = new Int8Array(CAP);
    this._inPerf = new Float64Array(CAP);
    this._jdLane = new Int8Array(CAP);
    this._jdCode = new Int8Array(CAP);
    this._jdDelta = new Float64Array(CAP);
    this._jdPerf = new Float64Array(CAP);
    this._sdLane = new Int8Array(CAP);
    this._sdPerf = new Float64Array(CAP);
    this._sdCtx = new Float64Array(CAP);
    this._frDt = new Float64Array(CAP);
    this._beErr = new Float64Array(CAP);
    this._i2j = new Float64Array(CAP);
    this._j2s = new Float64Array(CAP);
    this._sw = new Float64Array(CAP);
    this._pinPerf = new Float64Array(LANES * DEPTH);
    this._pjdPerf = new Float64Array(LANES * DEPTH);
    this._pjdInPerf = new Float64Array(LANES * DEPTH);
    this._pinN = new Int32Array(LANES);
    this._pjdN = new Int32Array(LANES);
    this._recent = new Float64Array(RECENT);
    this._scratch = [];
    this.reset();
  }

  markInput(lane, perfMs) {
    const w = this._inW;
    this._inLane[w] = lane;
    this._inPerf[w] = perfMs;
    this._inW = (w + 1) % CAP;
    if (this._inN < CAP) this._inN++;
    const base = lane * DEPTH;
    if (this._pinN[lane] === DEPTH) {
      for (let i = 1; i < DEPTH; i++) this._pinPerf[base + i - 1] = this._pinPerf[base + i];
      this._pinN[lane] = DEPTH - 1;
    }
    this._pinPerf[base + this._pinN[lane]++] = perfMs;
  }

  markJudged(lane, verdict, deltaMs, perfMs) {
    const code =
      typeof verdict === 'string' ?
        VERDICT_CODES[verdict.toUpperCase()] ?? -1 :
        -1;
    const w = this._jdW;
    this._jdLane[w] = lane;
    this._jdCode[w] = code;
    this._jdDelta[w] = deltaMs;
    this._jdPerf[w] = perfMs;
    this._jdW = (w + 1) % CAP;
    if (this._jdN < CAP) this._jdN++;

    const base = lane * DEPTH;
    let n = this._pinN[lane];
    let matchedInPerf = NaN;
    if (n > 0) {
      const top = this._pinPerf[base + n - 1];
      const age = perfMs - top;
      if (age >= 0 && age <= WINDOW_MS) {
        matchedInPerf = top;
        n--;
        const m = this._i2jW;
        this._i2j[m] = age;
        this._i2jW = (m + 1) % CAP;
        if (this._i2jN < CAP) this._i2jN++;
        this._recent[this._rw] = age;
        this._rw = (this._rw + 1) % RECENT;
        if (this._rn < RECENT) this._rn++;
      }
    }
    this._pinN[lane] = n;
    if (matchedInPerf !== matchedInPerf) this._orphans++;

    if (this._pjdN[lane] === DEPTH) {
      for (let i = 1; i < DEPTH; i++) {
        this._pjdPerf[base + i - 1] = this._pjdPerf[base + i];
        this._pjdInPerf[base + i - 1] = this._pjdInPerf[base + i];
      }
      this._pjdN[lane] = DEPTH - 1;
    }
    this._pjdPerf[base + this._pjdN[lane]] = perfMs;
    this._pjdInPerf[base + this._pjdN[lane]] = matchedInPerf;
    this._pjdN[lane]++;
  }

  markSoundScheduled(lane, perfMs, ctxScheduledS) {
    const w = this._sdW;
    this._sdLane[w] = lane;
    this._sdPerf[w] = perfMs;
    this._sdCtx[w] = ctxScheduledS;
    this._sdW = (w + 1) % CAP;
    if (this._sdN < CAP) this._sdN++;

    const base = lane * DEPTH;
    const n = this._pjdN[lane];
    if (n > 0) {
      const jdPerf = this._pjdPerf[base + n - 1];
      const age = perfMs - jdPerf;
      if (age >= 0 && age <= WINDOW_MS) {
        const m = this._j2sW;
        this._j2s[m] = age;
        this._j2sW = (m + 1) % CAP;
        if (this._j2sN < CAP) this._j2sN++;
        const inPerf = this._pjdInPerf[base + n - 1];
        if (inPerf === inPerf) {
          const s = this._swW;
          this._sw[s] = perfMs - inPerf;
          this._swW = (s + 1) % CAP;
          if (this._swN < CAP) this._swN++;
        }
        this._pjdN[lane] = n - 1;
        return;
      }
    }
    this._orphans++;
  }

  markFrame(perfMs, songMs) {
    const prev = this._frPrev;
    this._frPrev = perfMs;
    if (prev !== prev) return;
    const dt = perfMs - prev;
    if (dt <= 0 || dt > FRAME_STALL_MS) return;
    const w = this._frW;
    this._frDt[w] = dt;
    this._frW = (w + 1) % CAP;
    if (this._frN < CAP) this._frN++;
  }

  markBeatFired(targetSongMs, actualSongMs) {
    const w = this._beW;
    this._beErr[w] = Math.abs(actualSongMs - targetSongMs);
    this._beW = (w + 1) % CAP;
    if (this._beN < CAP) this._beN++;
  }

  recentInputToJudged() {
    const out = [];
    const start = (this._rw - this._rn + RECENT) % RECENT;
    for (let i = 0; i < this._rn; i++) out.push(this._recent[(start + i) % RECENT]);
    return out;
  }

  report() {
    const scratch = this._scratch;
    const stat = (src, n, w) => {
      scratch.length = 0;
      const start = (w - n + CAP) % CAP;
      for (let i = 0; i < n; i++) scratch.push(src[(start + i) % CAP]);
      if (n > 1) scratch.sort(asc);
      return {
        p50: round3(nearestRank(scratch, 50)),
        p95: round3(nearestRank(scratch, 95)),
        n,
      };
    };

    const inputToJudged = stat(this._i2j, this._i2jN, this._i2jW);
    const judgedToSound = stat(this._j2s, this._j2sN, this._j2sW);
    const softwareTotal = stat(this._sw, this._swN, this._swW);
    const beatFireErrorsRaw = stat(this._beErr, this._beN, this._beW);

    scratch.length = 0;
    let sum = 0;
    let max = 0;
    let over20 = 0;
    const start = (this._frW - this._frN + CAP) % CAP;
    for (let i = 0; i < this._frN; i++) {
      const v = this._frDt[(start + i) % CAP];
      scratch.push(v);
      sum += v;
      if (v > max) max = v;
      if (v > 20) over20++;
    }
    if (this._frN > 1) scratch.sort(asc);
    const frames = {
      mean: round3(this._frN ? sum / this._frN : 0),
      median: round3(nearestRank(scratch, 50)),
      p95: round3(nearestRank(scratch, 95)),
      max: round3(max),
      over20,
      count: this._frN,
    };

    scratch.length = 0;
    const bStart = (this._beW - this._beN + CAP) % CAP;
    let beMax = 0;
    for (let i = 0; i < this._beN; i++) {
      const v = this._beErr[(bStart + i) % CAP];
      scratch.push(v);
      if (v > beMax) beMax = v;
    }
    if (this._beN > 1) scratch.sort(asc);
    const beatFireErrors = {
      p50: round3(nearestRank(scratch, 50)),
      p95: round3(nearestRank(scratch, 95)),
      max: round3(beMax),
      count: this._beN,
    };

    return { inputToJudged, judgedToSound, softwareTotal, frames, beatFireErrors, orphans: this._orphans };
  }

  reset() {
    this._inLane.fill(0);
    this._inPerf.fill(0);
    this._jdLane.fill(0);
    this._jdCode.fill(0);
    this._jdDelta.fill(0);
    this._jdPerf.fill(0);
    this._sdLane.fill(0);
    this._sdPerf.fill(0);
    this._sdCtx.fill(0);
    this._frDt.fill(0);
    this._beErr.fill(0);
    this._i2j.fill(0);
    this._j2s.fill(0);
    this._sw.fill(0);
    this._pinPerf.fill(0);
    this._pjdPerf.fill(0);
    this._pjdInPerf.fill(0);
    this._pinN.fill(0);
    this._pjdN.fill(0);
    this._recent.fill(0);
    this._inW = 0;
    this._inN = 0;
    this._jdW = 0;
    this._jdN = 0;
    this._sdW = 0;
    this._sdN = 0;
    this._frW = 0;
    this._frN = 0;
    this._beW = 0;
    this._beN = 0;
    this._i2jW = 0;
    this._i2jN = 0;
    this._j2sW = 0;
    this._j2sN = 0;
    this._swW = 0;
    this._swN = 0;
    this._rw = 0;
    this._rn = 0;
    this._frPrev = NaN;
    this._orphans = 0;
    this._scratch.length = 0;
  }
}

export const tracer = new Tracer();

export class DebugOverlay {
  constructor() {
    this._el = null;
    this._timer = 0;
    this._fpsTs = new Float64Array(FPS_CAP);
    this._fw = 0;
    this._fn = 0;
    this._songMs = 0;
    this._bands = { bass: 0, mid: 0, treb: 0 };
  }

  attach(rootEl) {
    const root = rootEl || (typeof document !== 'undefined' ? document.body : null);
    if (!root) return;
    if (this._el) this.detach();
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;top:8px;right:8px;z-index:2147483647;padding:8px 10px;' +
      'font:11px/1.55 ui-monospace,Menlo,Consolas,monospace;' +
      'background:rgba(0,0,0,0.6);color:#35f2ff;border-radius:4px;' +
      'pointer-events:none;white-space:pre;text-align:left;';
    root.appendChild(el);
    this._el = el;
    this._timer = setInterval(() => this._render(), OVERLAY_HZ);
  }

  detach() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = 0;
    }
    if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
    this._el = null;
  }

  tick(perfMs) {
    this._fpsTs[this._fw] = perfMs;
    this._fw = (this._fw + 1) % FPS_CAP;
    if (this._fn < FPS_CAP) this._fn++;
  }

  setInfo(info) {
    if (!info) return;
    if (typeof info.songMs === 'number') this._songMs = info.songMs;
    const b = info.bands;
    if (b) {
      this._bands.bass = typeof b.bass === 'number' ? b.bass : 0;
      this._bands.mid = typeof b.mid === 'number' ? b.mid : 0;
      this._bands.treb = typeof b.treb === 'number' ? b.treb : 0;
    }
  }

  _fpsValue() {
    if (this._fn < 2) return 0;
    const newest = this._fpsTs[(this._fw - 1 + FPS_CAP) % FPS_CAP];
    const oldest = this._fpsTs[(this._fw - this._fn + FPS_CAP) % FPS_CAP];
    const span = newest - oldest;
    if (span <= 0) return 0;
    return ((this._fn - 1) * 1000) / span;
  }

  _render() {
    if (!this._el) return;
    const rep = tracer.report();
    const recent = tracer.recentInputToJudged();
    const lines = [
      'PULSEWEAVE',
      'fps     ' + this._fpsValue().toFixed(1),
      'frame95 ' + rep.frames.p95.toFixed(1) + ' ms',
      'song    ' + (this._songMs / 1000).toFixed(2) + ' s',
      'bass    ' + meterBar(this._bands.bass),
      'mid     ' + meterBar(this._bands.mid),
      'treb    ' + meterBar(this._bands.treb),
      'i2j ms  ' + (recent.length ? recent.map((v) => v.toFixed(2)).join(' ') : '-'),
    ];
    this._el.innerHTML = lines.join('<br>');
  }
}

async function silentHandle(audio, durationMs) {
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OAC || !audio.ctx) throw new Error('selftest: no AudioContext available for playback');
  const sr = audio.ctx.sampleRate;
  const octx = new OAC(1, Math.max(1, Math.ceil((durationMs / 1000) * sr)), sr);
  const buffer = await octx.startRendering();
  return {
    id: 'selftest-silent',
    buffer,
    durationMs,
    timeline: { events: [], bpm: 0, offsetMs: 0, durationMs },
  };
}

export async function runSelfTest(deps) {
  if (typeof requestAnimationFrame === 'undefined') {
    throw new Error('selftest: browser environment required');
  }
  const { audio, clock, stage, hud, chart } = deps;
  if (!audio || !clock || !chart) throw new Error('selftest: deps require audio, clock, chart');

  const durationMs =
    deps.durationMs ||
    (chart.notes.length ? chart.notes[chart.notes.length - 1][0] + 2000 : 30000);
  const jitterOffsetMs = typeof deps.jitterOffsetMs === 'number' ? deps.jitterOffsetMs : 12;

  tracer.reset();
  if (!audio.ctx && typeof audio.init === 'function') await audio.init();
  await audio.ensureRunning();

  const session = await deps.sessionFactory(chart);

  const prevOffset = clock.offsetMs || 0;
  clock.offsetMs = 0;
  clock.reset();

  let handle = deps.trackHandle || null;
  if (!handle && audio.handle && audio.handle.buffer) handle = audio.handle;
  if (!handle) handle = await silentHandle(audio, durationMs);

  const rows = [];
  const notes = chart.notes.slice().sort((a, b) => a[0] - b[0]);
  let noteIdx = 0;

  const laneDown = (lane, perfTs) => {
    tracer.markInput(lane, perfTs);
    const conv = clock.inputToSong ? clock.inputToSong(perfTs) : clock.songAt(perfTs);
    const res = session.onTap(lane, conv);
    if (!res) return null;
    const judgedPerf = performance.now();
    tracer.markJudged(lane, res.verdict, res.deltaMs, judgedPerf);
    audio.hitSound(res.verdict);
    const ctxS = audio.contextTime;
    tracer.markSoundScheduled(lane, performance.now(), ctxS);
    if (stage && typeof stage.hitFlash === 'function') stage.hitFlash(lane, res.verdict, res.deltaMs);
    const visualMarkedPerf = performance.now();
    rows.push({
      noteT: round3(res.note.t),
      injectedPerf: round3(perfTs),
      judgedPerf: round3(judgedPerf),
      judgedDelta: round3(res.deltaMs),
      soundScheduledCtxMs: round3(ctxS * 1000),
      visualMarkedPerf: round3(visualMarkedPerf),
    });
    if (hud && typeof hud.update === 'function') hud.update(session.stats, audio.getSongTimeMs());
    return res;
  };

  // Transport: prefer the real input-module path (deps.setOnLaneDown wires our
  // pipeline as input.js's onLaneDown, then deps.injectLaneDown drives it);
  // fall back to invoking the pipeline directly.
  if (typeof deps.setOnLaneDown === 'function') deps.setOnLaneDown(laneDown);
  const inject = typeof deps.injectLaneDown === 'function' ? deps.injectLaneDown : laneDown;

  let lastP = performance.now();
  let lastS = 0;
  let prevP = lastP;
  let prevS = 0;
  let havePrev = false;
  const perfFor = (songT) => {
    if (!havePrev) return lastP + songT - lastS;
    let rate = (lastS - prevS) / Math.max(lastP - prevP, 0.5);
    if (!(rate > 0.01)) rate = 1;
    return lastS + (songT - lastS) / rate;
  };
  const shiftSample = (p, s) => {
    prevP = lastP;
    prevS = lastS;
    lastP = p;
    lastS = s;
    havePrev = true;
  };

  const overlay = new DebugOverlay();
  overlay.attach(typeof document !== 'undefined' ? document.body : null);

  let ended = false;
  let finished = false;
  let raf = 0;
  const startPerf = performance.now();
  audio.play(handle, {
    onEnd: () => {
      ended = true;
    },
  });
  lastS = audio.getSongTimeMs();

  await new Promise((resolve) => {
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      overlay.detach();
      audio.stop();
      clock.offsetMs = prevOffset;
      resolve();
    };
    let lastStepPerf = startPerf;
    const step = () => {
      if (ended) return finish();
      const pn = performance.now();
      const sn = audio.getSongTimeMs();
      clock.sample(pn, sn);
      shiftSample(pn, sn);
      tracer.markFrame(pn, sn);
      overlay.tick(pn);
      overlay.setInfo({ songMs: sn, bands: audio.getBands() });

      while (noteIdx < notes.length) {
        const note = notes[noteIdx];
        const targetPerf = perfFor(note[0] + jitterOffsetMs);
        if (pn < targetPerf) break;
        noteIdx++;
        inject(note[1], targetPerf);
      }

      const evs = audio.pumpEvents(80);
      if (stage && typeof stage.pushEvents === 'function') stage.pushEvents(evs);
      for (let i = 0; i < evs.length; i++) {
        if (evs[i].tMs <= sn) tracer.markBeatFired(evs[i].tMs, sn);
      }
      session.sweep(sn);

      if (stage && typeof stage.update === 'function') {
        stage.update(Math.min((pn - lastStepPerf) / 1000, 0.25), {
          songTimeMs: sn,
          bands: audio.getBands(),
          playing: true,
        });
      }
      if (stage && typeof stage.render === 'function') stage.render();
      lastStepPerf = pn;

      if (sn >= durationMs || pn - startPerf > durationMs + 1500) return finish();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  });

  const summary = tracer.report();
  const verdicts = {
    inputToJudgedP95: summary.inputToJudged.p95 <= 2 ? 'PASS' : 'FAIL',
    softwareTotalP95: summary.softwareTotal.p95 <= 8 ? 'PASS' : 'FAIL',
    beatFireErrorP95: summary.beatFireErrors.p95 <= 8 ? 'PASS' : 'FAIL',
  };
  if (typeof console !== 'undefined' && console.table) console.table(rows);
  return { rows, summary, verdicts };
}

export const initSelfTest = runSelfTest;
