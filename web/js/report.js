// Printable one-page report for the view in the URL hash: KPIs vs the comparison window, the trend,
// leaders, revenue by format, anomalies and definitions. Built from the same API and modules as the app.
import { $, toast, errorState } from './ui.js';
import { esc, money, moneyX, short, pct, chg, tone, deltaCell, fmtRange, fmtDayLong } from './format.js';
import { sides } from './metrics.js';
import { get } from './api.js';
import { state, readHash, query, scopeText, hashString, LEVELS, learn } from './state.js';
import { trendChart } from './chart.js';
import { initTheme } from './theme.js';
import { activeView } from './views.js';

const KPIS = [
  ['rev', 'Revenue', money], ['cost', 'Payout', money], ['margin', 'Margin', money], ['marginPct', 'Margin %', v => pct(v)],
  ['ecpm', 'eCPM', v => moneyX(v, 2)], ['rpmr', 'RPMR', v => moneyX(v, 2)], ['opps', 'Opportunities', short], ['req', 'Bid requests', short],
  ['bidRate', 'Bid rate', v => pct(v, 2)], ['winRate', 'Win rate', v => pct(v, 1)], ['imps', 'Impressions', short], ['fill', 'Fill', v => pct(v, 3)],
];
const RATES = new Set(['marginPct', 'bidRate', 'winRate', 'fill']);
const FORMATS = [['display', 'Display'], ['video', 'Video'], ['native', 'Native'], ['ctv', 'CTV']];

async function names() {
  // filter chips need names: fetch them once for the levels in use
  await Promise.all(LEVELS.filter(l => state.filters[l].length).map(l =>
    get('/api/options', { start: state.start, end: state.end, level: l }, { quiet: true })
      .then(j => (j.options || []).forEach(o => learn(l, String(o.id), o.name)))
      .catch(() => {})));
  readHash();   // read again so the filter chips pick up the names just learnt
}

