// Overview: hero KPIs, the metrics strip, the trend chart, the latest anomalies, revenue by format,
// leader lists and the footnote.
import { $, errorState, tweenText, skLines } from '../ui.js';
import { icon } from '../icons.js';
import { esc, money, moneyHero, moneyX, short, pct, int, chg, tone, deltaBadge, deltaCell, TONE_HEX, fmtRange } from '../format.js';
import { sides, seriesOf, CHART_METRICS, METRIC_FMT } from '../metrics.js';
import { get } from '../api.js';
import { state, query, prefs, writeHash, learn, LEVEL } from '../state.js';
import { trendChart, destroyChart, sparkSvg } from '../chart.js';
import { span } from '../periods.js';

let app = null, host = null, lastSum = null;
const heroPrev = {};

const HERO = [
  ['rev', 'Revenue', moneyHero, money],
  ['cost', 'Payout', moneyHero, money],
  ['margin', 'Margin', moneyHero, money],
  ['ecpm', 'eCPM', v => moneyX(v, 2), v => moneyX(v, 2)],
];
const TOPS = [
  ['demand_partner', 'dp', 'Top demand partners'],
  ['publisher', 'pub', 'Top publishers'],
  ['app', 'app', 'Top apps'],
];
const FORMATS = [['display', 'Display', .92], ['video', 'Video', .62], ['native', 'Native', .38], ['ctv', 'CTV', .2]];

function mount(h, a) {
  app = a; host = h;
  h.innerHTML = `<div data-err></div>
    <section class="kpis" data-kpis aria-label="Key metrics">${HERO.map(([, l]) => `<div class="kpi"><span class="eyebrow">${l}</span><div class="v sk" style="width:70%">&nbsp;</div><div class="d"><span class="sk" style="width:60%;height:12px"></span></div><div class="spark"></div></div>`).join('')}</section>
    <section class="strip" data-strip aria-label="Metrics strip">${Array.from({ length: 8 }, () => '<div class="sm-cell"><span class="sk" style="display:block;width:60%;height:10px"></span><div class="v sk" style="width:70%">&nbsp;</div><div class="d"><span class="sk" style="width:40%;height:10px"></span></div></div>').join('')}</section>
    <section class="panel chart-panel">
      <div class="panel-h"><h3 data-ctitle>Revenue</h3><span data-cdelta></span>
        <div class="legend" data-legend></div>
        <div class="seg sm" data-metric role="group" aria-label="Chart metric">${CHART_METRICS.map(([k, l]) => `<button data-m="${k}">${l}</button>`).join('')}</div></div>
      <div class="chart-box stale" data-cbox><canvas data-chart aria-label="Trend chart" role="img"></canvas></div>
    </section>
    <section class="section"><div class="section-h"><h2>Anomalies</h2><span class="note" data-anote>unusual hours in this range, against each entity's normal</span>
      <div class="right"><a class="btn sm" href="#v=anomalies" data-go="anomalies">${icon('anomalies')}All anomalies</a></div></div>
      <div class="ov-anoms" data-anoms>${'<div class="panel ov-an"><div class="panel-b">' + skLines(3) + '</div></div>'.repeat(3)}</div></section>
    <section class="section"><div class="section-h"><h2>Revenue by format</h2><span class="note" data-fnote></span></div><div class="panel" data-fmt><div class="panel-b">${skLines(5)}</div></div></section>
    <section class="section"><div class="section-h"><h2>Leaders</h2><span class="note">by revenue · click to open the page filtered to it</span></div>
      <div class="grid-3">${TOPS.map(([dim, , t]) => `<div class="panel"><div class="panel-h"><h3>${t}</h3><a class="more" href="#v=${dim}" data-go="${dim}">All ${icon('right')}</a></div><ul class="top-list" data-top="${dim}">${'<li><span></span><span class="sk" style="height:10px"></span><span></span><span></span></li>'.repeat(5)}</ul></div>`).join('')}</div></section>
    <div class="footnote" data-foot></div>`;
  paintSeg();
  $('[data-ctitle]', h).textContent = CHART_METRICS.find(x => x[0] === state.metric)[1];
  $('[data-metric]', h).addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    state.metric = b.dataset.m; prefs.set('metric', state.metric); writeHash();
    if (lastSum) renderChart(lastSum);
  });
  h.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) { e.preventDefault(); app.go(go.dataset.go); return; }
    const an = e.target.closest('[data-an]');
    if (an) { app.filterAndGo(an.dataset.lv, [{ id: an.dataset.an, name: an.dataset.name }], 'anomalies'); return; }
    const li = e.target.closest('[data-tid]');
    if (li) app.filterAndGo(li.dataset.lv, [{ id: li.dataset.tid, name: li.dataset.name }], li.dataset.page);
  });
  h.addEventListener('keydown', e => { const li = e.target.closest('[data-tid],[data-an]'); if (li && e.key === 'Enter') li.click(); });
}
function unmount() { destroyChart(host && $('[data-chart]', host)); host = null; lastSum = null; }

