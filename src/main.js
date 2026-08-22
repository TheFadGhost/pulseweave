import './ui/overlay.css';
import { audio } from './audio/engine.js';
import { createStage } from './gfx/scene.js';
import { ReactiveStage } from './gfx/stage-reactive.js';
import { buildChart } from './game/chart.js';
import Session from './game/session.js';
import { TRACKS } from './content/tracks.js';
import { initInput, injectLaneDown } from './input/input.js';
import { Clock } from './core/clock.js';
import { ScreenManager } from './ui/screens.js';
import { Hud } from './ui/hud.js';
import { ResultsScreen } from './ui/results.js';
import { CalibrationFlow } from './ui/calibration.js';
import { tracer, DebugOverlay, runSelfTest } from './profiling/tracer.js';

const params = new URLSearchParams(location.search);
const quality = params.get('quality') === 'low' ? 'low' : 'high';
const demoMode = params.get('demo') === '1';
const selftestMode = params.get('selftest') === '1';
const paramTrack = params.get('track');
const paramDiff = params.get('diff');

const CALIB_KEY = 'pw.calib';

let stage, reactive, screens, hud, results, overlay;
let state = 'BOOT';
let currentTrack = null;
let currentDiff = null;
let handle = null;
let session = null;
let laneHandler = null;
let calibFlow = null;
let pausedOverlay = null;

const clock = new Clock();
let lastPerf = performance.now();
let lastHud = { score: -1, combo: -1, acc: -1 };
let demoIdx = 0;
let demoNotes = [];
let overlayOn = false;

const bandsCopy = { bass: 0, mid: 0, treb: 0 };

function loadCalib() {
  try {
    const raw = localStorage.getItem(CALIB_KEY);
    if (!raw) return 0;
    const v = JSON.parse(raw).offsetMs;
    return typeof v === 'number' && Math.abs(v) <= 300 ? v : 0;
  } catch {
    return 0;
  }
}

function setReactivePalette(palette) {
  if (reactive) reactive.dispose();
  reactive = new ReactiveStage(stage, palette || {}, { quality });
}

function ensureCanvas() {
  const c = document.getElementById('gl');
  if (!c) throw new Error('main: #gl canvas missing');
  return c;
}

async function startTrack(track, difficulty) {
  if (state === 'LOADING') return;
  state = 'LOADING';
  currentTrack = track;
  currentDiff = difficulty;
  screens.show('LOADING', { title: track.title });
  screens.setProgress(0.15);
  try {
    await audio.ensureRunning();
    await new Promise((r) => setTimeout(r, 30));
    handle = await audio.renderTrack(track);
    screens.setProgress(0.8);
    const chart = buildChart(track, handle.timeline.events, difficulty);
    screens.setProgress(0.95);
    session = new Session(chart);
    demoIdx = 0;
    demoNotes = chart.notes;
    tracer.reset();
    clock.reset();
    clock.offsetMs = loadCalib();
    setReactivePalette(track.colors);
    reactive.setChartBounds(handle.durationMs);
    screens.hide();
    hud.show();
    state = 'PLAY';
    lastHud = { score: -1, combo: -1, acc: -1 };
    audio.play(handle, { onEnd: finishPlay });
  } catch (err) {
    state = 'MENU';
    hud.hide();
    audio.stop();
    screens.show('ERROR', { message: String((err && err.message) || err) });
  }
}

function finishPlay() {
  if (state !== 'PLAY') return;
  state = 'RESULTS';
  session.sweep(audio.getSongTimeMs());
  hud.hide();
  reactive.enqueueNotes([]);
  results.show(session.stats, {
    onRetry: () => {
      results.hide();
      startTrack(currentTrack, currentDiff);
    },
    onMenu: () => {
      results.hide();
      toMenu();
    },
    trackId: currentTrack.id,
    difficulty: currentDiff,
    title: currentTrack.title,
  });
}

function toMenu() {
  state = 'MENU';
  audio.stop();
  audio.metronome(false);
  hud.hide();
  session = null;
  screens.show('MENU');
}

function togglePause() {
  if (state === 'PLAY') {
    state = 'PAUSED';
    audio.pause();
    showPaused(true);
  } else if (state === 'PAUSED') {
    state = 'PLAY';
    audio.resume();
    showPaused(false);
    lastPerf = performance.now();
  }
}

