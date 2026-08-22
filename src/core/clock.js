export const VISUAL_LEAD_MS = 0;

// rAF can stall for seconds (tab switch, GC); extrapolating unclamped would
// fling judgment time far past the audio and auto-miss everything on resume.
const MAX_EXTRAP_MS = 100;

export class Clock {
  constructor() {
    this.offsetMs = 0;
    this.perfSampleMs = 0;
    this.songSampleMs = 0;
    this.sampled = false;
  }

  reset() {
    this.perfSampleMs = 0;
    this.songSampleMs = 0;
    this.sampled = false;
  }

  sample(perfNowMs, songNowMs) {
    this.perfSampleMs = perfNowMs;
    this.songSampleMs = songNowMs;
    this.sampled = true;
  }

  songAt(perfMs) {
    if (!this.sampled) return 0;
    const t = this.songSampleMs + (perfMs - this.perfSampleMs);
    const cap = this.songSampleMs + MAX_EXTRAP_MS;
    return t > cap ? cap : t;
  }

  // Positive offsetMs = player taps late; subtract so their intent aligns with note times.
  inputToSong(perfMs) {
    return this.songAt(perfMs) - this.offsetMs;
  }

  visualSongAt(perfMs) {
    return this.songAt(perfMs) + VISUAL_LEAD_MS;
  }
}