async function build() {
  initTheme();
  readHash();
  await names();
  const q = query();
  $('#backLink').href = '/' + hashString();
  const [s, dp, pub, an] = await Promise.all([
    get('/api/summary', q), get('/api/breakdown', { ...q, dim: 'demand_partner' }), get('/api/breakdown', { ...q, dim: 'publisher' }),
    get('/api/anomalies', q).catch(() => null),
  ]);
  const S = sides(s);
  const view = activeView();
  document.title = `${view ? view.name : 'Report'} · ${fmtRange(state.start, state.end)} · Tallyline`;
  const kpiRow = ([m, l, f]) => {
    const v = S.total[m], p = S.prev?.[m], c = S.cmp[m];
    if (m === 'opps' && !S.ok) return `<tr><td class="l">${l}</td><td class="na">n/a</td><td class="na">n/a</td><td class="na">demand filter on</td></tr>`;
    let d = RATES.has(m) ? (c != null && p != null ? c - p : null) : chg(c, p);
    if (RATES.has(m) && d != null && Math.abs(d) < 0.0005) d = 0;   // no "-0.0 pts"
    const dc = RATES.has(m) ? (d == null ? '—' : `<span class="dt t-${tone(m, d)}">${d >= 0 ? '+' : ''}${d.toFixed(m === 'fill' ? 3 : 1)} pts</span>`) : deltaCell(m, d);
    return `<tr><td class="l">${l}</td><td>${f(v)}</td><td>${p == null ? '—' : f(p)}</td><td>${dc}</td></tr>`;
  };
  const top = (b, lbl) => `<table class="t compact"><thead><tr><th class="l">${lbl}</th><th>Revenue</th><th>Rev Δ%</th><th>Margin %</th></tr></thead><tbody>${
    b.rows.slice(0, 8).map(r => `<tr><td class="l">${esc(r.name)}</td><td>${money(r.rev)}</td><td>${deltaCell('rev', chg(r.cmpRev ?? r.rev, r.prevRev))}</td><td>${r.rev ? pct((r.rev - r.cost) / r.rev * 100) : '—'}</td></tr>`).join('')}</tbody></table>`;
  const tot = FORMATS.reduce((a, [k]) => a + (s.total.fmt[k]?.rev || 0), 0);
  const alerts = an ? an.alerts.filter(a => !a.cause).slice(0, 6) : [];

  $('#report').innerHTML = `
    <header class="rp-head">
      <div><div class="eyebrow">Tallyline report${view ? ` · ${esc(view.name)}` : ''}</div>
        <h1>${esc(fmtRange(state.start, state.end))} <span>${esc(state.cmp)}</span></h1>
        <p>${esc(scopeText())} · UTC · comparison ${esc(fmtRange(state.pstart, state.pend))}${s.cmp?.completedOnly ? `, completed hours to ${esc(s.cmp.curTo.slice(11))}:00` : ''}</p></div>
      <div class="rp-meta"><span>Generated ${esc(fmtDayLong(new Date().toISOString().slice(0, 10)))} ${new Date().toISOString().slice(11, 16)} UTC</span><span>Synthetic data</span></div>
    </header>
    <section class="rp-hero">${['rev', 'margin', 'ecpm'].map(m => {
      const [, l, f] = KPIS.find(k => k[0] === m), d = chg(S.cmp[m], S.prev?.[m]);
      return `<div><span class="eyebrow">${l}</span><b class="num">${f(S.total[m])}</b>${deltaCell(m, d)}</div>`; }).join('')}
      <div><span class="eyebrow">Anomalies</span><b class="num">${an ? an.alerts.filter(a => !a.cause).length : '—'}</b><span class="muted">root causes in range</span></div></section>
    <section class="rp-grid">
      <div><h2>Key metrics</h2><table class="t compact"><thead><tr><th class="l">Metric</th><th>This period</th><th>Previous</th><th>Change</th></tr></thead><tbody>${KPIS.map(kpiRow).join('')}</tbody></table></div>
      <div><h2>Revenue by ${state.start === state.end || s.hours.length <= 48 ? 'hour' : 'day'}</h2><div class="rp-chart"><canvas id="rpChart" role="img" aria-label="Revenue trend"></canvas></div>
        <h2 style="margin-top:18px">Revenue by format</h2><table class="t compact"><thead><tr><th class="l">Format</th><th>Revenue</th><th>Share</th><th>Margin %</th></tr></thead><tbody>${
          FORMATS.map(([k, l]) => { const x = s.total.fmt[k] || { rev: 0, cost: 0 }; return `<tr><td class="l">${l}</td><td>${money(x.rev)}</td><td>${tot ? pct(x.rev / tot * 100) : '—'}</td><td>${x.rev ? pct((x.rev - x.cost) / x.rev * 100) : '—'}</td></tr>`; }).join('')}</tbody></table></div>
    </section>
    <section class="rp-grid"><div><h2>Top demand partners</h2>${top(dp, 'Demand partner')}</div><div><h2>Top publishers</h2>${top(pub, 'Publisher')}</div></section>
    <section><h2>Anomalies</h2>${alerts.length ? `<ol class="rp-an">${alerts.map(a => `<li><b>${esc(a.title)}</b> <span class="muted">${esc(a.start.slice(5))}:00 → ${esc(a.end.slice(5))}:00 · ${a.dir < 0 ? '−' : '+'}${money(a.impact)}</span><br>${a.driver ? `${esc(a.driver.step)} ${esc(a.driver.normal)} → ${esc(a.driver.actual)}. ${esc(a.driver.cause)}` : ''}${a.effects?.length ? ` <span class="muted">Explains ${a.effects.length} knock-on alert${a.effects.length > 1 ? 's' : ''}.</span>` : ''}</li>`).join('')}</ol>` : '<p class="muted">No anomalies in this range and scope.</p>'}</section>
    <footer class="rp-foot"><p>Revenue = what buyers pay; payout = what publishers receive; margin = revenue − payout. eCPM = revenue × 1000 ÷ impressions; RPMR = revenue per million bid requests; fill = impressions ÷ bid requests. While a range is still running, every change compares completed hours only. Anomalies compare each hour with the same hour of the week over the previous four weeks (median and MAD).</p>
      <p>Live link: ${esc(location.origin + '/' + hashString())}</p></footer>`;
  $('#report').removeAttribute('aria-busy');
  if (typeof Chart !== 'undefined') {
    trendChart($('#rpChart'), s, 'rev', tone('rev', chg(S.cmp.rev, S.prev?.rev)));
  }
}

$('#printBtn').addEventListener('click', () => print());
$('#copyBtn').addEventListener('click', () => navigator.clipboard.writeText(location.href).then(() => toast('Report link copied'), () => toast('Copy failed: select the address bar instead')));
// Chart.js loads with defer; module scripts also run after parsing, so wait for the window load
addEventListener('load', () => build().catch(e => { $('#report').innerHTML = errorState(e.message, { retry: false }); }));