function showPaused(on) {
  if (on && !pausedOverlay) {
    pausedOverlay = document.createElement('div');
    pausedOverlay.className = 'pw-layer pw-pause-layer';
    pausedOverlay.innerHTML = '<div class="pw-pause-box"><p class="pw-kicker">PAUSED</p><p>press ESC to resume</p></div>';
    document.body.appendChild(pausedOverlay);
  } else if (!on && pausedOverlay) {
    pausedOverlay.remove();
    pausedOverlay = null;
  }
}

function pipelineTap(lane, perfTs) {
  if (state !== 'PLAY' || !session) return;
  tracer.markInput(lane, perfTs);
  const res = session.onTap(lane, clock.inputToSong(perfTs));
  if (!res) return;
  tracer.markJudged(lane, res.verdict, res.deltaMs, performance.now());
  audio.hitSound(res.verdict);
  tracer.markSoundScheduled(lane, performance.now(), audio.contextTime);
  reactive.hitFlash(lane, res.verdict, res.deltaMs);
  hud.popup(res.verdict, res.deltaMs);
}

function runDemoAutopilot(songMs) {
  while (demoIdx < demoNotes.length && demoNotes[demoIdx][0] + 12 <= songMs) {
    const note = demoNotes[demoIdx++];
    injectLaneDown(note[1], performance.now());
  }
}

function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastPerf) / 1000);
  lastPerf = now;

  if (state === 'PLAY' || state === 'PAUSED') {
    const songMs = audio.getSongTimeMs();
    clock.sample(now, songMs);
    if (state === 'PLAY') {
      const evs = audio.pumpEvents(80);
      for (let i = 0; i < evs.length; i++) {
        if (evs[i].tMs <= songMs) tracer.markBeatFired(evs[i].tMs, songMs);
      }
      reactive.pushEvents(evs);

      const missed = session.sweep(songMs);
      for (let i = 0; i < missed.length; i++) {
        const m = missed[i];
        hud.popup('MISS', m.deltaMs);
        reactive.hitFlash(m.note.lane, 'MISS', m.deltaMs);
      }

      reactive.enqueueNotes(session.playfield.pendingNotes(songMs - 100, songMs + 2200));

      if (demoMode) runDemoAutopilot(songMs);

      const b = audio.getBands();
      bandsCopy.bass = b.bass;
      bandsCopy.mid = b.mid;
      bandsCopy.treb = b.treb;

      const st = session.stats;
      if (st.score !== lastHud.score || st.combo !== lastHud.combo || st.acc !== lastHud.acc) {
        lastHud = { score: st.score, combo: st.combo, acc: st.acc };
        hud.update(st.score, st.combo, st.acc, handle ? songMs / handle.durationMs : 0);
      }
      hud.bandMeters(bandsCopy);
    }
    reactive.update(dt, { songTimeMs: songMs, bands: bandsCopy, playing: state === 'PLAY' });
  } else if (reactive) {
    reactive.update(dt, { songTimeMs: 0, bands: bandsCopy, playing: false });
  }

  stage.render();
  overlay.tick(now);
  requestAnimationFrame(frame);
}

function showSelfTestReport(result) {
  const layer = document.createElement('div');
  layer.className = 'pw-layer pw-selftest-layer';
  const s = result.summary;
  const row = (label, r, unit, budget, pass) =>
    `<tr class="${pass ? 'ok' : 'bad'}"><td>${label}</td><td>p50 ${r.p50.toFixed(2)}${unit} · p95 ${r.p95.toFixed(2)}${unit} · n=${r.n}</td><td>${budget}</td><td>${pass ? 'PASS' : 'FAIL'}</td></tr>`;
  const frames = s.frames;
  layer.innerHTML = `
    <div class="pw-selftest-box">
      <p class="pw-kicker">LATENCY SELF-TEST</p>
      <table>
        ${row('input &rarr; judged', s.inputToJudged, 'ms', '&le; 2 ms p95', s.inputToJudged.p95 <= 2)}
        ${row('judged &rarr; sound scheduled', s.judgedToSound, 'ms', '&le; 3 ms p95', s.judgedToSound.p95 <= 3)}
        ${row('input &rarr; sound total', s.softwareTotal, 'ms', '&le; 8 ms p95', s.softwareTotal.p95 <= 8)}
        ${row('beat fire error', s.beatFireErrors, 'ms', '&le; 8 ms p95', s.beatFireErrors.p95 <= 8)}
        <tr><td>frames</td><td>mean ${frames.mean.toFixed(2)} ms · p95 ${frames.p95.toFixed(2)} ms · max ${frames.max.toFixed(1)} ms</td><td>&gt;20ms: ${frames.over20}/${frames.count}</td><td>${frames.over20 / Math.max(1, frames.count) < 0.01 ? 'PASS' : 'WARN'}</td></tr>
      </table>
      <p class="pw-orphan-note">orphans: ${s.orphans}</p>
      <div class="pw-selftest-actions">
        <button data-act="json" type="button">download JSON</button>
        <button data-act="menu" type="button" autofocus>back to menu</button>
      </div>
    </div>`;
  document.body.appendChild(layer);
  layer.querySelector('[data-act="json"]').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pulseweave-latency-report.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  layer.querySelector('[data-act="menu"]').addEventListener('click', () => {
    layer.remove();
    toMenu();
  });
}

