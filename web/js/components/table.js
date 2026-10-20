// The shared entity table: search, sort, column picker, totals, 200-row paging, CSV, drill clicks,
// the deal → apps sub-rows, row ⋯ menus and optional row checkboxes. One instance per page mount.
import { $, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { esc, int } from '../format.js';
import { derive } from '../metrics.js';
import { prefs, LEVEL } from '../state.js';
import { COLS, VIEWS, HIDDEN_DEFAULT, SUM_KEYS, ctx } from './columns.js';
import { exportCsv } from './csv.js';
import { subRow, onRonClick } from './dealapps.js';
import { openColumnPicker } from './colpick.js';

const PAGE = 200;

export function createTable(host, o) {
  const v = VIEWS[o.view];
  const t = {
    rows: [], hours: 1, oppsOk: true, q: '', pg: 0, loading: true, error: null,
    sort: prefs.get('sort.' + o.view, { k: 'rev', dir: -1 }, s => s && COLS[s.k] && v.cols.includes(s.k) && (s.dir === 1 || s.dir === -1)),
    hidden: new Set(prefs.get('cols.' + o.view, HIDDEN_DEFAULT.filter(c => v.cols.includes(c)), a => Array.isArray(a) && a.every(c => typeof c === 'string'))),
  };

  host.innerHTML = `<div class="tbar">
      <label class="search">${icon('search')}<input type="search" data-q placeholder="Search ${esc(v.search)}" aria-label="Search table" autocomplete="off"><kbd>/</kbd></label>
      <span class="count" data-count></span><span class="spacer"></span>
      <button class="btn" data-cols aria-haspopup="true">${icon('columns')}Columns</button>
      <button class="btn" data-csv>${icon('download')}Export CSV</button>
    </div><div class="tw" data-tw></div><div class="pager" data-pager></div><div class="tnote" data-note></div>`;
  const tw = $('[data-tw]', host);
  let timer = null;
  $('[data-q]', host).addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => { t.q = e.target.value; t.pg = 0; draw(); }, 140); });
  $('[data-q]', host).addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; t.q = ''; draw(); e.target.blur(); } });
  $('[data-csv]', host).addEventListener('click', () => exportCsv(o.view, visibleCols().filter(c => !COLS[c].special), visible()));
  $('[data-cols]', host).addEventListener('click', e => openColumnPicker(e.currentTarget, v.cols.filter(c => c !== 'name'), t.hidden, () => {
    prefs.set('cols.' + o.view, [...t.hidden]); draw();
  }));
  $('[data-pager]', host).addEventListener('click', e => {
    const b = e.target.closest('[data-pg]'); if (!b) return;
    t.pg = Math.max(0, t.pg + +b.dataset.pg); draw(); tw.scrollTop = 0;
  });
  tw.addEventListener('click', onClick);
  tw.addEventListener('change', onChange);

  const visibleCols = () => v.cols.filter(c => c === 'name' || !t.hidden.has(c));
  function visible() {
    const q = t.q.trim().toLowerCase(), col = COLS[t.sort.k], f = col.f, dir = t.sort.dir;
    const rows = t.rows.filter(r => !q || [r.name, r.id, r.demand, r.partner, r.publisher, r.bundle].some(x => String(x ?? '').toLowerCase().includes(q)));
    rows.sort((a, b) => {
      const x = f(a), y = f(b);
      if (col.txt) return String(x ?? '').localeCompare(String(y ?? '')) * dir;
      const xn = x == null || Number.isNaN(x), yn = y == null || Number.isNaN(y);
      if (xn || yn) return xn - yn;   // empty values last
      return x === y ? 0 : (x < y ? -1 : 1) * dir;
    });
    return rows;
  }
  function totals(rows) {
    const sum = {};
    for (const k of SUM_KEYS) sum[k] = rows.some(r => r[k] != null) ? rows.reduce((a, r) => a + (+r[k] || 0), 0) : null;
    const tot = derive(sum, t.hours, t.oppsOk);
    return Object.assign(tot, { total: true, name: `Total · ${int(rows.length)}`, id: '', partner: '', demand: '', publisher: '', bundle: '', format: '', region: '', mode: '', enabled: '' });
  }

  function cell(c, r, stickyLeft) {
    const col = COLS[c], raw = col.f ? col.f(r) : null;
    let inner;
    if (col.html) inner = col.html(r);
    else if (!col.txt && raw == null) inner = `<span class="na">${col.na ? 'n/a' : '—'}</span>`;
    else inner = col.fmt ? col.fmt(raw) : esc(raw ?? '');
    let attrs = '', cls = col.cls || '';
    if (c === 'name' && !r.total && v.drill) {
      attrs = ` data-drill="${esc(r.id)}" data-name="${esc(r.name || r.id)}" title="${esc(r.name)} · click to filter and open ${esc(LEVEL[VIEWS[v.drill].level].many.toLowerCase())}"`;
      cls += ' link';
    } else if (col.txt && !col.html) attrs = ` title="${esc(raw)}"`;
    if (col.tip && r.total) attrs += ` title="${esc(col.tip)}"`;
    if (stickyLeft != null) { cls += ' sticky'; attrs += ` style="left:${stickyLeft}px"`; }
    return `<td class="${cls}"${attrs}>${inner}</td>`;
  }
  function rowHtml(r, cols) {
    const id = String(r.id);
    const sel = o.select && o.select.has(id);
    const cb = o.select ? `<td class="cb sticky" style="left:0"><input type="checkbox" class="cbx" data-sel="${esc(id)}" data-name="${esc(r.name)}" ${sel ? 'checked' : ''} aria-label="Select ${esc(r.name)}"></td>` : '';
    const mn = `<td class="mn"><button class="row-menu" data-menu="${esc(id)}" aria-label="Actions for ${esc(r.name)}" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button></td>`;
    const tds = cols.map(c => cell(c, r, c === 'name' ? (o.select ? 40 : 0) : null) + (c === 'name' ? mn : '')).join('');
    return `<tr class="${sel ? 'sel' : ''}" data-id="${esc(id)}">${cb}${tds}</tr>`;
  }

  function draw() {
    if (t.error && !t.rows.length) { tw.innerHTML = t.error; $('[data-count]', host).textContent = ''; $('[data-pager]', host).innerHTML = ''; return; }
    tw.classList.toggle('stale', t.loading && t.rows.length > 0);
    if (t.loading && !t.rows.length) { tw.innerHTML = skel(); return; }
    const cols = visibleCols(), rows = visible(), s = t.sort;
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    t.pg = Math.min(t.pg, pages - 1);
    const shown = rows.slice(t.pg * PAGE, (t.pg + 1) * PAGE);
    const tot = totals(rows);
    const allOn = o.select && shown.length && shown.every(r => o.select.has(String(r.id)));
    const someOn = o.select && shown.some(r => o.select.has(String(r.id)));
    const head = (o.select ? `<th class="cb sticky nosort" style="left:0"><input type="checkbox" class="cbx" data-all ${allOn ? 'checked' : ''} aria-label="Select all on this page"></th>` : '')
      + cols.map(c => {
        const col = COLS[c], on = s.k === c, nos = col.special;
        const th = `<th ${nos ? '' : `data-k="${c}" tabindex="0" aria-sort="${on ? (s.dir < 0 ? 'descending' : 'ascending') : 'none'}"`} class="${col.cls || ''}${on ? ' sorted' : ''}${nos ? ' nosort' : ''}${c === 'name' ? ' sticky' : ''}"${c === 'name' ? ` style="left:${o.select ? 40 : 0}px"` : ''}${col.tip ? ` title="${esc(col.tip)}"` : ''}>${col.t}${on ? `<span class="arr">${s.dir < 0 ? '↓' : '↑'}</span>` : ''}</th>`;
        return th + (c === 'name' ? '<th class="mn nosort"></th>' : '');
      }).join('');
    const body = shown.map(r => rowHtml(r, cols) + (o.view === 'deal' ? subRow(r, cols.length + 1 + (o.select ? 1 : 0), draw) : '')).join('');
    const foot = (o.select ? '<td class="cb sticky" style="left:0"></td>' : '') + cols.map(c => cell(c, tot, c === 'name' ? (o.select ? 40 : 0) : null) + (c === 'name' ? '<td class="mn"></td>' : '')).join('');
    tw.innerHTML = rows.length
      ? `<table class="t"><thead><tr>${head}</tr></thead><tbody>${body}</tbody><tfoot><tr>${foot}</tr></tfoot></table>`
      : emptyState({ title: t.q ? 'No matches' : 'No activity in this range', text: t.q ? `Nothing matches “${t.q}”.` : 'Try a wider date range or fewer filters.', sm: true });
    const hdrCb = $('[data-all]', tw);
    if (hdrCb) hdrCb.indeterminate = !allOn && someOn;
    $('[data-count]', host).textContent = `${int(rows.length)} ${rows.length === 1 ? 'row' : 'rows'}${t.q ? ' match' : ''}`;
    $('[data-pager]', host).innerHTML = rows.length > PAGE
      ? `<span>${int(t.pg * PAGE + 1)}–${int(t.pg * PAGE + shown.length)} of ${int(rows.length)}</span><span class="pg"><button class="btn sm" data-pg="-1" ${t.pg === 0 ? 'disabled' : ''}>${icon('back')}Prev</button><span>Page ${t.pg + 1} / ${pages}</span><button class="btn sm" data-pg="1" ${t.pg >= pages - 1 ? 'disabled' : ''}>Next${icon('right')}</button></span>` : '';
    o.afterDraw?.(shown, !t.hidden.has('trend'));
  }
  function skel() {
    const cols = visibleCols().slice(0, 7);
    return `<table class="t" aria-busy="true"><thead><tr>${cols.map(c => `<th class="${COLS[c].cls || ''}">${COLS[c].t}</th>`).join('')}</tr></thead><tbody>${Array.from({ length: 12 }, (_, i) =>
      `<tr>${cols.map((c, j) => `<td class="${COLS[c].cls || ''}"><span class="sk" style="display:inline-block;height:10px;width:${j ? 48 + (i * 13 + j * 7) % 40 : 160 + (i * 37) % 120}px"></span></td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function onClick(e) {
    const th = e.target.closest('th[data-k]');
    if (th) { sortBy(th.dataset.k); return; }
    if (onRonClick(e, draw)) return;
    const a = e.target.closest('[data-app]');
    if (a) { o.onApp?.(a.dataset.app, a.dataset.name); return; }
    const m = e.target.closest('[data-menu]');
    if (m) { const r = t.rows.find(x => String(x.id) === m.dataset.menu); if (r) o.onMenu?.(m, r); return; }
    const d = e.target.closest('td[data-drill]');
    if (d && !e.target.closest('input')) o.onDrill?.(d.dataset.drill, d.dataset.name);
  }
  function onChange(e) {
    if (!o.select) return;
    if (e.target.matches('[data-all]')) {
      const rows = visible().slice(t.pg * PAGE, (t.pg + 1) * PAGE).map(r => ({ id: String(r.id), name: r.name }));
      o.select.toggleAll(rows, e.target.checked); draw(); return;
    }
    const cb = e.target.closest('[data-sel]');
    if (cb) { if (!o.select.toggle({ id: cb.dataset.sel, name: cb.dataset.name }, cb.checked)) cb.checked = !cb.checked; draw(); }
  }
  function sortBy(k) {
    const s0 = t.sort;
    t.sort = { k, dir: s0.k === k ? -s0.dir : (COLS[k].txt ? 1 : -1) };
    prefs.set('sort.' + o.view, t.sort); t.pg = 0; draw();
  }
  tw.addEventListener('keydown', e => { const th = e.target.closest('th[data-k]'); if (th && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sortBy(th.dataset.k); } });

  return {
    setLoading(on) { t.loading = on; if (on) t.error = null; draw(); },
    setRows(rows, hours, oppsOk) { t.rows = rows; t.hours = hours; t.oppsOk = oppsOk; t.loading = false; t.error = null; draw(); },
    setError(html) { t.loading = false; t.error = html; draw(); },
    setNote(html) { $('[data-note]', host).innerHTML = html; },
    redraw: draw,
    focusSearch() { const i = $('[data-q]', host); i.focus(); i.select(); },
    get rows() { return t.rows; },
    ctx,
  };
}
