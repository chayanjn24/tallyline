// Anomalies: hours where an entity moved far outside its normal range, grouped into incidents.
// Each card shows the funnel step that moved most (the likely cause), a chart of actual vs normal,
// and the knock-on alerts it explains. The scorecard on top measures the detector against the
// incidents the data generator planted.
import { $, emptyState, errorState, skLines } from '../ui.js';
import { icon } from '../icons.js';
import { esc, money, short, pct, TONE_HEX } from '../format.js';
import { get } from '../api.js';
import { state, query, LEVEL, prefs } from '../state.js';
import { anomalySvg } from '../chart.js';
import { addDays, today } from '../periods.js';

let app = null, host = null, last = null;
const ui = { show: prefs.get('anom.show', 'causes', v => v === 'causes' || v === 'all'), level: 'all' };
const LVL = [['all', 'All levels'], ['dp', 'Demand partners'], ['ds', 'Demand sources'], ['pub', 'Publishers'], ['app', 'Apps']];

function mount(h, a) {
  app = a; host = h;
  h.innerHTML = `<section class="panel scorecard" data-score><div class="panel-b">${skLines(2)}</div></section>
    <div class="an-bar">
      <div class="seg" data-show role="group" aria-label="Which alerts">${[['causes', 'Root causes'], ['all', 'All alerts']].map(([k, l]) => `<button data-s="${k}">${l}</button>`).join('')}</div>
      <div class="seg sm" data-lvl role="group" aria-label="Level">${LVL.map(([k, l]) => `<button data-l="${k}">${l}</button>`).join('')}</div>
      <span class="count" data-count></span>
    </div>
    <div class="an-list" data-list></div>
    <details class="howto"><summary>${icon('alert')}How detection works</summary><div class="tnote">
      <p>Every completed hour of every demand partner, demand source, publisher and app is compared with the <b>same hour of the week over the previous four weeks</b> (Tuesday 14:00 against the last four Tuesdays at 14:00). “Normal” is the median of those four hours. The spread is the median absolute deviation, so one bad week in the history doesn’t move the baseline.</p>
      <p>An hour is flagged when its robust z-score passes 4 and the gap is material (at least $15 of revenue, or 25% of normal requests). A single flagged hour needs a z-score of 7. Consecutive flagged hours pointing the same way become one incident (the gaps-and-islands pattern in <code>sql/anomalies.sql</code>).</p>
      <p><b>Likely cause:</b> revenue = requests × bid rate × win rate × render rate × eCPM. The step that moved most against its normal value names the cause.</p>
      <p><b>Knock-on alerts:</b> when a buyer stops bidding, the publishers it buys from lose revenue too. An alert is grouped under another when the traffic they share, times the cause’s own change, explains at least half of the alert. Shares are measured from the four baseline weeks.</p>
    </div></details>`;
  h.addEventListener('click', onClick);
  paintControls();
}
function unmount() { host = null; last = null; }
function paintControls() {
  host.querySelectorAll('[data-s]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.s === ui.show)));
  host.querySelectorAll('[data-l]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.l === ui.level)));
}

function onClick(e) {
  const s = e.target.closest('[data-s]');
  if (s) { ui.show = s.dataset.s; prefs.set('anom.show', ui.show); paintControls(); if (last) renderList(); return; }
  const l = e.target.closest('[data-l]');
  if (l) { ui.level = l.dataset.l; paintControls(); if (last) renderList(); return; }
  const f = e.target.closest('[data-filter]');
  if (f) { const a = find(f.dataset.filter); if (a) app.filterAndGo(a.level, [{ id: String(a.entityId), name: a.name }], 'anomalies'); return; }
  const o = e.target.closest('[data-open]');
  if (o) { const a = find(o.dataset.open); if (a) app.filterAndGo(a.level, [{ id: String(a.entityId), name: a.name }], LEVEL[a.level].page); return; }
  const j = e.target.closest('[data-jump]');
  if (j) { e.preventDefault(); jump(j.dataset.jump); }
}
const find = id => last?.alerts.find(a => a.id === id);
function jump(id) {
  if (ui.show !== 'all' && find(id)?.cause) { ui.show = 'all'; paintControls(); renderList(); }
  const el = host.querySelector(`[data-card="${CSS.escape(id)}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

async function load(c) {
  const my = c.seq;
  loadScore(c);
  if (!last || !c.silent) $('[data-list]', host).innerHTML = Array.from({ length: 3 }, () => `<div class="panel an-card"><div class="panel-b">${skLines(4)}</div></div>`).join('');
  try {
    const j = await get('/api/anomalies', query(), { fresh: c.fresh });
    if (!c.alive(my) || !host) return;
    last = j; renderList();
  } catch (e) {
    if (c.alive(my) && host) $('[data-list]', host).innerHTML = errorState(e.message);
  }
}

async function loadScore(c) {
  const t = today();
  try {
    const s = await get('/api/anomalies/scorecard', { start: addDays(t, -29), end: t }, { quiet: true });
    if (!c.alive(c.seq) || !host) return;
    const el = $('[data-score]', host);
    if (!s.available) { el.innerHTML = '<div class="panel-b muted">Not enough history yet to score the detector.</div>'; return; }
    el.innerHTML = `<div class="sc-grid">
      <div class="sc-intro"><span class="eyebrow">Detector scorecard · last 30 days</span><p>The data generator plants incidents on purpose (buyer outages, traffic drops, bot-like spikes, price drops) and records them. This is how the detector does against that answer key, without ever seeing it.</p></div>
      <div class="sc-num"><span class="eyebrow">Recall</span><b>${pct(s.recall * 100, 0)}</b><small>caught ${s.caught} of ${s.planted} planted incidents</small></div>
      <div class="sc-num"><span class="eyebrow">Precision</span><b>${pct(s.precision * 100, 0)}</b><small>${s.trueAlerts} of ${s.alerts} root-cause alerts were real</small></div>
      <div class="sc-num"><span class="eyebrow">Grouped</span><b>${s.knockOn}</b><small>knock-on alerts filed under their cause</small></div></div>
      <p class="sc-foot">Synthetic incidents are cleaner than real ones, so treat these numbers as a test that the pipeline works, not a forecast of real-world accuracy.${s.missed.length ? ` Missed: ${s.missed.map(m => esc(`${m.name} (${m.kind.replace('_', ' ')}, ${m.start.slice(5)})`)).join(', ')}.` : ''}</p>`;
  } catch { /* the list matters more than the scorecard */ }
}

function renderList() {
  const all = last.alerts;
  let list = ui.show === 'causes' ? all.filter(a => !a.cause) : all.slice();
  if (ui.level !== 'all') list = list.filter(a => a.level === ui.level);
  const knock = all.filter(a => a.cause).length;
  $('[data-count]', host).textContent = `${list.length} shown · ${all.length - knock} root cause${all.length - knock === 1 ? '' : 's'}, ${knock} knock-on · scanned ${last.from.slice(5)}:00 → ${last.to.slice(5)}:00 UTC`;
  if (!list.length) {
    $('[data-list]', host).innerHTML = emptyState({ ico: 'ok', title: 'Nothing unusual here', sm: true,
      text: all.length ? 'No alerts at this level. Try “All levels”.' : `Every entity in this scope stayed within its normal range${state.start === state.end ? ' today' : ''}. Try a longer range, like Last week.` });
    return;
  }
  $('[data-list]', host).innerHTML = list.map(card).join('');
}

function card(a) {
  const hex = TONE_HEX[a.dir < 0 ? 'bad' : 'good'];
  const f = a.metric === 'rev' ? money : short;
  const dur = `${a.hours} hour${a.hours > 1 ? 's' : ''}`;
  const d = a.driver;
  const cause = a.cause ? `<div class="an-link">${icon('link')}<span>Likely knock-on of <a href="#" data-jump="${esc(a.cause.id)}">${esc(a.cause.title)}</a>: ${pct(a.cause.share * 100, 0)} of this ${a.metric === 'rev' ? 'revenue' : 'traffic'} runs through it.</span></div>` : '';
  const effects = a.effects?.length ? `<details class="an-eff"><summary>${icon('link')}${a.effects.length} knock-on alert${a.effects.length > 1 ? 's' : ''} explained by this</summary><ul>${a.effects.map(x => `<li><a href="#" data-jump="${esc(x.id)}">${esc(x.title)}</a><span class="muted">${pct(x.share * 100, 0)} of its traffic flows here</span></li>`).join('')}</ul></details>` : '';
  return `<article class="panel an-card ${a.severity}${a.cause ? ' knock' : ''}" data-card="${esc(a.id)}">
    <div class="an-main">
      <div class="an-h"><span class="sev" aria-hidden="true"></span><span class="eyebrow">${esc(a.levelName)}${a.parent ? ` · ${esc(a.parent.name)}` : ''}</span><span class="eyebrow an-when">${esc(a.start.slice(5))}:00 → ${esc(a.end.slice(5))}:00 UTC · ${dur}</span></div>
      <h3>${esc(a.title)}</h3>
      ${d ? `<p class="an-driver"><b>${esc(d.step)}</b> <span class="num">${esc(d.normal)}</span> ${icon('right')} <span class="num t-${d.dir < 0 ? 'bad' : 'good'}">${esc(d.actual)}</span><span class="muted"> · ${esc(d.cause)}</span></p>` : ''}
      ${cause}${effects}
      <div class="an-acts"><button class="btn sm" data-filter="${esc(a.id)}">${icon('filter')}Filter to ${esc(a.name)}</button><button class="btn sm ghost" data-open="${esc(a.id)}">${icon(LEVEL[a.level].page)}Open ${esc(LEVEL[a.level].many.toLowerCase())}</button></div>
    </div>
    <div class="an-side">
      <div class="an-nums"><div><span class="eyebrow">${a.metric === 'rev' ? 'Revenue' : 'Requests'}</span><b class="num">${f(a.actual)}</b><small>normal ${f(a.expected)}</small></div>
        <div><span class="eyebrow">Impact</span><b class="num t-${a.dir < 0 ? 'bad' : 'good'}">${a.dir < 0 ? '−' : '+'}${money(a.impact)}</b><small>${a.metric === 'rev' ? 'revenue' : 'revenue equivalent'} · peak z ${a.peakZ}</small></div></div>
      <div class="an-chart">${anomalySvg(a.series, a.metric, a.start, a.end, hex)}</div>
      <div class="legend"><span><i style="border-top-color:${hex}"></i>actual</span><span><i class="dash"></i>normal</span>${a.also?.length ? `<span class="muted">also flagged on ${a.also.map(m => (m === 'rev' ? 'revenue' : 'requests')).join(', ')}</span>` : ''}</div>
    </div></article>`;
}

export const anomaliesPage = { id: 'anomalies', mount, unmount, load, redrawCharts: () => { if (last && host) renderList(); } };
