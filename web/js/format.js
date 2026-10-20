// Number formatting and the colour rule. tone() is the ONLY place that decides good / bad:
// up is good, except for cost-type metrics where up is bad.
import { icon } from './icons.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ok = v => v != null && v !== '' && Number.isFinite(+v);
const n0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const int = v => (ok(v) ? n0.format(Math.round(+v)) : '—');

// compact counts: 1.23M, 45.6K
export function short(v) {
  if (!ok(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return (v / 1e3).toFixed(1) + 'K';
  return n0.format(Math.round(v));
}

// money: $1,234.56 below $10K, then $12.3K / $1.23M
export function money(v) {
  if (!ok(v)) return '—';
  const a = Math.abs(v), s = v < 0 ? '-$' : '$';
  if (a >= 1e6) return s + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return s + (a / 1e3).toFixed(1) + 'K';
  return s + a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// hero money: whole dollars above $1K so big numbers stay calm
export function moneyHero(v) {
  if (!ok(v)) return '—';
  const a = Math.abs(v), s = v < 0 ? '-$' : '$';
  if (a >= 1e6) return s + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return s + n0.format(Math.round(a));
  return s + a.toFixed(2);
}
export const moneyX = (v, d = 4) => (ok(v) ? (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(d) : '—');
export const pct = (v, d = 1) => (ok(v) ? (+v).toFixed(d) + '%' : '—');

// % change; Infinity = new (nothing before), null = nothing to compare
export function chg(cur, prev) {
  if (!ok(cur) || !ok(prev)) return null;
  if (+prev === 0) return +cur > 0 ? Infinity : +cur < 0 ? -Infinity : null;
  return (cur - prev) / Math.abs(prev) * 100;
}

// ---------- colour rule ----------
const INVERTED = new Set(['cost']);
// semantic colours come from the theme (css/tokens.css), so charts follow light / dark mode
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const TONE_HEX = {
  get good() { return cssVar('--good') || '#5fc28f'; },
  get bad() { return cssVar('--bad') || '#e5716a'; },
  get flat() { return cssVar('--flat') || '#8a8a93'; },
};
export { cssVar };
export function tone(metric, delta) {
  if (delta == null || Number.isNaN(delta) || Math.abs(delta) < 0.05) return 'flat';
  const up = delta > 0;
  return (INVERTED.has(metric) ? !up : up) ? 'good' : 'bad';
}
export const toneHex = (metric, delta) => TONE_HEX[tone(metric, delta)];
export function rgba(hex, a) {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

export function deltaTxt(d) {
  if (d == null) return '—';
  if (!Number.isFinite(d)) return 'new';
  const a = Math.abs(d);
  return a >= 1000 ? '>999%' : a.toFixed(a < 10 ? 1 : 0) + '%';
}
// Δ badge: arrow + %; tip explains the comparison
export function deltaBadge(metric, cur, prev, tip = '') {
  const d = chg(cur, prev);
  if (d == null) return `<span class="delta flat" title="${esc(tip || 'No comparison data')}">—</span>`;
  const t = Number.isFinite(d) ? tone(metric, d) : tone(metric, d > 0 ? 1 : -1);
  const ic = t === 'flat' || !Number.isFinite(d) ? '' : icon(d > 0 ? 'up' : 'down');
  return `<span class="delta ${t}" title="${esc(tip)}">${ic}${deltaTxt(d)}</span>`;
}
// table Δ cell: signed text, toned
export function deltaCell(metric, d) {
  if (d == null) return '<span class="na">—</span>';
  const t = Number.isFinite(d) ? tone(metric, d) : tone(metric, d > 0 ? 1 : -1);
  const txt = !Number.isFinite(d) ? 'new' : (d > 0 ? '+' : '') + d.toFixed(1) + '%';
  return `<span class="dt t-${t}">${txt}</span>`;
}

// ---------- dates ----------
export const fmtDay = s => new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const fmtDayLong = s => new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export const fmtRange = (a, b) => (a === b ? fmtDay(a) : `${fmtDay(a)} – ${fmtDay(b)}`);
