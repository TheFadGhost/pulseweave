export const WINDOWS = { PERFECT: 45, GREAT: 90, GOOD: 135 };
export const WEIGHTS = { PERFECT: 300, GREAT: 200, GOOD: 100 };

const VERDICTS = ['PERFECT', 'GREAT', 'GOOD'];
const COUNT_KEYS = ['PERFECT', 'GREAT', 'GOOD', 'MISS'];

export function judgeDelta(deltaMs) {
  const d = Math.abs(deltaMs);
  for (let i = 0; i < VERDICTS.length; i++) {
    const v = VERDICTS[i];
    if (d <= WINDOWS[v]) return v;
  }
  return null;
}

export function accuracy(counts) {
  let earned = 0;
  let total = 0;
  for (let i = 0; i < COUNT_KEYS.length; i++) {
    const key = COUNT_KEYS[i];
    const raw = counts ? counts[key] : undefined;
    const c = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0;
    earned += c * (WEIGHTS[key] ?? 0);
    total += c;
  }
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (earned / (total * WEIGHTS.PERFECT)) * 100));
}

export function grade(accPercent) {
  if (accPercent >= 95) return 'S';
  if (accPercent >= 90) return 'A';
  if (accPercent >= 80) return 'B';
  if (accPercent >= 70) return 'C';
  return 'D';
}

export function comboMultiplier(combo) {
  const c = Number.isFinite(combo) ? Math.max(0, combo) : 0;
  return 1 + Math.floor(Math.min(c, 45) / 15);
}
