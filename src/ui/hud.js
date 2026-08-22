function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const VERDICT_CLASS = { PERFECT: 'perfect', GREAT: 'great', GOOD: 'good', MISS: 'miss' };

export class Hud {
  constructor(root = document.body) {
    const layer = el('div', 'pw-layer pw-hud-layer pw-hidden');
    const progress = el('div', 'pw-progress');
    this.progFill = el('div', 'pw-progress-fill');
    progress.appendChild(this.progFill);

    const top = el('div', 'pw-hud-top');
    const scoreStat = el('div', 'pw-stat');
    scoreStat.appendChild(el('span', 'pw-stat-label', 'SCORE'));
    this.scoreVal = el('span', 'pw-stat-value', '0000000');
    scoreStat.appendChild(this.scoreVal);

    this.comboBox = el('div', 'pw-combo pw-combo--off');
    this.comboVal = el('div', 'pw-combo-value', '0');
    this.comboBox.appendChild(this.comboVal);
    this.comboBox.appendChild(el('span', 'pw-stat-label', 'COMBO'));

    const accStat = el('div', 'pw-stat pw-acc');
    accStat.appendChild(el('span', 'pw-stat-label', 'ACCURACY'));
    this.accVal = el('span', 'pw-stat-value', '0.00%');
    accStat.appendChild(this.accVal);

    top.appendChild(scoreStat);
    top.appendChild(this.comboBox);
    top.appendChild(accStat);

    this.judge = el('div', 'pw-judge');
    this.judgeWord = el('div', 'pw-judge-word', '');
    this.judgeSub = el('div', 'pw-judge-sub', '');
    this.judge.appendChild(this.judgeWord);
    this.judge.appendChild(this.judgeSub);

    const bands = el('div', 'pw-bands');
    this.bandFills = [];
    for (const label of ['B', 'M', 'T']) {
      const row = el('div', 'pw-band');
      row.appendChild(el('span', 'pw-band-label', label));
      const track = el('div', 'pw-band-track');
      const fill = el('div', 'pw-band-fill');
      track.appendChild(fill);
      row.appendChild(track);
      bands.appendChild(row);
      this.bandFills.push(fill);
    }
    this._bands = [null, null, null];

    layer.appendChild(progress);
    layer.appendChild(top);
    layer.appendChild(this.judge);
    layer.appendChild(bands);
    this.layer = layer;
    root.appendChild(layer);

    this.comboBox.addEventListener('animationend', () => this.comboBox.classList.remove('pw-combo--pop'));
    this.judge.addEventListener('animationend', () => this.judge.classList.remove('pw-judge--active'));

    this._lastScore = '';
    this._lastCombo = -1;
    this._lastAcc = '';
    this._lastProg = -1;
  }

  update(score, combo, acc, progress01) {
    const sTxt = String(Math.max(0, Math.round(+score || 0))).padStart(7, '0');
    if (sTxt !== this._lastScore) {
      this.scoreVal.textContent = sTxt;
      this._lastScore = sTxt;
    }
    const c = Math.max(0, Math.round(+combo || 0));
    if (c !== this._lastCombo) {
      this.comboVal.textContent = String(c);
      this.comboBox.classList.toggle('pw-combo--off', c <= 0);
      if (c > this._lastCombo && c > 0) {
        this.comboBox.classList.remove('pw-combo--pop');
        void this.comboBox.offsetWidth;
        this.comboBox.classList.add('pw-combo--pop');
      }
      this._lastCombo = c;
    }
    const aNum = Number.isFinite(+acc) ? +acc : 0;
    const aTxt = `${aNum.toFixed(2)}%`;
    if (aTxt !== this._lastAcc) {
      this.accVal.textContent = aTxt;
      this._lastAcc = aTxt;
    }
    const p = Math.max(0, Math.min(1, +progress01 || 0));
    if (p !== this._lastProg) {
      this.progFill.style.transform = `scaleX(${p})`;
      this._lastProg = p;
    }
  }

  popup(verdict, deltaMs) {
    const v = String(verdict || '').toUpperCase();
    this.judgeWord.textContent = v;
    if (deltaMs == null || !Number.isFinite(+deltaMs)) {
      this.judgeSub.textContent = '';
    } else {
      const r = Math.round(+deltaMs);
      this.judgeSub.textContent = `${r >= 0 ? '+' : '-'}${Math.abs(r)}MS ${r >= 0 ? 'LATE' : 'EARLY'}`;
    }
    this.judge.classList.remove('pw-judge--active');
    void this.judge.offsetWidth;
    this.judge.className = `pw-judge pw-judge--${VERDICT_CLASS[v] || 'miss'} pw-judge--active`;
  }

  bandMeters(bands) {
    if (!bands) return;
    const vals = [bands.bass, bands.mid, bands.treb];
    for (let i = 0; i < 3; i++) {
      const v = Math.max(0, Math.min(1, +vals[i] || 0));
      const q = Math.round(v * 40) / 40;
      if (q !== this._bands[i]) {
        this.bandFills[i].style.transform = `scaleX(${q})`;
        this._bands[i] = q;
      }
    }
  }

  show() {
    this.layer.classList.remove('pw-hidden');
  }

  hide() {
    this.layer.classList.add('pw-hidden');
  }

  dispose() {
    this.hide();
    this.layer.remove();
  }
}
