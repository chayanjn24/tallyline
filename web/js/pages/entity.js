// Entity pages (demand partners, demand sources, deals, publishers, placements, apps): one table
// module configured per level. Sparklines load for the top 30 visible rows, 3 at a time, and are
// cancelled on any change.
import { $, showMenu, errorState } from '../ui.js';
import { esc, chg, tone, TONE_HEX } from '../format.js';
import { derive, seriesOf } from '../metrics.js';
import { get, guard, pool, url } from '../api.js';
import { state, query, setFilter, learn, LEVEL } from '../state.js';
import { sparkSvg } from '../chart.js';
import { span } from '../periods.js';
import { createTable } from '../components/table.js';
import { VIEWS, ctx as colCtx } from '../components/columns.js';

const SPARK_N = 30;

export function entityPage(view, extra = {}) {
  const v = VIEWS[view], level = v.level;
  let table = null, app = null, el = null;
  const sparks = new Map();
  let sparkKey = '';
  const sg = guard();

  function mount(host, a) {
    app = a; el = host;
    host.innerHTML = '<div data-table></div>' + (extra.mountExtra ? extra.mountExtra() : '');
    table = createTable($('[data-table]', host), {
      view, select: extra.select,
      onDrill: (id, name) => app.filterAndGo(level, [{ id, name }], v.drill),
      onApp: (id, name) => app.filterAndGo('app', [{ id, name }]),
      onMenu: (anchor, r) => rowMenu(anchor, r),
      afterDraw: (shown, trendOn) => { if (trendOn) loadSparks(shown); extra.afterDraw?.(); },
    });
    extra.onMount?.(host, app, table);
  }
  function unmount() { sg.cancel(); table = null; colCtx.open.clear(); extra.onUnmount?.(); }

  function rowMenu(anchor, r) {
    const id = String(r.id), name = r.name || '#' + id;
    showMenu(anchor, [
      { label: 'Filter to this', icon: 'filter', run: () => { setFilter(level, [{ id, name }]); app.filtersChanged(); } },
      { label: 'Add to filter', icon: 'plus', run: () => app.addFilter(level, id, name) },
      { label: 'Compare…', icon: 'compare', run: () => app.compare(level, id) },
      'sep',
      { label: 'Anomalies for this', icon: 'anomalies', run: () => app.filterAndGo(level, [{ id, name }], 'anomalies') },
      { label: 'Hour × day heatmap', icon: 'heatmap', run: () => app.filterAndGo(level, [{ id, name }], 'heatmap') },
    ], name);
  }

  async function load(c, sumP) {
    const my = c.seq;
    if (!c.silent) table.setLoading(true);
    if (c.fresh) sparkKey = '';
    if (view === 'deal') loadCounts(c);
    try {
      const [s, b] = await Promise.all([sumP, get('/api/breakdown', { ...query(), dim: view }, { fresh: c.fresh })]);
      if (!c.alive(my) || !table) return;
      const ok = s.oppsAvailable !== false && b.oppsAvailable !== false;
      const rows = (b.rows || []).map(r => { learn(level, r.id, r.name); return derive(r, s.total.hours, ok); });
      table.setRows(rows, s.total.hours, ok);
      table.setNote(note(s, ok));
      extra.onRows?.(rows);
    } catch (e) {
      if (!c.alive(my) || !table) return;
      table.setError(errorState(e.message));
    }
  }
  // deals: how many apps each deal served (one = dedicated, more = run of network)
  function loadCounts(c) {
    colCtx.counts = null;
    Promise.all([
      get('/api/deal-apps/counts', query({ noPrev: true }), { fresh: c.fresh, quiet: true }),
      get('/api/options', { start: state.start, end: state.end, level: 'app' }, { quiet: true }),
    ]).then(([j, o]) => {
      if (!c.alive(c.seq) || !table) return;
      const nm = new Map((o.options || []).map(x => [String(x.id), x.name]));
      colCtx.appName = id => nm.get(String(id)) || '#' + id;
      colCtx.counts = j.counts || {};
      table.redraw();
    }).catch(() => { if (c.alive(c.seq) && table) { colCtx.counts = {}; table.redraw(); } });
  }

  // sparklines: one /api/summary per row (scoped to it), painted into the Trend cells
  function loadSparks(shown) {
    const key = url('', query());
    if (key !== sparkKey) { sparks.clear(); sparkKey = key; }
    const ids = shown.slice(0, SPARK_N).map(r => String(r.id));
    const rowById = new Map(shown.map(r => [String(r.id), r]));
    ids.forEach(id => paint(id, rowById.get(id)));
    const my = sg.next(), multi = span(state.start, state.end) >= 3;
    pool(ids.filter(id => !sparks.has(id)), 3, async id => {
      const s = await get('/api/summary', query({ ent: [level, id] }), { quiet: true });
      if (!sg.alive(my)) return;
      sparks.set(id, { cur: seriesOf(s.hours, 'rev', multi), prev: seriesOf(s.prevHours, 'rev', multi) });
      paint(id, rowById.get(id));
    }, () => sg.alive(my));
  }
  function paint(id, r) {
    const sp = sparks.get(id), cellEl = el && $(`[data-spark="${CSS.escape(id)}"]`, el);
    if (!sp || !cellEl || !r) return;
    cellEl.innerHTML = sparkSvg(sp.cur, sp.prev, TONE_HEX[tone('rev', chg(r.cmpRev ?? r.rev, r.prevRev))] || TONE_HEX.flat);
  }

  function note(s, ok) {
    const supplySide = ['pub', 'plc', 'app'].includes(level);
    const cmp = `${esc(state.cmp)}${s.cmp?.completedOnly ? `, completed hours to ${esc(s.cmp.curTo.slice(11, 13))}:00 UTC` : ''}`;
    return [
      `Rev Δ% and Req Δ% compare ${cmp}. Previous values, revenue by format and video quality are in Columns.`,
      'Trend = revenue sparkline for the top 30 rows on screen (dashed = comparison window).',
      `Avg QPS uses ${(+s.total.hours).toFixed(1)} hour(s); the live hour counts as the share elapsed so far.`,
      supplySide ? 'Opportunities are counted on the supply side, before any deal sees the traffic.' : 'Opportunities are a supply-side count, so they are not shown for demand-side rows.',
      !ok && supplySide ? 'Opportunities show n/a while a demand-side filter is on (a request can’t be traced back to one opportunity per buyer).' : '',
      `Click a name to filter by it and open ${esc(LEVEL[VIEWS[v.drill].level].many.toLowerCase())}. The ⋯ menu has Filter, Compare, Anomalies and Heatmap.`,
      view === 'deal' ? 'Apps: one app = a dedicated deal (click to filter); more = run of network (click for its top 5). Setup, Status, Target margin and QPS cap are the current deal settings.' : '',
    ].filter(Boolean).map(t => `<p>${t}</p>`).join('');
  }

  return { id: view, mount, unmount, load, focusSearch: () => table?.focusSearch(), get table() { return table; } };
}
