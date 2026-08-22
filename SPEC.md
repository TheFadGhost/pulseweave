# PULSEWEAVE — Architecture & Contracts

Rhythm game. Three.js visuals, Web Audio synthesis + playback, keyboard play.
Everything original: music is synthesized at runtime from authored pattern data,
charts derive from the same musical event timeline (so charts are musically
justified by construction), visuals react to real audio analysis.

## Hard rules

- ES modules only. `package.json` has `"type": "module"`.
- Units: **song-time milliseconds** (float) in ALL gameplay APIs. Song time 0 = first sample of the rendered track buffer. The composer bakes `LEAD_IN_S = 2.0` seconds of silence; beat 0 sits at `offsetMs` inside that window.
- Master clock = `AudioContext.currentTime`. Never use `Date.now()` or performance.now() for gameplay timing; `performance.now()` is used ONLY as the input timestamp origin and converted via the clock mapping.
- No per-frame heap allocations in the render path (pools + typed arrays).
- No comments unless something is genuinely non-obvious. No TODOs. No placeholder stubs — complete implementations only.
- Determinism: any randomness in composition/charting uses `mulberry32(seed)` from `src/core/rng.js`.

## Latency budget (orchestrator-owned, measured by self-test)

| stage | budget |
|---|---|
| keydown → handler entry | ≤ 1 ms |
| judgment decision | ≤ 0.2 ms |
| hit sound scheduled (`source.start(ctx.currentTime)`, never queued) | ≤ 3 ms |
| visual feedback (same rAF frame) | ≤ 16.7 ms |
| beat pulse fire error vs audio event | ≤ 8 ms |

Software-side p95 must be under these numbers. Hardware output latency is handled by user calibration, not hidden.

## Module contracts

### src/core/rng.js
```js
export function mulberry32(seed) // -> () => float in [0,1)
export function hashInt(n)       // stable int hash -> int
```

### src/audio/engine.js
Singleton `Audio` class exported as `audio` plus the class:
```js
class AudioEngine {
  async init()                    // create AudioContext (lazy resume on gesture), master gain, analyser
  ensureRunning()                 // resume() if suspended
  async renderTrack(trackDef)     // OfflineAudioContext synth -> AudioBuffer (+ cache by id). Returns handle {id, buffer, durationMs}
  play(handle, {onEnd})           // start playback from t=0; sets internal startTime = ctx.currentTime at start
  stop()                          // stop sources, clear state
  pause() / resume()              // ctx.suspend()/resume(); song time freezes automatically
  getSongTimeMs()                 // (ctx.currentTime - startTime)*1000; negative before start? no: play() schedules start now, so >= 0 after call
  getBands()                      // {bass, mid, treb} smoothed 0..1 from analyser FFT
  pumpEvents(lookAheadMs)         // returns upcoming composed events [{tMs, kind, vel}] with tMs <= songTime+lookAhead, each exactly once, sorted
  hitSound(verdict)               // immediate one-shot blip; distinct timbre for PERFECT/GREAT/GOOD/MISS; zero schedule delay
  metronome(on)                   // tick each beat while on (for calibration screen)
  setVolume(v) / get contextTime()
}
export const audio = new AudioEngine()
```
Hit sound buffers are pre-rendered once at init (tiny offline renders), played via `BufferSource.start(ctx.currentTime)`.

### src/synth/composer.js
```js
export function composeTimeline(trackDef) // -> {events:[{tMs, kind:'kick'|'snare'|'hat'|'bass'|'lead'|'pad'|'impact'|'riser', vel, freq?}], bpm, offsetMs, durationMs}
export async function renderTrackAudio(trackDef) // uses composeTimeline + OfflineAudioContext instruments -> AudioBuffer
```
Instruments: kick (sine pitch drop + click), snare (noise burst + 180Hz tone), hat (HP-filtered noise), bass (saw + LP env), lead (pulse w/ slight detune), pad (detuned saw stack, slow LP), impact (low boom + noise wash), riser (band-sweep noise). All gain-staged to avoid clipping (master compressor DynamicsCompressorNode).