async function load(c, sumP) {
  const my = c.seq;
  $('[data-cbox]', host)?.classList.add('stale');
  TOPS.forEach(([dim, lv]) => loadTop(c, dim, lv));
  loadAnomalies(c);
  try {
    const s = await sumP;
    if (!c.alive(my) || !host) return;
    lastSum = s;
    $('[data-err]', host).innerHTML = '';
    renderKpis(s); renderStrip(s); renderChart(s); renderFormat(s); renderFoot(s);
  } catch (e) {
    if (!c.alive(my) || !host) return;
    $('[data-err]', host).innerHTML = `<div class="banner" role="alert">${icon('alert')}<span>Could not load the overview: ${esc(e.message)}</span><button class="btn sm" data-act="retry">Retry</button></div>`;
    $('[data-cbox]', host).classList.remove('stale');
  }
}

const was = (f, p) => (p == null ? 'no comparison' : `was ${f(p)}`);
function renderKpis(s) {
  const S = sides(s), multi = span(s.start, s.end) >= 3;   // daily points from 3 days, like the chart
  const tip = `${state.cmp}: ${fmtRange(s.pstart, s.pend)}${s.cmp?.completedOnly ? ' · completed hours only' : ''}`;
  $('[data-kpis]', host).innerHTML = HERO.map(([m, l, fv, fp]) => {
    const v = S.total[m], p = S.prev?.[m], d = chg(S.cmp[m], p);
    let extra = '', pts = '';
    if (m === 'margin') {
      extra = S.total.marginPct != null ? `<small>${pct(S.total.marginPct)}</small>` : '';
      if (S.prev?.marginPct != null && S.cmp.marginPct != null) {
        const pp = Math.round((S.cmp.marginPct - S.prev.marginPct) * 10) / 10;   // rounded first: never "-0.0"
        pts = `<span class="t-${tone('marginPct', pp)}" title="Margin % was ${pct(S.prev.marginPct)}">${pp > 0 ? '+' : pp < 0 ? '−' : '±'}${Math.abs(pp).toFixed(1)} pts</span>`;
      }
    }
    const sp = sparkSvg(seriesOf(s.hours, m, multi), seriesOf(s.prevHours, m, multi), TONE_HEX[tone(m, d)], 300, 44);
    return `<div class="kpi" title="${esc(l)} · ${esc(tip)}"><span class="eyebrow">${l}</span>
      <div class="v" data-hero="${m}" data-v="${heroPrev[m] ?? ''}">${fv(v)}${extra}</div>
      <div class="d">${deltaBadge(m, S.cmp[m], p, tip)}<span>${was(fp, p)}</span>${pts}</div><div class="spark">${sp}</div></div>`;
  }).join('');
  HERO.forEach(([m, , fv]) => {
    const el = $(`[data-hero="${m}"]`, host), small = el.querySelector('small')?.outerHTML || '';
    tweenText(el, S.total[m], x => fv(x) + small);
    heroPrev[m] = S.total[m];
  });
}

