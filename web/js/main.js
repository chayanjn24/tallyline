// Tallyline boot: router (URL hash), sequence-guarded loads, prefetch, 5-minute silent auto-refresh,
// keyboard shortcuts. Read-only: every request is a GET.
import { $, toast, closeMenu } from './ui.js';
import { get, clearCache } from './api.js';
import { state, readHash, writeHash, query, setRange, setFilter, clearFilters, LEVEL, MAX_VALUES, isLive } from './state.js';
import { addDays, today } from './periods.js';
import { initTheme, onTheme } from './theme.js';
import { initShell, syncShell, setSummaryMeta, setRefreshing, toggleMenu, navOpen, closeNav, closeSave } from './components/shell.js';
import { initFilterBar, renderFilterBar, openLevels, closePicker, pickerOpen, resolveNames } from './components/filterbar.js';
import { initDrawer, loadAlerts, toggleDrawer, closeDrawer, drawerOpen } from './components/drawer.js';
import { initCmdk, openCmdk, closeCmdk, cmdkOpen } from './components/cmdk.js';
import { closeColumnPicker } from './components/colpick.js';
import { clearDealApps } from './components/dealapps.js';
import { ctx as colCtx } from './components/columns.js';
import { overviewPage } from './pages/overview.js';
import { entityPage } from './pages/entity.js';
import { appsPage } from './pages/apps.js';
import { anomaliesPage } from './pages/anomalies.js';
import { comparePage } from './pages/compare.js';
import { heatmapPage } from './pages/heatmap.js';

const PAGES = {
  overview: overviewPage,
  demand_partner: entityPage('demand_partner'), demand_source: entityPage('demand_source'), deal: entityPage('deal'),
  publisher: entityPage('publisher'), placement: entityPage('placement'), app: appsPage,
  anomalies: anomaliesPage, compare: comparePage, heatmap: heatmapPage,
};
let current = null, seq = 0;

function newCtx(o) {
  const n = ++seq;
  return { seq: n, alive: x => x === seq, silent: !!o.silent, fresh: !!o.fresh };
}

// render: sync the shell, (re)mount the page when it changed, then load its data
function render(o = {}) {
  writeHash(o.push);
  syncShell(); renderFilterBar(); closeMenu(); closeColumnPicker();
  const mod = PAGES[state.page];
  if (current !== mod) {
    current?.unmount?.();
    current = mod;
    const view = $('#view');
    view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
    mod.mount(view, app);
    if (!o.keepScroll) scrollTo({ top: 0 });
  }
  load(o);
}
function load(o = {}) {
  const c = newCtx(o);
  setRefreshing(true);
  const sumP = get('/api/summary', query(), { fresh: c.fresh });
  sumP.then(s => { if (c.alive(c.seq)) setSummaryMeta(s); }).catch(() => { if (c.alive(c.seq)) setSummaryMeta('err'); });
  const slow = setTimeout(() => { if (c.alive(c.seq) && !c.silent) toast('Still loading… the first request after a deploy wakes the server up.', 4200); }, 8000);
  Promise.resolve(current.load(c, sumP)).catch(() => {}).finally(() => {
    clearTimeout(slow);
    if (!c.alive(c.seq)) return;
    setRefreshing(false);
    loadAlerts(c);
    prefetch(c);
  });
}
// warm the demand pages in the background so they open instantly
function prefetch(c) {
  ['demand_partner', 'publisher', 'deal'].reduce((p, dim) => p.then(() => (c.alive(c.seq) ? get('/api/breakdown', { ...query(), dim }, { quiet: true }).catch(() => {}) : null)), Promise.resolve());
}