### src/content/tracks.js
Data-only. `export const TRACKS = [trackDef, ...]` — exactly 3 tracks with escalating difficulty:
- `ion-drift`: 104 BPM, A minor, 64 bars, mellow (EASY/NORMAL)
- `cobalt-circuit`: 128 BPM, E minor, 72 bars, driving (NORMAL/HARD)
- `static-bloom`: 160 BPM, C minor, 80 bars, intense (HARD)
trackDef shape:
```js
{
  id, title, bpm, bars, rootMidi, scale:'minor',
  seed: <int>,
  sections: [{startBar, energy: 'low'|'mid'|'high'|'peak'}...],   // arrangement map
  drums: { kick:'x...x...x...x...', ... }                          // 16-step strings per instrument, style variants keyed by energy
  bassline: { rhythm:'x..x..x.', degrees:[0,3,5,...] },            // degree indexes into scale, cycled per bar
  lead: { patterns:['..1.2.3.', ...], octave: 5 },
  colors: { lane:['#29f3ff','#ff3df0','#ffb347','#7dff9e'], accent:'#ffffff', bg:'#04060d' }
}
```

### src/game/timing.js (pure functions)
```js
export const WINDOWS = { PERFECT: 45, GREAT: 90, GOOD: 135 }      // ms, +/- around note time
export function judgeDelta(deltaMs)                                // -> 'PERFECT'|'GREAT'|'GOOD'|null (null => outside windows => will be MISS)
export const WEIGHTS = { PERFECT: 300, GREAT: 200, GOOD: 100 }
export function accuracy(counts)                                   // weighted 0..100
export function grade(accPercent)                                  // 'S'|'A'|'B'|'C'|'D'
export function comboMultiplier(combo)                             // 1 + floor(min(combo,45)/15) -> 1..4
```

### src/game/chart.js
```js
export function buildChart(trackDef, events, difficulty) // -> chart object below; deterministic; enforces min gap per lane (EASY 400ms, NORMAL 260ms, HARD 150ms) by dropping weaker overlapping notes
// mapping rules: kick/snare/impact -> lanes hashed by event index (mulberry32); bass/lead -> lane = pitch bucket % 4;
// difficulty filters: EASY {kick,snare,impact} NORMAL {+bass} HARD {all + lead subdivisions}
export function validateChart(obj)                        // throws Error('chart: ...') on malformed; checks version, sortedness, lane range 0..3, t>=0, dup times
export function serializeChart(chart) / parseChart(json)  // JSON round-trip through validate
// chart = {version:1, trackId, difficulty, bpm, offsetMs, notes:[[tMs,lane,strength]...]}
```

### src/game/playfield.js
Stateful per-play note field. Consumes chart + clock; owns auto-miss sweep.
```js
class Playfield {
  constructor(chart)
  update(songTimeMs)                  // sweeps misses past GOOD window, returns array of missed notes this frame
  tap(lane, inputSongTMs)             // -> null | {verdict, deltaMs, note} ; picks earliest unjudged note in lane within GOOD window
  pendingNotes(fromTMs, toTMs)        // notes in time range for rendering (unjudged)
  get counts() / done()               // all notes judged?
}
```

### src/game/session.js
Owns a play: score/combo state + Playfield + tracer hooks.
```js
class Session {
  constructor(chart)
  onTap(lane, inputSongTMs)   // full pipeline: playfield.tap -> score update -> return result|null
  sweep(songTimeMs)           // process auto-misses -> results
  get stats() // {score, combo, maxCombo, counts, acc, grade}
}
```

### src/input/input.js
```js
initInput({onLaneDown})            // keydown listener on window; lanes: D,F,J,K (+ arrow fallback); ignores repeats
// calls onLaneDown(lane /*0..3*/, perfTs /*performance.now()*/)
injectLaneDown(lane, perfTs)       // same path, for demo/self-test
LANE_KEYS = ['KeyD','KeyF','KeyJ','KeyK']
```

