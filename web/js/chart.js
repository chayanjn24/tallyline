// Line charts (Chart.js 4.4.1, straight segments: hourly data is jagged, so the chart is too) and SVG
// sparklines. The live hour is drawn dotted at its projected full-hour value (value ÷ share elapsed)
// for additive metrics, hidden under 15% elapsed, and never used in a Δ.
// Colours come from the theme tokens, so charts follow light / dark mode.
import { rgba, fmtDay, chg, short, TONE_HEX, cssVar, esc } from './format.js';
import { ADDITIVE, METRIC_FMT, bucketize, metricOf } from './metrics.js';
import { span, addDays } from './periods.js';

const charts = new WeakMap();
const MONO = '"Geist Mono", ui-monospace, monospace';
const MIN_PARTIAL = 0.15;
const theme = () => ({
  grid: cssVar('--chart-grid'), axis: cssVar('--chart-axis'), tick: cssVar('--chart-tick'), prev: cssVar('--chart-prev'),
  b: cssVar('--chart-b'), tip: cssVar('--chart-tip'), fg: cssVar('--fg'), fg2: cssVar('--fg-2'), line: cssVar('--line-2'),
  bg: cssVar('--bg'), ink: cssVar('--ink'),
});
const hexOf = c => (c.startsWith('#') ? c : '#888888');

const crosshair = {
  id: 'xh',
  afterDatasetsDraw(ch) {
    const a = ch.tooltip?.getActiveElements?.();
    if (!a || !a.length) return;
    const x = a[0].element.x, { top, bottom } = ch.chartArea, g = ch.ctx;
    g.save(); g.strokeStyle = `rgba(${cssVar('--ink')}, .18)`; g.lineWidth = 1; g.beginPath(); g.moveTo(x, top); g.lineTo(x, bottom); g.stroke(); g.restore();
  },
};

// slot labels + values for one series, aligned from its own window start
function series(hours, s0, len, daily, m) {
  const b = bucketize(hours, s0, daily);
  const vals = [], actual = [], partial = new Map(), keys = [];
  for (let i = 0; i < len; i++) {
    const c = b.get(i);
    let v = c ? metricOf(c, m) : null;
    actual.push(v); keys.push(c ? c.key : null);
    if (c && c.partial && !daily && v != null) {
      if (c.partial < MIN_PARTIAL) v = null;
      else if (ADDITIVE.has(m) && c.partial < 1) v = v / c.partial;
      partial.set(i, c.partial);
    }
    vals.push(v);
  }
  return { vals, actual, partial, keys };
}
function slotLabels(s0, len, daily, days) {
  return Array.from({ length: len }, (_, i) => {
    if (daily) return fmtDay(addDays(s0, i));
    const hh = String(i % 24).padStart(2, '0');
    return days > 1 ? `${fmtDay(addDays(s0, Math.floor(i / 24)))} ${hh}h` : `${hh}:00`;
  });
}
function baseOptions(fmt, m, tooltip) {
  const t = theme();
  return {
    responsive: true, maintainAspectRatio: false,
    // no motion for viewers who ask for less, and none on the printable report (a print must never catch a half-drawn line)
    animation: matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('report') ? false : { duration: 220 },
    interaction: { mode: 'index', intersect: false },
    elements: { line: { tension: 0, capBezierPoints: false, borderJoinStyle: 'miter' }, point: { radius: 0, hoverRadius: 3.5 } },
    scales: {
      x: { grid: { display: false }, border: { color: t.axis }, ticks: { color: t.tick, font: { size: 10.5, family: MONO }, maxRotation: 0, autoSkip: true, autoSkipPadding: 18, maxTicksLimit: 12 } },
      y: { grid: { color: t.grid }, border: { display: false }, beginAtZero: m !== 'margin', ticks: { color: t.tick, font: { size: 10.5, family: MONO }, maxTicksLimit: 5, padding: 8, callback: v => fmt(v) } },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: t.tip, borderColor: t.line, borderWidth: 1, padding: 10, cornerRadius: 8,
        titleColor: t.fg, bodyColor: t.fg2, titleFont: { family: MONO, weight: '500', size: 11 }, bodyFont: { family: MONO, size: 11 },
        boxWidth: 7, boxHeight: 7, usePointStyle: true, callbacks: tooltip,
      },
    },
  };
}
function draw(canvas, data, options) {
  if (typeof Chart === 'undefined') { canvas.replaceWith(Object.assign(document.createElement('div'), { className: 'state sm', textContent: 'The chart library did not load.' })); return; }
  const ch = charts.get(canvas);
  if (ch) { ch.data = data; ch.options = options; ch.update(); return; }
  charts.set(canvas, new Chart(canvas.getContext('2d'), { type: 'line', data, options, plugins: [crosshair] }));
}
export function destroyChart(canvas) { const ch = canvas && charts.get(canvas); if (ch) { ch.destroy(); charts.delete(canvas); } }