async function boot() {
  const canvas = ensureCanvas();
  stage = createStage(canvas);
  setReactivePalette(null);
  hud = new Hud(document.body);
  results = new ResultsScreen(document.body);
  overlay = new DebugOverlay();
  overlay.attach(document.body);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') {
      e.preventDefault();
      overlayOn = !overlayOn;
      if (overlayOn) overlay.attach(document.body);
      else overlay.detach();
    } else if (e.code === 'Escape' && (state === 'PLAY' || state === 'PAUSED')) {
      e.preventDefault();
      togglePause();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'PLAY') togglePause();
  });

  initInput({ onLaneDown: (lane, perfTs) => {
    if (laneHandler) return laneHandler(lane, perfTs);
    pipelineTap(lane, perfTs);
  }});

  clock.offsetMs = loadCalib();

  screens = new ScreenManager({
    onStart: (track, difficulty) => startTrack(track, difficulty),
    onCalibrate: async () => {
      if (calibFlow) calibFlow.destroy();
      await audio.ensureRunning();
      state = 'CALIBRATE';
      calibFlow = new CalibrationFlow({
        audio,
        onSave: (offsetMs) => {
          clock.offsetMs = offsetMs;
          try { localStorage.setItem(CALIB_KEY, JSON.stringify({ offsetMs })); } catch {}
        },
        onExit: () => {
          calibFlow = null;
          toMenu();
        },
      });
    },
    onMenu: () => toMenu(),
  });

  requestAnimationFrame(frame);

  if (selftestMode) {
    state = 'LOADING';
    screens.show('LOADING', { title: 'latency self-test' });
    screens.setProgress(0.2);
    const track = TRACKS.find((t) => t.id === (paramTrack || 'cobalt-circuit')) || TRACKS[1];
    const diff = paramDiff || 'HARD';
    await audio.ensureRunning();
    handle = await audio.renderTrack(track);
    const chart = buildChart(track, handle.timeline.events, diff);
    screens.hide();
    const result = await runSelfTest({
      audio,
      clock,
      chart,
      trackHandle: handle,
      durationMs: Math.min(handle.durationMs, 45000),
      sessionFactory: async (c) => new Session(c),
      injectLaneDown,
      setOnLaneDown: (fn) => { laneHandler = fn; },
      stage: {
        pushEvents: (evs) => reactive.pushEvents(evs),
        update: (d, ctx) => reactive.update(d, ctx),
        render: () => stage.render(),
      },
      hud: { update: (stats) => hud.update(stats.score, stats.combo, stats.acc, 0), popup: (v, d) => hud.popup(v, d) },
    });
    laneHandler = null;
    state = 'RESULTS';
    showSelfTestReport(result);
    return;
  }

  if (demoMode) {
    const track = TRACKS.find((t) => t.id === paramTrack) || TRACKS[1];
    const diff = paramDiff || 'NORMAL';
    setTimeout(() => startTrack(track, diff), 400);
  } else {
    screens.show('MENU');
  }
  state = 'MENU';
}

window.addEventListener('error', (e) => {
  if (state === 'PLAY' || state === 'LOADING') {
    state = 'MENU';
    hud.hide();
    audio.stop();
    screens.show('ERROR', { message: String(e.message || e) });
  }
});

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#ff5470;font-family:monospace;background:#04060d">boot failed: ${String(err.message || err)}</div>`
  );
});
