# pulseweave

> **built with ox alpha**
>
> most of this was written in august 2026 during the free preview window of
> [ox alpha](https://openrouter.ai/stealth/ox-alpha), an anonymous stealth model
> that turned up on openrouter for about a week. i set the direction and reviewed
> what came back. there are no tests yet, which is the honest state of it.

a browser rhythm game where the music and the chart are both generated at runtime — no audio files, no authored beatmaps, just pattern data fed through a synth and a chart builder.

## running it

```
npm install
npm run dev
```

opens a vite dev server. keyboard play, four lanes. `npm run build` / `npm run preview` for a production bundle.

## how it works

there's no audio asset in the repo. `src/synth/composer.js` takes a `trackDef` (bpm, key, 16-step drum patterns, bassline degrees, lead patterns, per-section energy) from `src/content/tracks.js` and expands it into an event timeline, then renders that timeline through an `OfflineAudioContext` into an `AudioBuffer` — kick as a pitch-dropped sine plus click, snare as filtered noise plus a 180Hz tone, hats as highpassed noise, bass as a saw through an envelope-driven lowpass, lead as a detuned pulse, pad as a detuned saw stack, plus impact and riser hits for section transitions. everything runs through a master `DynamicsCompressorNode` so the layered instruments don't clip.

the chart isn't hand-placed either: `src/game/chart.js` takes the same composed event timeline the audio came from and buckets events into 4 lanes, so every note in the chart corresponds to something that actually happens in the audio. lane assignment differs by event type — percussive hits get a seeded `mulberry32` hash of event index (`src/core/rng.js`), pitched notes map to lanes by midi bucket, everything else falls back to an fnv-1a hash of the event kind. difficulty (EASY/NORMAL/HARD) filters which event kinds are eligible and enforces a minimum gap between notes (400ms/260ms/150ms) so charts don't get printed to be physically unplayable at speed.

timing runs entirely off `AudioContext.currentTime`, never `Date.now()` or `performance.now()`, per the hard rule in `SPEC.md` — `performance.now()` is only used as the raw input-event timestamp before being mapped onto the audio clock. judgment windows are PERFECT ±45ms, GREAT ±90ms, GOOD ±135ms (`src/game/timing.js`), scored 300/200/100 with a combo multiplier that steps up every 15 combo, capped at combo 45. grades are S (≥95% accuracy) down to D.

`src/profiling/tracer.js` is a ring-buffer based latency tracer (fixed-size typed arrays, no per-frame allocation) that timestamps input → judgment → sound-scheduling stages per lane and reports p50/p95-style nearest-rank percentiles, built to check the spec's own latency budget table (keydown-to-handler ≤1ms, hit sound scheduled ≤3ms, etc.) rather than to enforce it automatically.

visuals are three.js (`src/gfx/scene.js`, `src/gfx/stage-reactive.js`), driven by live FFT band analysis (`audio.getBands()`) rather than by the chart data.

## tests

there is a `vitest` dev dependency and a `test` script in `package.json`, but no `*.test.js` / `*.spec.js` files exist anywhere in `src/`. running `npm test` exits immediately with "No test files found, exiting with code 1". confirmed by running it.

## known limitations

no automated tests. the latency budget table in `SPEC.md` is aspirational — `Tracer` can measure and report against it, but nothing in the codebase asserts pass/fail on those numbers, so there's no CI-checkable guarantee the game hits them. calibration is manual (a metronome + a calibration screen), not self-correcting.
