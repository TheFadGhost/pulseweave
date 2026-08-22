import { TRACKS } from '../content/tracks.js';

const DIFF_FALLBACK = ['EASY', 'NORMAL', 'HARD'];

function bestKey(id, diff) {
  return `pw.best.${id}.${diff}`;
}

export function loadBest(id, diff) {
  try {
    const raw = localStorage.getItem(bestKey(id, diff));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveBest(id, diff, rec) {
  try {
    localStorage.setItem(bestKey(id, diff), JSON.stringify(rec));
  } catch {}
}

export function loadBests() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('pw.best.')) continue;
      try {
        out[k.slice(8)] = JSON.parse(localStorage.getItem(k));
      } catch {}
    }
  } catch {}
  return out;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function fmtScore(n) {
  return Number.isFinite(+n) ? String(Math.round(+n)) : '—';
}

export class ScreenManager {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.current = null;
    this.progressEls = null;
    this.root = document.createElement('div');
    this.root.className = 'pw-layer pw-screens pw-hidden';
    document.body.appendChild(this.root);
    this._onKey = (e) => {
      if (e.key !== 'Escape' || !this.current) return;
      if (this.current === 'SELECT' || this.current === 'ERROR') this._toMenu();
    };
    window.addEventListener('keydown', this._onKey);
  }

  show(name, props = {}) {
    const key = String(name || '').toUpperCase();
    const scr = el('div', 'pw-screen');
    if (key === 'MENU') this._buildMenu(scr);
    else if (key === 'SELECT') this._buildSelect(scr);
    else if (key === 'LOADING') this._buildLoading(scr, props);
    else if (key === 'ERROR') this._buildError(scr, props);
    else return;
    this.current = key;
    this.root.classList.remove('pw-hidden');
    this.root.replaceChildren(scr);
    const focusTarget = scr.querySelector('[data-autofocus]');
    if (focusTarget) requestAnimationFrame(() => focusTarget.focus());
  }

  hide() {
    this.current = null;
    this.progressEls = null;
    this.root.replaceChildren();
    this.root.classList.add('pw-hidden');
  }

  setProgress(p) {
    if (!this.progressEls) return;
    const v = Math.max(0, Math.min(1, +p || 0));
    this.progressEls.fill.style.transform = `scaleX(${v})`;
    this.progressEls.bar.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    this.progressEls.pct.textContent = `${Math.round(v * 100)}%`;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    this.hide();
    this.root.remove();
  }

  _toMenu() {
    this.show('MENU');
    this.hooks.onMenu?.();
  }

  _btn(label, onClick, cls = 'pw-btn', autoFocus = false) {
    const b = el('button', cls, label);
    b.type = 'button';
    if (autoFocus) b.setAttribute('data-autofocus', '');
    b.addEventListener('click', onClick);
    return b;
  }

  _buildMenu(scr) {
    scr.appendChild(el('h1', 'pw-title', 'PULSEWEAVE'));
    scr.appendChild(el('p', 'pw-tagline', 'a rhythm game woven from sound'));
    const actions = el('div', 'pw-menu-actions');
    actions.appendChild(this._btn('PLAY', () => this.show('SELECT'), 'pw-btn pw-btn--primary', true));
    actions.appendChild(this._btn('CALIBRATE', () => this.hooks.onCalibrate?.()));
    scr.appendChild(actions);
    const hint = el('div', 'pw-controls-hint');
    hint.appendChild(el('span', '', 'LANES'));
    for (const k of ['D', 'F', 'J', 'K']) hint.appendChild(el('span', 'pw-key', k));
    scr.appendChild(hint);
  }

  _diffsFor(t) {
    return Array.isArray(t.difficulties) && t.difficulties.length ? t.difficulties : DIFF_FALLBACK;
  }

  _buildSelect(scr) {
    scr.appendChild(el('p', 'pw-kicker', 'SELECT TRACK'));
    const grid = el('div', 'pw-track-grid');
    const list = Array.isArray(TRACKS) ? TRACKS : [];
    let firstChip = null;
    for (const t of list) {
      const card = el('div', 'pw-track-card');
      const head = el('div', 'pw-track-head');
      head.appendChild(el('h2', 'pw-track-title', t.title ?? t.id ?? 'UNTITLED'));
      head.appendChild(el('span', 'pw-track-meta', `${t.bpm ?? '?'} BPM`));
      card.appendChild(head);
      const chips = el('div', 'pw-chip-row');
      for (const d of this._diffsFor(t)) {
        const best = loadBest(t.id, d);
        const chip = el('button', 'pw-chip');
        chip.type = 'button';
        chip.dataset.diff = d;
        chip.appendChild(el('span', 'pw-chip-name', d));
        chip.appendChild(
          el(
            'span',
            'pw-chip-best',
            best ? `${best.grade ?? '—'} · ${fmtScore(best.score)} · ${Number(best.acc ?? 0).toFixed(1)}%` : 'NO RECORD'
          )
        );
        chip.addEventListener('click', () => this.hooks.onStart?.(t, d));
        if (!firstChip) firstChip = chip;
        chips.appendChild(chip);
      }
      card.appendChild(chips);
      grid.appendChild(card);
    }
    scr.appendChild(grid);
    const foot = el('div', 'pw-select-foot');
    foot.appendChild(this._btn('BACK', () => this._toMenu(), 'pw-btn pw-btn--ghost'));
    scr.appendChild(foot);
    if (firstChip) firstChip.setAttribute('data-autofocus', '');
  }

  _buildLoading(scr, props) {
    scr.appendChild(el('p', 'pw-kicker', 'LOADING'));
    scr.appendChild(el('p', 'pw-load-label', `synthesizing ${props.title ?? 'track'}…`));
    const row = el('div', 'pw-load-row');
    const bar = el('div', 'pw-load-bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    const fill = el('div', 'pw-load-fill');
    bar.appendChild(fill);
    const pct = el('span', 'pw-load-pct', '0%');
    row.appendChild(bar);
    row.appendChild(pct);
    scr.appendChild(row);
    this.progressEls = { bar, fill, pct };
    this.setProgress(props.progress ?? 0);
  }

  _buildError(scr, props) {
    scr.appendChild(el('p', 'pw-kicker', 'ERROR'));
    scr.appendChild(el('p', 'pw-error-msg', props.message ?? 'something went wrong.'));
    const foot = el('div', 'pw-menu-actions');
    foot.appendChild(this._btn('BACK', () => this._toMenu(), 'pw-btn', true));
    scr.appendChild(foot);
  }
}