function renderStrip(s) {
  const S = sides(s), c = S.total, k = S.cmp, p = S.prev;
  const na = !S.ok || c.opps == null;
  const cell = (lbl, v, m, f, sub = '', tip = '') => {
    const delta = m === null ? `<span class="muted">${sub}</span>` : `${deltaBadge(m, k[m], p?.[m], p ? 'Previous ' + f(p[m]) : '')}${sub ? `<span>${sub}</span>` : ''}`;
    return `<div class="sm-cell" title="${esc(tip || lbl)}"><span class="eyebrow">${lbl}</span><div class="v${m === 'wins' ? ' tight' : ''}">${v}</div><div class="d">${delta}</div></div>`;
  };
  $('[data-strip]', host).innerHTML = [
    na ? cell('Opportunities', '<span class="muted">n/a</span>', null, short, 'demand filter on', 'Opportunities are counted on the supply side, so they are n/a under demand-side filters')
      : cell('Opportunities', short(c.opps), 'opps', short, '', 'Ad opportunities offered by publishers'),
    cell('Bid requests', short(c.req), 'req', short, '', 'Requests sent to buyers (one opportunity can go to several deals)'),
    cell('Bid rate', pct(c.bidRate, 2), 'bidRate', v => pct(v, 2), '', 'Bids ÷ bid requests'),
    cell('Bids / Wins', `${short(c.bids)}<span class="sl">/</span>${short(c.wins)}`, 'wins', short, c.winRate ? `win ${pct(c.winRate)}` : '', `Bids ${int(c.bids)} · wins ${int(c.wins)} · Δ on wins`),
    cell('Impressions', short(c.imps), 'imps', short),
    cell('Fill', pct(c.fill, 3), 'fill', v => pct(v, 3), '', 'Impressions ÷ bid requests'),
    cell('RPMR', moneyX(c.rpmr, 2), 'rpmr', v => moneyX(v, 2), '', 'Revenue per million bid requests'),
    cell('Avg QPS', int(c.qps), 'qps', int, '', 'Bid requests per second; the live hour counts as the share elapsed'),
  ].join('');
}

