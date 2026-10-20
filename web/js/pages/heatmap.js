// Heatmap: days × 24 hours from /api/summary hours, monochrome intensity, the live hour hatched,
// a tooltip per cell, row and column totals. Under 3 days it offers a one-click "Last 14 days".
import { $, errorState } from '../ui.js';
import { icon } from '../icons.js';
import { esc, fmtDay, short } from '../format.js';
import { HEAT_METRICS, METRIC_FMT, metricOf } from '../metrics.js';
import { state, prefs, writeHash } from '../state.js';
import { span, addDays, today } from '../periods.js';

let app = null, host = null, last = null, tipEl = null;

function mount(h, a) {
  app = a; host = h;
  h.innerHTML = `<div data-hint></div>
    <div class="section-h" style="margin-bottom:var(--s3)"><h2 data-htitle>Revenue by hour of day</h2><span class="note" data-hnote></span>
      <div class="right"><div class="seg sm" data-hm role="group" aria-label="Heatmap metric">${HEAT_METRICS.map(([k, l]) => `<button data-k="${k}">${l}</button>`).join('')}</div></div></div>
    <div class="hm-wrap" data-wrap><div class="hm" data-grid></div></div>
    <div class="hm-scale"><span>low</span><span class="ramp"></span><span>high</span><span style="margin-left:var(--s4)" class="hatch"></span><span>live hour</span><span style="margin-left:var(--s4)">empty = no data yet</span></div>`;
  $('[data-hm]', h).addEventListener('click', e => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    state.hmMetric = b.dataset.k; prefs.set('hmMetric', state.hmMetric); writeHash();
    if (last) draw(last);
  });
  h.querySelectorAll('[data-k]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === state.hmMetric)));
  const grid = $('[data-grid]', h);
  grid.addEventListener('mousemove', onTip);
  grid.addEventListener('mouseleave', hideTip);
  h.addEventListener('click', e => { if (e.target.closest('[data-last14]')) { const t = today(); app.custom(addDays(t, -13), t); } });
}
function unmount() { hideTip(); host = null; last = null; }

async function load(c, sumP) {
  const my = c.seq;
  hint();
  if (!last) $('[data-grid]', host).innerHTML = skeleton();
  else $('[data-wrap]', host).style.opacity = .55;
  try {
    const s = await sumP;
    if (!c.alive(my) || !host) return;
    last = s; draw(s);
  } catch (e) {
    if (c.alive(my) && host) $('[data-grid]', host).innerHTML = `<div style="grid-column:1/-1">${errorState(e.message, { sm: true })}</div>`;
  } finally { if (host) $('[data-wrap]', host).style.opacity = ''; }
}

function hint() {
  const n = span(state.start, state.end);
  $('[data-hint]', host).innerHTML = n < 3
    ? `<div class="hint-card">${icon('calendar')}<span>The heatmap reads best over several days. This range has ${n} day${n > 1 ? 's' : ''}.</span><button class="btn primary sm" data-last14>${icon('calendar')}Last 14 days</button></div>` : '';
}

const COLS = 'grid-template-columns:96px repeat(24,minmax(22px,1fr)) 84px';
function skeleton() {
  $('[data-grid]', host).setAttribute('style', COLS);
  return Array.from({ length: 7 * 26 }, (_, i) => (i % 26 === 0 || i % 26 === 25 ? '<span class="sk" style="height:10px;align-self:center"></span>' : '<span class="c sk"></span>')).join('');
}

// build day → hour → bucket from the summary hours (labels are UTC)
function cube(s) {
  const days = Array.from({ length: span(s.start, s.end) }, (_, i) => addDays(s.start, i));
  const m = new Map();
  for (const h of s.hours || []) {
    const lab = String(h.label || h.k);
    m.set(lab.slice(0, 13), h);
  }
  return { days, at: (d, hh) => m.get(`${d} ${String(hh).padStart(2, '0')}`) };
}
const add = (a, h) => { for (const k of ['rev', 'cost', 'req', 'imps']) a[k] = (a[k] || 0) + (+h[k] || 0); return a; };