const dottedFrom = (partial, faded) => ({
  borderColor: c => (partial.has(c.p1DataIndex) ? faded : undefined),
  borderDash: c => (partial.has(c.p1DataIndex) ? [2, 3] : undefined),
  backgroundColor: c => (partial.has(c.p1DataIndex) ? 'transparent' : undefined),
});
const tip = (f, cur, i, label) => (cur.partial.has(i) && ADDITIVE.has(label.m) && cur.vals[i] != null
  ? ` ${label.name} ${f(cur.vals[i])} projected · so far ${f(cur.actual[i])} (${Math.round(cur.partial.get(i) * 100)}% of the hour, not in Δ)`
  : ` ${label.name} ${f(cur.vals[i])}${cur.partial.has(i) ? ' · live hour, not in Δ' : ''}`);

// Overview trend: current (coloured by the period Δ) vs the comparison window (grey dashed)
export function trendChart(canvas, s, m, periodTone) {
  const t = theme();
  const f = METRIC_FMT[m] || short;
  const days = span(s.start, s.end), pdays = span(s.pstart, s.pend), daily = days >= 3;
  const len = daily ? Math.max(days, pdays) : Math.max(days, pdays) * 24;
  const cur = series(s.hours, s.start, len, daily, m);
  const prev = series(s.prevHours, s.pstart, len, daily, m);
  const labels = slotLabels(s.start, len, daily, days);
  const hex = hexOf(TONE_HEX[periodTone] || TONE_HEX.flat), faded = rgba(hex, .5);
  const fill = c => {
    const a = c.chart.chartArea; if (!a) return rgba(hex, .08);
    const g = c.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
    g.addColorStop(0, rgba(hex, .14)); g.addColorStop(1, rgba(hex, 0)); return g;
  };
  const prevLbl = i => { const k = prev.keys[i]; return !k ? '' : daily ? fmtDay(k) : `${fmtDay(k.slice(0, 10))} ${k.slice(11, 13)}:00`; };
  const data = {
    labels,
    datasets: [
      { label: 'Current', data: cur.vals, borderColor: hex, backgroundColor: fill, fill: 'origin', borderWidth: 1.75, tension: 0, spanGaps: false,
        pointRadius: c => (cur.partial.has(c.dataIndex) && cur.vals[c.dataIndex] != null ? 2.5 : 0), pointBackgroundColor: faded,
        pointHoverBackgroundColor: hex, pointHoverBorderColor: t.bg, pointHoverBorderWidth: 2, segment: dottedFrom(cur.partial, faded) },
      { label: 'Previous', data: prev.vals, borderColor: t.prev, borderDash: [4, 4], borderWidth: 1.25, fill: false, tension: 0, spanGaps: false, pointHoverBackgroundColor: t.prev },
    ],
  };
  const options = baseOptions(f, m, {
    title: it => (it.length ? labels[it[0].dataIndex] + (cur.partial.has(it[0].dataIndex) ? ' · live' : '') : ''),
    label: it => {
      const i = it.dataIndex;
      if (it.datasetIndex === 0) return tip(f, cur, i, { m, name: 'Current' });
      const d = !cur.partial.has(i) ? chg(cur.vals[i], prev.vals[i]) : null;
      return ` Previous ${f(prev.vals[i])}${prevLbl(i) ? ' · ' + prevLbl(i) : ''}${d != null && Number.isFinite(d) ? ` (${d >= 0 ? '+' : ''}${d.toFixed(1)}%)` : ''}`;
    },
    labelColor: it => ({ borderColor: it.datasetIndex === 0 ? hex : t.prev, backgroundColor: it.datasetIndex === 0 ? hex : t.prev }),
  });
  draw(canvas, data, options);
  return { daily, hasPartial: cur.partial.size > 0, hex };
}

