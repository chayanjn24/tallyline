// Compare two entities of one level: side-by-side KPIs (each Δ vs its own comparison window),
// the A − B difference, and an overlaid chart. Uses the current range and filters; deep-linkable.
import { $, emptyState, errorState } from '../ui.js';
import { icon } from '../icons.js';
import { esc, money, moneyX, short, pct, int, chg, deltaBadge, deltaTxt } from '../format.js';
import { sides, CHART_METRICS } from '../metrics.js';
import { get } from '../api.js';
import { state, query, LEVELS, LEVEL, writeHash, prefs, nameOf, learn } from '../state.js';
import { overlayChart, destroyChart } from '../chart.js';
import { createSelect } from '../components/select.js';

let app = null, host = null, selA = null, selB = null, last = null;

const PTS = new Set(['marginPct', 'fill', 'bidRate', 'winRate']);   // rates: the difference is in points
const ROWS = [
  ['rev', 'Revenue', money], ['cost', 'Payout', money], ['margin', 'Margin', money], ['marginPct', 'Margin %', v => pct(v)],
  ['ecpm', 'eCPM', v => moneyX(v, 2)], ['rpmr', 'RPMR', v => moneyX(v, 2)], ['req', 'Bid requests', short], ['bids', 'Bids', short],
  ['wins', 'Wins', short], ['imps', 'Impressions', short], ['bidRate', 'Bid rate', v => pct(v, 2)], ['winRate', 'Win rate', v => pct(v, 1)],
  ['fill', 'Fill', v => pct(v, 3)], ['opps', 'Opportunities', short], ['qps', 'Avg QPS', int],
];

function optionsFor(level) {
  return () => get('/api/options', { ...query({ noPrev: true, skip: level }), level })
    .then(j => (j.options || []).map(o => { learn(level, String(o.id), o.name); return { id: String(o.id), name: String(o.name ?? o.id), sub: o.sub || '', rev: o.rev, req: o.req }; }));
}