function draw(s) {
  const k = state.hmMetric, f = METRIC_FMT[k] || short, { days, at } = cube(s);
  host.querySelectorAll('[data-k]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
  $('[data-htitle]', host).textContent = `${HEAT_METRICS.find(x => x[0] === k)[1]} by hour of day`;
  $('[data-hnote]', host).textContent = `${days.length} day${days.length > 1 ? 's' : ''} · UTC`;
  let max = -Infinity, min = Infinity;
  const vals = days.map(d => Array.from({ length: 24 }, (_, hh) => {
    const h = at(d, hh), v = h ? metricOf(h, k) : null;
    if (h && h.partial == null && v != null) { max = Math.max(max, v); min = Math.min(min, v); }
    return { h, v };
  }));
  const colSum = Array.from({ length: 24 }, () => ({})), all = {};
  const rowsHtml = days.map((d, i) => {
    const rs = {};
    const cells = vals[i].map(({ h, v }, hh) => {
      if (!h) return `<span class="c none" data-d="${d}" data-h="${hh}"></span>`;
      add(rs, h); add(colSum[hh], h); add(all, h);
      // min–max stretch so day/hour patterns stand out; the live hour is clamped into range
      const t = v == null || !(max > min) ? 0 : Math.max(0, Math.min(1, (v - min) / (max - min)));
      const a = v == null ? .04 : .06 + .86 * t;
      return `<span class="c${h.partial != null ? ' load' : ''}" style="background-color:rgba(var(--ink),${a.toFixed(3)})" data-d="${d}" data-h="${hh}"></span>`;
    }).join('');
    return `<span class="dl">${esc(new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }))} ${esc(fmtDay(d))}</span>${cells}<span class="tot">${Object.keys(rs).length ? f(metricOf(rs, k)) : '—'}</span>`;
  }).join('');
  const head = '<span></span>' + Array.from({ length: 24 }, (_, hh) => `<span class="hh">${String(hh).padStart(2, '0')}</span>`).join('') + '<span class="hh" style="text-align:right">Total</span>';
  const foot = '<span class="dl">Total</span>' + colSum.map(c => `<span class="ct" title="${Object.keys(c).length ? esc(f(metricOf(c, k))) : ''}">${Object.keys(c).length ? colFmt(k, metricOf(c, k)) : '—'}</span>`).join('')
    + `<span class="tot" style="color:var(--fg)">${Object.keys(all).length ? f(metricOf(all, k)) : '—'}</span>`;
  const grid = $('[data-grid]', host);
  grid.setAttribute('style', COLS);
  grid.innerHTML = head + rowsHtml + foot;
  last = s;
}
// column totals sit in narrow cells: compact money
const colFmt = (k, v) => {
  if (k !== 'rev' && k !== 'margin') return (METRIC_FMT[k] || short)(v);
  const a = Math.abs(v), s = v < 0 ? '-$' : '$';
  return s + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K' : Math.round(a));
};

function onTip(e) {
  const c = e.target.closest('.c[data-d]');
  if (!c || !last) { hideTip(); return; }
  const k = state.hmMetric, f = METRIC_FMT[k] || short, h = cube(last).at(c.dataset.d, +c.dataset.h);
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'hm-tip'; document.body.appendChild(tipEl); }
  const name = HEAT_METRICS.find(x => x[0] === k)[1];
  tipEl.innerHTML = `<b>${esc(fmtDay(c.dataset.d))} · ${c.dataset.h.padStart(2, '0')}:00 UTC</b>${h ? `${name} ${f(metricOf(h, k))}` : 'No data yet'}`
    + (h ? `<br>${k === 'rev' ? '' : `Revenue ${METRIC_FMT.rev(h.rev)} · `}${k === 'req' ? `Impressions ${short(h.imps)}` : `Requests ${short(h.req)}`}` : '') + (h?.partial != null ? `<br>Live · ${Math.round(h.partial * 100)}% of the hour so far` : '');
  const x = Math.min(e.clientX + 14, innerWidth - tipEl.offsetWidth - 8), y = e.clientY + 16 + tipEl.offsetHeight > innerHeight ? e.clientY - tipEl.offsetHeight - 10 : e.clientY + 16;
  tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
}
function hideTip() { tipEl?.remove(); tipEl = null; }

export const heatmapPage = { id: 'heatmap', mount, unmount, load };