// Compare: A solid (foreground colour), B solid grey, same range
export function overlayChart(canvas, sa, sb, m, names) {
  const t = theme();
  const f = METRIC_FMT[m] || short;
  const s0 = sa.start, days = span(sa.start, sa.end), daily = days >= 3, len = daily ? days : days * 24;
  const A = series(sa.hours, s0, len, daily, m), B = series(sb.hours, s0, len, daily, m);
  const labels = slotLabels(s0, len, daily, days);
  const ca = hexOf(t.fg), cb = hexOf(t.b);
  const mk = (sr, col, name) => ({ label: name, data: sr.vals, borderColor: col, borderWidth: 1.75, tension: 0, fill: false, spanGaps: false,
    pointRadius: c => (sr.partial.has(c.dataIndex) && sr.vals[c.dataIndex] != null ? 2.5 : 0), pointBackgroundColor: rgba(col, .5),
    pointHoverBackgroundColor: col, segment: dottedFrom(sr.partial, rgba(col, .45)) });
  const data = { labels, datasets: [mk(A, ca, names[0]), mk(B, cb, names[1])] };
  const options = baseOptions(f, m, {
    title: it => (it.length ? labels[it[0].dataIndex] : ''),
    label: it => tip(f, it.datasetIndex === 0 ? A : B, it.dataIndex, { m, name: it.datasetIndex === 0 ? 'A' : 'B' }),
  });
  draw(canvas, data, options);
  return { daily, hasPartial: A.partial.size > 0 || B.partial.size > 0 };
}

// SVG sparkline; prev is drawn grey dashed behind
export function sparkSvg(vals, prev, hex, w = 84, h = 24) {
  if (!vals || vals.length < 2) return '';
  hex = hexOf(hex);
  const all = vals.concat(prev || []);
  const max = Math.max(...all, 0), min = Math.min(...all, 0), pad = 1.5;
  const n = Math.max(vals.length, (prev || []).length);
  const x = i => (pad + i * (w - 2 * pad) / Math.max(1, n - 1)).toFixed(1);
  const y = v => (h - pad - ((v - min) / ((max - min) || 1)) * (h - 2 * pad)).toFixed(1);
  const line = arr => arr.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const area = `${x(0)},${h - pad} ${line(vals)} ${x(vals.length - 1)},${h - pad}`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">`
    + (prev && prev.length > 1 ? `<polyline points="${line(prev)}" fill="none" stroke="var(--chart-prev)" stroke-width="1" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>` : '')
    + `<polygon points="${area}" fill="${rgba(hex, .1)}"/>`
    + `<polyline points="${line(vals)}" fill="none" stroke="${hex}" stroke-width="1.4" stroke-linejoin="miter" vector-effect="non-scaling-stroke"/></svg>`;
}

// anomaly card chart: actual (toned) vs normal (grey dashed), with the incident hours shaded
export function anomalySvg(pts, metric, start, end, hex, w = 320, h = 72) {
  if (!pts || pts.length < 2) return '';
  hex = hexOf(hex);
  const act = pts.map(p => +p[metric] || 0), exp = pts.map(p => +p['e_' + metric] || 0);
  const max = Math.max(...act, ...exp, 1), pad = 3;
  const x = i => pad + i * (w - 2 * pad) / (pts.length - 1);
  const y = v => h - pad - (v / max) * (h - 2 * pad);
  const line = arr => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const i0 = pts.findIndex(p => p.k >= start), i1 = pts.findIndex(p => p.k >= end);
  const a = i0 < 0 ? 0 : i0, b = (i1 < 0 ? pts.length : i1) - 1;
  const band = b >= a ? `<rect x="${(x(a) - 3).toFixed(1)}" y="0" width="${Math.max(6, x(b) - x(a) + 6).toFixed(1)}" height="${h}" fill="${rgba(hex, .09)}" rx="3"/>` : '';
  const f = metric === 'rev' ? METRIC_FMT.rev : short;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(`${metric === 'rev' ? 'Revenue' : 'Requests'} per hour, actual vs normal; peak ${f(max)}`)}">${band}`
    + `<polyline points="${line(exp)}" fill="none" stroke="var(--chart-prev)" stroke-width="1.2" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>`
    + `<polyline points="${line(act)}" fill="none" stroke="${hex}" stroke-width="1.6" stroke-linejoin="miter" vector-effect="non-scaling-stroke"/></svg>`;
}