function mount(h, a) {
  app = a; host = h;
  h.innerHTML = `<div class="cmp-lv"><span class="eyebrow">Level</span><div class="seg" data-lv role="group" aria-label="Level">${LEVELS.map(l => `<button data-l="${l}">${LEVEL[l].one}</button>`).join('')}</div>
      <button class="btn sm ghost" data-swap title="Swap A and B">${icon('compare')}Swap</button></div>
    <div class="cmp-pick"><span class="eyebrow">A</span><div data-a></div><span class="vs eyebrow">B</span><div data-b></div></div>
    <div data-out></div>`;
  $('[data-lv]', h).addEventListener('click', e => {
    const b = e.target.closest('[data-l]'); if (!b || b.dataset.l === state.compare.level) return;
    state.compare = { level: b.dataset.l, a: null, b: null };
    writeHash(); buildPickers(); render();
  });
  $('[data-swap]', h).addEventListener('click', () => {
    const c = state.compare; [c.a, c.b] = [c.b, c.a];
    writeHash(); buildPickers(); app.reload(false);
  });
  h.addEventListener('click', e => {
    const b = e.target.closest('[data-cm]');
    if (b) { state.metric = b.dataset.cm; prefs.set('metric', state.metric); writeHash(); if (last) drawChart(); }
  });
  buildPickers();
}
function buildPickers() {
  selA?.destroy(); selB?.destroy();
  const l = state.compare.level, what = LEVEL[l].many.toLowerCase();
  host.querySelectorAll('[data-l]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.l === l)));
  const mk = (el, tag, key) => createSelect($(el, host), {
    tag, what, placeholder: `Pick ${/^[aeiou]/i.test(LEVEL[l].one) ? 'an' : 'a'} ${LEVEL[l].one.toLowerCase()}`,
    value: state.compare[key], label: state.compare[key] ? nameOf(l, state.compare[key]) : '',
    load: optionsFor(l),
    onPick: id => { state.compare[key] = id; writeHash(); app.reload(false); },
  });
  selA = mk('[data-a]', 'A', 'a'); selB = mk('[data-b]', 'B', 'b');
}
function unmount() { selA?.destroy(); selB?.destroy(); destroyChart(host && $('[data-chart]', host)); host = null; last = null; }

function setOut(html) {
  destroyChart($('[data-chart]', host));
  $('[data-out]', host).innerHTML = html;
}
function render() {
  const c = state.compare;
  if (!c.a || !c.b) {
    last = null;
    setOut(emptyState({ ico: 'compare', title: `Pick two ${LEVEL[c.level].many.toLowerCase()}`,
      text: 'Each side uses the current range and filters (its own level is replaced). Tip: ⌥Enter in ⌘K, or ⋯ → Compare on any table row.' }));
  }
}

async function load(ctx) {
  const c = state.compare, my = ctx.seq;
  if (!c.a || !c.b) { render(); return; }
  if (!last || !ctx.silent) setOut(`<div class="cmp-grid"><div class="panel"><div class="panel-b">${'<div class="sk sk-line"></div>'.repeat(10)}</div></div></div>`);
  try {
    const needNames = !nameOf(c.level, c.a) || !nameOf(c.level, c.b);
    const [sa, sb] = await Promise.all([
      ...[c.a, c.b].map(id => get('/api/summary', query({ ent: [c.level, id] }), { fresh: ctx.fresh })),
      needNames ? optionsFor(c.level)().catch(() => null) : null,
    ]);
    if (!ctx.alive(my) || !host) return;
    last = { sa, sb, na: nameOf(c.level, c.a) || '#' + c.a, nb: nameOf(c.level, c.b) || '#' + c.b };
    selA.set(c.a, last.na); selB.set(c.b, last.nb);
    renderAll();
  } catch (e) {
    if (ctx.alive(my) && host) setOut(errorState(e.message));
  }
}

function renderAll() {
  const { sa, sb, na, nb } = last, A = sides(sa), B = sides(sb);
  const side = (S, m, f) => {
    const v = S.total[m];
    if (m === 'opps' && !S.ok) return '<span class="na">n/a</span>';
    const d = PTS.has(m) ? '' : deltaBadge(m, S.cmp[m], S.prev?.[m], S.prev ? `Previous ${f(S.prev[m])}` : '');
    return `${f(v)}${d}`;
  };
  const diff = (m, f) => {
    const a = A.total[m], b = B.total[m];
    if (a == null || b == null || (m === 'opps' && !(A.ok && B.ok))) return '<span class="na">—</span>';
    if (PTS.has(m)) return `${a - b >= 0 ? '+' : '−'}${Math.abs(a - b).toFixed(m === 'fill' ? 3 : 1)} pts`;
    const d = chg(a, b), ab = a - b;
    return `${ab >= 0 ? '+' : '−'}${f(Math.abs(ab))}<span class="na"> · A ${d == null ? '—' : (d >= 0 && Number.isFinite(d) ? '+' : d < 0 ? '−' : '') + deltaTxt(d)}</span>`;
  };
  setOut(`<div class="cmp-grid">
    <div class="panel" style="overflow-x:auto"><table class="t compact cmp-table"><thead><tr><th class="l">Metric</th>
      <th class="a" title="${esc(na)}"><span class="tag a">A</span>${esc(trim(na))}</th><th class="b" title="${esc(nb)}"><span class="tag b">B</span>${esc(trim(nb))}</th><th>A vs B</th></tr></thead>
      <tbody>${ROWS.map(([m, l, f]) => `<tr><td class="l">${l}</td><td>${side(A, m, f)}</td><td>${side(B, m, f)}</td><td class="diff">${diff(m, f)}</td></tr>`).join('')}</tbody></table></div>
    <section class="panel chart-panel">
      <div class="panel-h"><h3 data-ctitle></h3><div class="legend"><span><i></i>A · ${esc(trim(na, 28))}</span><span><i class="b"></i>B · ${esc(trim(nb, 28))}</span><span data-lp hidden><i class="dot"></i>Live hour, projected</span></div>
        <div class="seg sm" role="group" aria-label="Chart metric">${CHART_METRICS.map(([k, l]) => `<button data-cm="${k}">${l}</button>`).join('')}</div></div>
      <div class="chart-box"><canvas data-chart role="img" aria-label="A versus B chart"></canvas></div></section>
    <p class="tnote">Each Δ compares that side ${esc(state.cmp)}${sa.cmp?.completedOnly ? ' (completed hours only)' : ''}. A vs B = A − B over the whole range (rates in percentage points). Both sides use the current range and filters; the ${esc(LEVEL[state.compare.level].one.toLowerCase())} filter is replaced by each side.</p></div>`);
  drawChart();
}
function drawChart() {
  const m = state.metric;
  host.querySelectorAll('[data-cm]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cm === m)));
  const r = overlayChart($('[data-chart]', host), last.sa, last.sb, m, [last.na, last.nb]);
  $('[data-ctitle]', host).textContent = `${CHART_METRICS.find(x => x[0] === m)[1]} by ${r.daily ? 'day' : 'hour'}`;
  $('[data-lp]', host).hidden = !r.hasPartial;
}
const trim = (s, n = 40) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

export const comparePage = { id: 'compare', mount, unmount, load: c => { render(); return load(c); }, redrawCharts: () => { if (last && host) drawChart(); } };