function renderChart(s) {
  paintSeg();
  const S = sides(s), m = state.metric, f = METRIC_FMT[m] || short;
  const d = S.prev ? chg(S.cmp[m], S.prev[m]) : null;
  const r = trendChart($('[data-chart]', host), s, m, tone(m, d));
  const name = CHART_METRICS.find(x => x[0] === m)[1];
  $('[data-ctitle]', host).textContent = `${name} by ${r.daily ? 'day' : 'hour'}`;
  $('[data-cdelta]', host).innerHTML = S.prev ? deltaBadge(m, S.cmp[m], S.prev[m], `Previous ${f(S.prev[m])}`) : '';
  $('[data-legend]', host).innerHTML = `<span><i style="border-top-color:${r.hex}"></i>${esc(fmtRange(s.start, s.end))}</span><span><i class="dash"></i>${esc(fmtRange(s.pstart, s.pend))}</span>${r.hasPartial ? '<span><i class="dot"></i>Live hour, projected</span>' : ''}`;
  $('[data-cbox]', host).classList.remove('stale');
}
function paintSeg() { host.querySelectorAll('[data-m]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === state.metric))); }

// Revenue by format: monochrome shares; Δ uses completed hours
function renderFormat(s) {
  const cur = s.total.fmt, prv = s.prev?.fmt, cmpF = (s.cur || s.total).fmt;
  if (!cur) { $('[data-fmt]', host).innerHTML = '<div class="panel-b muted">No format split for this range.</div>'; return; }
  const g = k => cur[k] || { rev: 0, cost: 0 };
  const tot = FORMATS.reduce((a, [k]) => a + g(k).rev, 0);
  const col = a => `rgba(var(--ink), ${a})`;
  const bar = FORMATS.filter(([k]) => g(k).rev > 0).map(([k, l, a]) => `<span style="width:${(g(k).rev / (tot || 1)) * 100}%;background:${col(a)}" title="${l} ${money(g(k).rev)}"></span>`).join('');
  const rows = FORMATS.map(([k, l, a]) => {
    const x = g(k), m = x.rev - x.cost;
    return `<tr><td class="l name"><span class="sw" style="background:${col(a)}"></span>${l}</td>
      <td>${money(x.rev)}</td><td>${money(x.cost)}</td><td>${money(m)}</td><td>${x.rev ? pct(m / x.rev * 100) : '—'}</td>
      <td>${tot ? pct(x.rev / tot * 100) : '—'}</td><td>${prv ? money(prv[k]?.rev || 0) : '—'}</td><td>${prv ? deltaCell('rev', chg(cmpF[k]?.rev || 0, prv[k]?.rev || 0)) : '—'}</td></tr>`;
  }).join('');
  $('[data-fnote]', host).textContent = `share of revenue · Δ ${state.cmp}`;
  $('[data-fmt]', host).innerHTML = `<div class="panel-b" style="padding-bottom:0"><div class="fmtbar">${bar}</div></div><div style="overflow-x:auto"><table class="t compact">
    <thead><tr><th class="l">Format</th><th>Revenue</th><th>Payout</th><th>Margin</th><th>Margin %</th><th>Share</th><th>Prev revenue</th><th>Rev Δ%</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function loadTop(c, dim, lv) {
  const my = c.seq;
  try {
    const b = await get('/api/breakdown', { ...query(), dim }, { fresh: c.fresh });
    if (!c.alive(my) || !host) return;
    const rows = (b.rows || []).slice().sort((a, z) => z.rev - a.rev).slice(0, 5);
    rows.forEach(r => learn(lv, r.id, r.name));
    $(`[data-top="${dim}"]`, host).innerHTML = rows.length ? rows.map((r, i) => {
      const d = chg(r.cmpRev ?? r.rev, r.prevRev);
      return `<li tabindex="0" data-tid="${esc(r.id)}" data-name="${esc(r.name)}" data-lv="${lv}" data-page="${LEVEL[lv].page}" title="${esc(r.name)} · open ${esc(LEVEL[lv].many.toLowerCase())} filtered to it">
        <span class="rk">${String(i + 1).padStart(2, '0')}</span><span class="nm">${esc(r.name)}${r.partner ? `<small>${esc(r.partner)}</small>` : ''}</span><span class="rv">${money(r.rev)}</span>${deltaBadge('rev', r.cmpRev ?? r.rev, r.prevRev, d == null ? '' : `Previous ${money(r.prevRev)}`)}</li>`;
    }).join('') : '<li class="quiet" style="cursor:default">No activity in this range</li>';
  } catch (e) {
    if (c.alive(my) && host) $(`[data-top="${dim}"]`, host).innerHTML = `<li class="quiet" style="cursor:default">Could not load: ${esc(e.message)}</li>`;
  }
}

async function loadAnomalies(c) {
  const my = c.seq;
  try {
    const j = await get('/api/anomalies', query(), { fresh: c.fresh, quiet: true });
    if (!c.alive(my) || !host) return;
    const top = j.alerts.filter(a => !a.cause);
    $('[data-anote]', host).textContent = top.length
      ? `${top.length} in this range · the largest ${Math.min(3, top.length)} by revenue impact`
      : 'unusual hours in this range, against each entity’s normal';
    $('[data-anoms]', host).innerHTML = top.length ? top.slice(0, 3).map(a => `<div class="panel ov-an ${a.severity}" tabindex="0" data-an="${esc(a.entityId)}" data-lv="${a.level}" data-name="${esc(a.name)}" title="Open anomalies for ${esc(a.name)}">
        <div class="eyebrow">${esc(a.levelName)} · ${esc(a.start.slice(5))}:00 → ${esc(a.end.slice(11))}:00</div>
        <h3>${esc(a.title)}</h3>
        <p>${a.driver ? `<b>${esc(a.driver.step)}</b> ${esc(a.driver.normal)} → ${esc(a.driver.actual)}. ` : ''}${esc(a.driver?.cause || '')}</p>
        <div class="ov-an-f"><span class="t-${a.dir < 0 ? 'bad' : 'good'}">${a.dir < 0 ? '−' : '+'}${money(a.impact)}</span>${a.effects?.length ? `<span class="muted">${a.effects.length} knock-on alert${a.effects.length > 1 ? 's' : ''}</span>` : ''}</div></div>`).join('')
      : `<div class="panel ov-an quiet-card">${icon('ok')}<div><h3>Nothing unusual</h3><p>No entity moved outside its normal range${span(state.start, state.end) === 1 ? ' today' : ''} in this scope.</p></div></div>`;
  } catch (e) {
    if (c.alive(my) && host) $('[data-anoms]', host).innerHTML = `<div class="panel ov-an quiet-card">${icon('alert')}<div><h3>Could not scan for anomalies</h3><p>${esc(e.message)}</p></div></div>`;
  }
}

function renderFoot(s) {
  const days = span(s.start, s.end);
  $('[data-foot]', host).innerHTML = [
    `Δ compares ${esc(state.cmp)} (${esc(fmtRange(s.pstart, s.pend))})${s.cmp?.completedOnly ? `, completed hours only: both sides stop at ${esc(s.cmp.curTo.slice(11, 13))}:00 UTC. The big numbers still include the live hour` : ''}.`,
    `The chart is ${days >= 3 ? 'daily (3+ days)' : 'hourly'}. The live hour is drawn dotted at its projected full-hour value (value ÷ share of the hour elapsed) and is never used in a Δ.`,
    'Revenue is what buyers pay; payout is what publishers receive; margin is the difference. Opportunities are counted on the supply side, so they are n/a while a demand partner, demand source or deal filter is on.',
    'All data is synthetic: generated hour by hour from a fixed seed, with incidents planted on purpose for the anomaly detector to find.',
  ].map(t => `<p>${t}</p>`).join('');
}

export const overviewPage = { id: 'overview', mount, unmount, load, redrawCharts: () => { if (lastSum && host) renderChart(lastSum); } };