### src/core/clock.js
Maps performance.now() <-> song time using samples taken each frame from audio engine.
```js
export class Clock {
  reset()                       // clear samples
  sample(perfNowMs, songNowMs)  // called once per frame
  songAt(perfMs)                // linear extrapolation from latest sample
  offsetMs = 0                  // calibration offset (positive = player taps late); applied where documented
}
```

### src/gfx/scene.js
```js
createStage(canvas) // -> {renderer, scene, camera, resize(), render(), dispose()}
```
Camera at tunnel mouth looking down -Z toward horizon hit-ring.

### src/gfx/stage-reactive.js
All beat-reactive geometry. One class, owns its own pools:
```js
class ReactiveStage {
  constructor(threeStuff, palette)
  setChartBounds(durationMs)
  pushEvents(events)                 // from audio.pumpEvents; internal queue keyed by target tMs
  enqueueNotes(notes)                // upcoming notes for ribbon rendering
  hitFlash(lane, verdict, deltaMs)   // burst particles + ring flash + shard shatter on miss
  update(dtSec, ctx)                 // ctx: {songTimeMs, bands:{bass,mid,treb}, playing}
  // fires queued events when songTimeMs crosses their tMs -> ring pulse, FOV kick (60->63 decay), grid brightness
}
```
Visual identity: near-black void (#04060d), two mirrored glowing ribbons converging into a torus "pulsar" ring (judgment line), wireframe rings receding to horizon, starfield points, fragment-shader nebula plane driven by band energies. Notes = elongated octahedron shards via InstancedMesh, additive glow sprites behind them. Particles = single Points pool (1024). NO EffectComposer/postprocessing — glow via additive blending only. Quality scaler caps devicePixelRatio at 1.5 and halves particle counts on `quality:'low'`.

### src/ui/*.js
DOM overlays over canvas (position:absolute layers). Files: `screens.js` (menu/select/calibration/results routing), `hud.js`, `calibration.js`, `results.js`, `overlay.css` imported by main.
- Calibration: plays metronome at 120 BPM; 8 warmup taps then 16 measured; computes median(tapSongT − nearestBeatT); clamps ±300ms; saves localStorage `pw.calib` `{offsetMs}`; shows live deltas.
- Results: counts per verdict, max combo, accuracy, grade, score, retry/menu buttons.
- HUD: score, combo (with pop animation), accuracy, judgment popup text with delta ms and early/late tag, progress bar.

### src/profiling/tracer.js
```js
class Tracer {
  markInput(lane, perfMs)
  markJudged(lane, verdict, deltaMs, perfMs)
  markSoundScheduled(lane, perfMs, ctxScheduledS)
  markFrame(perfMs, songMs)
  report()        // {inputToJudged p50/p95, judgedToSound p50/p95, frameTimes stats, beatFireErrors[]}
  reset()
}
export const tracer = new Tracer()
export function initSelfTest(...) // ?selftest mode: autopilot injecting inputs at known offsets, prints table + JSON, PASS/FAIL vs budgets above
```
Debug overlay (F3): live frame time, song time, bands meters, last N latencies.

### src/main.js
Bootstrap + state machine BOOT→MENU→SELECT→CALIBRATE→PLAY→RESULTS. Owns the single rAF loop: clock.sample → session.sweep → stage.update → render → HUD. URL params: `?demo=1` autopilot perfect play, `?selftest=1` latency harness, `?quality=low`.

## Edge cases (audit checklist)

- AudioContext suspended until first gesture → resume in menu button handlers.
- Track render failure → toast + back to select, no crash.
- Chart validation failure → surfaced error screen with reason.
- visibilitychange during play → auto-pause.
- WebGL context lost → show reload prompt.
- Extreme density → quality drop path must not alter timing math (visuals only).
