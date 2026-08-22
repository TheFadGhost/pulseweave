const LANES = new Set(['KeyD', 'KeyF', 'KeyJ', 'KeyK']);
const WARMUP_N = 8;
const MEASURED_N = 16;
const BEAT_MS = 500;
const WINDOW_MS = 300;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export class CalibrationFlow {
  constructor({ audio, onSave, onExit } = {}) {
    this.audio = audio;
    this.onSave = onSave;
    this.onExit = onExit;
    this.warmups = 0;
    this.deltas = [];
    this.offsetMs = null;
    this.done = false;
    this.dead = false;

    const layer = el('div', 'pw-layer pw-cal-layer');
    layer.appendChild(el('p', 'pw-kicker', 'CALIBRATION'));

    const info = el('div', 'pw-cal-instructions');
    info.appendChild(document.createTextNode('tap in time with the tick. first 8 taps warm up (not scored), next 16 are measured.'));
    info.appendChild(document.createElement('br'));
    info.appendChild(el('span', '', 'keys '));
    for (const k of ['D', 'F', 'J', 'K']) {
      const key = el('span', 'pw-key', k);
      key.style.margin = '0 3px';
      info.appendChild(key);
    }
    layer.appendChild(info);

    const tapBox = el('button', 'pw-cal-tap');
    tapBox.type = 'button';
    tapBox.setAttribute('aria-label', 'calibration tap area');
    this.phase = el('div', 'pw-cal-phase', `WARMUP 0 / ${WARMUP_N}`);
    this.median = el('div', 'pw-cal-median', '—');
    this.tapHint = el('div', 'pw-cal-taphint', 'TAP · CLICK OR D F J K');
    tapBox.appendChild(this.phase);
    tapBox.appendChild(this.median);
    tapBox.appendChild(this.tapHint);
    layer.appendChild(tapBox);

    const slots = el('div', 'pw-cal-slots');
    this.slotEls = [];
    for (let i = 0; i < MEASURED_N; i++) {
      const s = el('div', 'pw-cal-slot', '');
      slots.appendChild(s);
      this.slotEls.push(s);
    }
    layer.appendChild(slots);
    layer.appendChild(el('div', 'pw-cal-foot', 'ESC EXITS EARLY'));

    this.layer = layer;
    document.body.appendChild(layer);

    this._onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.done) this.destroy();
        else this._exitEarly();
        return;
      }
      if (this.done || this.dead || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (LANES.has(e.code)) {
        e.preventDefault();
        this._tap();
      }
    };
    window.addEventListener('keydown', this._onKey);
    layer.addEventListener('pointerdown', () => this._tap());
    layer.addEventListener(
      'click',
      (e) => {
        if (e.detail === 0) this._tap();
      }
    );

    this._begin();
  }

  async _begin() {
    try {
      await this.audio?.ensureRunning?.();
    } catch {}
    if (this.dead) return;
    // Assumption per engine contract: metronome(on) anchors its start to the
    // same clock basis play() uses, so while only the metronome runs,
    // getSongTimeMs() reads time-since-enable and tick k sounds at k*500ms.
    this.audio?.metronome?.(true);
    requestAnimationFrame(() => this.layer.querySelector('.pw-cal-tap')?.focus());
  }

  _tap() {
    if (this.done || this.dead) return;
    this._flash();
    const now = this.audio?.getSongTimeMs?.();
    if (!Number.isFinite(now)) return;
    if (this.warmups < WARMUP_N) {
      this.warmups += 1;
      this._status();
      return;
    }
    const delta = now - Math.round(now / BEAT_MS) * BEAT_MS;
    if (Math.abs(delta) > WINDOW_MS) return;
    if (this.deltas.length >= MEASURED_N) return;
    this.deltas.push(delta);
    this._paintSlot(this.deltas.length - 1, delta);
    this._status();
    if (this.deltas.length === MEASURED_N) this._complete();
  }

  _flash() {
    const box = this.layer.querySelector('.pw-cal-tap');
    if (!box) return;
    box.classList.add('pw-flash');
    setTimeout(() => box.classList.remove('pw-flash'), 90);
  }

  _median(a) {
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  _fmt(ms, dec = 0) {
    return `${ms < 0 ? '-' : '+'}${Math.abs(ms).toFixed(dec)}MS`;
  }

  _magClass(d) {
    const a = Math.abs(d);
    return a <= 45 ? 'pw-d-p' : a <= 90 ? 'pw-d-g' : a <= 135 ? 'pw-d-o' : 'pw-d-x';
  }

  _status() {
    if (this.warmups < WARMUP_N) {
      this.phase.textContent = `WARMUP ${this.warmups} / ${WARMUP_N}`;
    } else {
      this.phase.textContent = `MEASURED ${this.deltas.length} / ${MEASURED_N} · MEDIAN`;
    }
    if (this.deltas.length) {
      const m = this._median(this.deltas);
      this.median.textContent = this._fmt(m, 1);
      this.median.className = `pw-cal-median ${this._magClass(m)}`;
    } else {
      this.median.textContent = '—';
      this.median.className = 'pw-cal-median';
    }
  }

  _paintSlot(i, d) {
    const s = this.slotEls[i];
    if (!s) return;
    s.textContent = this._fmt(d, 0);
    s.className = `pw-cal-slot pw-hit ${this._magClass(d)}`;
  }

  _complete() {
    this.done = true;
    const m = Math.max(-WINDOW_MS, Math.min(WINDOW_MS, this._median(this.deltas)));
    this.offsetMs = m;
    try {
      localStorage.setItem('pw.calib', JSON.stringify({ offsetMs: m }));
    } catch {}
    this.phase.textContent = `COMPLETE · SAVED ${this._fmt(m, 1)}`;
    this.median.textContent = this._fmt(m, 1);
    this.median.className = `pw-cal-median ${this._magClass(m)}`;
    this.tapHint.textContent = 'DONE — ESC TO CONTINUE';
    this.audio?.metronome?.(false);
    this.onSave?.(m);
  }

  _exitEarly() {
    this.audio?.metronome?.(false);
    this.destroy();
    this.onExit?.();
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    window.removeEventListener('keydown', this._onKey);
    this.layer.remove();
  }
}
