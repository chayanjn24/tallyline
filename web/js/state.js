// App state ↔ URL hash (so every view is a shareable link) + validated localStorage prefs (?clean=1 resets them).
import { windowFor, PRESET_KEYS, isDate } from './periods.js';
import { CHART_METRICS, HEAT_METRICS } from './metrics.js';

// filter levels, demand side first. Each opens a page listing that level.
export const LEVELS = ['dp', 'ds', 'deal', 'pub', 'plc', 'app'];
export const LEVEL = {
  dp: { one: 'Demand partner', many: 'Demand partners', page: 'demand_partner' },
  ds: { one: 'Demand source', many: 'Demand sources', page: 'demand_source' },
  deal: { one: 'Deal', many: 'Deals', page: 'deal' },
  pub: { one: 'Publisher', many: 'Publishers', page: 'publisher' },
  plc: { one: 'Placement', many: 'Placements', page: 'placement' },
  app: { one: 'App', many: 'Apps', page: 'app' },
};
export const PAGE_LEVEL = Object.fromEntries(LEVELS.map(l => [LEVEL[l].page, l]));
export const PAGES = ['overview', ...LEVELS.map(l => LEVEL[l].page), 'anomalies', 'compare', 'heatmap'];
export const MAX_VALUES = 50;

// ---------- prefs (per-viewer conveniences only) ----------
const PFX = 'tl.';
export const prefs = {
  get(k, d, valid = () => true) {
    try { const v = localStorage.getItem(PFX + k); if (v == null) return d; const x = JSON.parse(v); return valid(x) ? x : d; } catch { return d; }
  },
  set(k, v) { try { localStorage.setItem(PFX + k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
if (new URLSearchParams(location.search).get('clean') === '1') {
  try { Object.keys(localStorage).filter(k => k.startsWith(PFX)).forEach(k => localStorage.removeItem(k)); } catch { /* ignore */ }
  history.replaceState(null, '', location.pathname + location.hash);
}

const emptyFilters = () => Object.fromEntries(LEVELS.map(l => [l, []]));
const isMetric = (list, m) => list.some(x => x[0] === m);
export const state = {
  page: 'overview', preset: 'today',
  start: '', end: '', pstart: '', pend: '', cmp: '',
  filters: emptyFilters(),
  metric: prefs.get('metric', 'rev', m => isMetric(CHART_METRICS, m)),
  hmMetric: prefs.get('hmMetric', 'rev', m => isMetric(HEAT_METRICS, m)),
  compare: { level: 'dp', a: null, b: null },
};
// names learnt from /api/options and tables, so filter chips read well after a reload
export const names = new Map();
export const nameOf = (l, id) => names.get(l + ':' + id) || '';
export const learn = (l, id, name) => { if (name) names.set(l + ':' + id, String(name)); };

export function setRange(preset, s, e) {
  Object.assign(state, windowFor(preset, s, e));
}

const okId = x => /^\d{1,9}$/.test(x);
function readIds(p, l) {
  return [...new Set((p.get(l) || '').split(',').filter(okId))].slice(0, MAX_VALUES);
}

export function readHash(hash = location.hash) {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const v = p.get('v');
  state.page = PAGES.includes(v) ? v : 'overview';
  const pr = p.get('p');
  if (PRESET_KEYS.includes(pr)) setRange(pr);
  else if (isDate(p.get('s')) && isDate(p.get('e'))) setRange('custom', p.get('s'), p.get('e'));
  else setRange('today');
  state.filters = emptyFilters();
  for (const l of LEVELS) state.filters[l] = readIds(p, l).map(id => ({ id, name: nameOf(l, id) }));
  const m = p.get('m');
  if (isMetric(CHART_METRICS, m)) state.metric = m;
  const hm = p.get('hm');
  if (isMetric(HEAT_METRICS, hm)) state.hmMetric = hm;
  const cl = p.get('cl');
  const c = { level: LEVELS.includes(cl) ? cl : 'dp', a: null, b: null };
  for (const k of ['a', 'b']) { const x = p.get(k); if (x && okId(x)) c[k] = x; }
  state.compare = c;
}

export function hashString(page = state.page) {
  const p = new URLSearchParams();
  p.set('v', page);
  if (state.preset !== 'custom') p.set('p', state.preset); else { p.set('s', state.start); p.set('e', state.end); }
  for (const l of LEVELS) {
    const v = state.filters[l];
    if (v.length) p.set(l, v.map(x => x.id).join(','));
  }
  if ((page === 'overview' || page === 'compare') && state.metric !== 'rev') p.set('m', state.metric);
  if (page === 'heatmap' && state.hmMetric !== 'rev') p.set('hm', state.hmMetric);
  if (page === 'compare') {
    p.set('cl', state.compare.level);
    if (state.compare.a) p.set('a', state.compare.a);
    if (state.compare.b) p.set('b', state.compare.b);
  }
  return '#' + p.toString().replace(/%2C/g, ',');
}
export function writeHash(push = false) {
  const h = hashString();
  if (location.hash === h) return;
  if (push) history.pushState(null, '', h); else history.replaceState(null, '', h);
}

// ---------- API params ----------
// o.noPrev drops the comparison window; o.skip leaves one level out; o.ent = [level, id] scopes to one entity
export function query(o = {}) {
  const q = { start: state.start, end: state.end };
  if (!o.noPrev) { q.pstart = state.pstart; q.pend = state.pend; }
  for (const l of LEVELS) {
    if (l === o.skip || (o.ent && o.ent[0] === l)) continue;
    const v = state.filters[l];
    if (v.length) q[l] = v.map(x => x.id).join(',');
  }
  if (o.ent) q[o.ent[0]] = String(o.ent[1]);
  return q;
}
export const hasFilters = () => LEVELS.some(l => state.filters[l].length);
export const filterCount = () => LEVELS.reduce((a, l) => a + state.filters[l].length, 0);
export function setFilter(level, vals) { state.filters[level] = vals.map(x => ({ id: String(x.id), name: x.name || nameOf(level, String(x.id)) })); }
export function clearFilters() { state.filters = emptyFilters(); }
export const isLive = () => state.end >= windowFor('today').end;

// a short human description of the current scope (saved views, report header)
export function scopeText() {
  const f = LEVELS.filter(l => state.filters[l].length)
    .map(l => `${LEVEL[l].one}: ${state.filters[l].map(x => x.name || '#' + x.id).join(', ')}`);
  return f.length ? f.join(' · ') : 'All traffic';
}
