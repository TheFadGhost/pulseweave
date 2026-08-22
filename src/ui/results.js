const ORDER = ['PERFECT', 'GREAT', 'GOOD', 'MISS'];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function bestKey(id, diff) {
  return `pw.best.${id}.${diff}`;
}

function loadBest(id, diff) {
  try {
    const raw = localStorage.getItem(bestKey(id, diff));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveBest(id, diff, rec) {
  try {
    localStorage.setItem(bestKey(id, diff), JSON.stringify(rec));
  } catch {}
}

function intOf(v) {
  const n = +v;
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export class ResultsScreen {
  constructor(root = document.body) {
    this.layer = el('div', 'pw-layer pw-results-layer pw-hidden');
    root.appendChild(this.layer);
    this._opts = null;
    this._onKey = (e) => {
      if (e.key === 'Escape' && !this.layer.classList.contains('pw-hidden')) this._act('onMenu');
    };
    window.addEventListener('keydown', this._onKey);
  }

  show(stats = {}, opts = {}) {
    this._opts = opts;
    const counts = stats.counts ?? {};
    const total = ORDER.reduce((n, v) => n + intOf(counts[v]), 0);
    const layer = this.layer;
    layer.replaceChildren();
    layer.classList.remove('pw-hidden');

    layer.appendChild(el('p', 'pw-kicker', 'RESULTS'));
    const label = [opts.title, opts.difficulty].filter(Boolean).join(' · ');
    if (label) layer.appendChild(el('p', 'pw-res-title', label));

    const grade = String(stats.grade ?? 'D').toUpperCase();
    layer.appendChild(el('div', `pw-grade pw-grade--${grade}`, grade));

    if (opts.trackId && opts.difficulty) {
      const prev = loadBest(opts.trackId, opts.difficulty);
      const record = !prev || intOf(stats.score) > intOf(prev.score);
      saveBest(opts.trackId, opts.difficulty, {
        score: intOf(stats.score),
        acc: Number.isFinite(+stats.acc) ? +stats.acc : 0,
        grade,
      });
      if (record) layer.appendChild(el('div', 'pw-badge-record', 'NEW RECORD'));
    }

    const statsRow = el('div', 'pw-res-stats');
    statsRow.appendChild(this._stat('SCORE', String(intOf(stats.score))));
    statsRow.appendChild(this._stat('ACCURACY', `${(Number.isFinite(+stats.acc) ? +stats.acc : 0).toFixed(2)}%`));
    statsRow.appendChild(this._stat('MAX COMBO', String(intOf(stats.maxCombo))));
    layer.appendChild(statsRow);

    const rows = el('div', 'pw-res-rows');
    for (const v of ORDER) {
      const row = el('div', 'pw-vrow');
      row.appendChild(el('span', `pw-dot pw-dot--${v}`));
      row.appendChild(el('span', 'pw-vrow-name', v));
      row.appendChild(el('span', 'pw-vrow-count', String(intOf(counts[v]))));
      rows.appendChild(row);
    }
    const tot = el('div', 'pw-vrow pw-vrow--total');
    tot.appendChild(el('span', 'pw-vrow-name', 'TOTAL'));
    tot.appendChild(el('span', 'pw-vrow-count', `${total} NOTES`));
    rows.appendChild(tot);
    layer.appendChild(rows);

    const actions = el('div', 'pw-res-actions');
    const retry = this._btn('RETRY', () => this._act('onRetry'));
    actions.appendChild(retry);
    actions.appendChild(this._btn('MENU', () => this._act('onMenu')));
    layer.appendChild(actions);
    requestAnimationFrame(() => retry.focus());
  }

  hide() {
    this.layer.replaceChildren();
    this.layer.classList.add('pw-hidden');
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    this.hide();
    this.layer.remove();
  }

  _act(fn) {
    const o = this._opts;
    this.hide();
    o?.[fn]?.();
  }

  _btn(label, onClick) {
    const b = el('button', 'pw-btn', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  _stat(labelText, valueText) {
    const block = el('div', 'pw-stat');
    block.appendChild(el('span', 'pw-stat-label', labelText));
    block.appendChild(el('span', 'pw-stat-value', valueText));
    return block;
  }
}