// ---------- the app API used by pages and components ----------
const app = {
  go(page) { if (page === state.page) return; state.page = page; render({ push: true }); },
  preset(k) { if (k === 'custom') setRange('custom', state.start, state.end); else setRange(k); render(); },
  custom(s, e) { setRange('custom', s, e); render(); },
  last14() { const t = today(); app.custom(addDays(t, -13), t); },
  reload(fresh = true) {
    if (fresh) { clearCache(); clearDealApps(); load({ fresh: true, silent: true }); } else load({});
  },
  openHash(hash) { if (location.hash === hash) return; history.pushState(null, '', hash); readHash(); resolveNames(); render(); },
  filtersChanged() { colCtx.open.clear(); render({ keepScroll: true }); },
  clearFilters() { clearFilters(); app.filtersChanged(); },
  filterAndGo(level, vals, page) {
    setFilter(level, vals);
    if (page && page !== state.page) { colCtx.open.clear(); state.page = page; render({ push: true }); } else app.filtersChanged();
  },
  addFilter(level, id, name) {
    const cur = state.filters[level];
    if (cur.some(x => x.id === String(id))) { toast(`${name} is already in the filter`); return; }
    if (cur.length >= MAX_VALUES) { toast(`At most ${MAX_VALUES} values per filter`); return; }
    setFilter(level, [...cur, { id: String(id), name }]);
    toast(`Added ${LEVEL[level].one.toLowerCase()} filter: ${name}`);
    app.filtersChanged();
  },
  scope(level, id, name) { setFilter(level, [{ id: String(id), name }]); app.filtersChanged(); },
  openEntity(level, id, name) { app.filterAndGo(level, [{ id: String(id), name }], LEVEL[level].page); },
  compare(level, a, b = null) {
    state.compare = { level, a: String(a), b: b == null ? null : String(b) };
    if (state.page === 'compare') { current.unmount(); current = null; }
    state.page = 'compare'; render({ push: true });
  },
  toggleMenu, openFilter: () => openLevels(), alerts: toggleDrawer, cmdk: openCmdk,
};

// ---------- keyboard ----------
let gPending = 0;
const G = { o: 'overview', p: 'demand_partner', s: 'demand_source', d: 'deal', u: 'publisher', l: 'placement', b: 'app', n: 'anomalies', c: 'compare', h: 'heatmap' };
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); cmdkOpen() ? closeCmdk() : openCmdk(); return; }
  if (e.key === 'Escape') {
    if (cmdkOpen()) { closeCmdk(); return; }
    if (drawerOpen()) { closeDrawer(); return; }
    if (pickerOpen()) { closePicker(true); return; }
    if (navOpen()) { closeNav(); return; }
    closeMenu(); closeColumnPicker(); closeSave();
    return;
  }
  const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  if (typing || e.metaKey || e.ctrlKey || e.altKey || cmdkOpen()) return;
  if (gPending && Date.now() - gPending < 1200 && G[e.key]) { e.preventDefault(); gPending = 0; app.go(G[e.key]); return; }
  gPending = 0;
  if (e.key === 'g') { gPending = Date.now(); return; }
  if (e.key === '/') { e.preventDefault(); if (current?.focusSearch) current.focusSearch(); else openCmdk(); }
  else if (e.key === '[') { e.preventDefault(); toggleMenu(); }
  else if (e.key === 'f') { e.preventDefault(); openLevels(); }
  else if (e.key === 'a') { e.preventDefault(); toggleDrawer(); }
  else if (e.key === 'r') { e.preventDefault(); app.reload(true); }
});
$('#view').addEventListener('click', e => { if (e.target.closest('[data-act="retry"]')) app.reload(true); });
// in-page links that would otherwise rewrite the hash and reset the view
$('.skip').addEventListener('click', e => { e.preventDefault(); $('#main').focus(); });
$('.wordmark').addEventListener('click', e => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); app.go('overview'); });

// pasted / edited links and back / forward
let urlT = null;
function fromUrl() { clearTimeout(urlT); urlT = setTimeout(() => { readHash(); resolveNames(); render(); }, 0); }
addEventListener('popstate', fromUrl);
addEventListener('hashchange', fromUrl);

// auto-refresh every 5 min without blanking; presets roll over to the new day
setInterval(() => {
  if (document.hidden) return;
  if (state.preset !== 'custom') setRange(state.preset);
  else if (!isLive()) return;
  clearCache(); clearDealApps();
  render({ fresh: true, silent: true, keepScroll: true });
}, 5 * 60000);

initTheme();
readHash();
initShell(app);
initFilterBar(() => app.filtersChanged());
initDrawer(app);
initCmdk(app);
onTheme(() => current?.redrawCharts?.());
resolveNames();
render();
