// Apps: the entity table plus row checkboxes and a sticky selection bar.
// Apps already in the filter start checked; at most MAX_VALUES can be selected.
import { $, toast } from '../ui.js';
import { icon } from '../icons.js';
import { int } from '../format.js';
import { state, setFilter, MAX_VALUES } from '../state.js';
import { entityPage } from './entity.js';

const sel = new Map();   // id → name
let filterKey = null, app = null, host = null, limitHit = false;

const filterIds = () => state.filters.app.map(x => x.id);
function syncFromFilter() {
  const k = filterIds().join(',');
  if (k === filterKey) return;
  filterKey = k; sel.clear(); state.filters.app.forEach(x => sel.set(x.id, x.name));
}

const select = {
  has: id => { syncFromFilter(); return sel.has(id); },
  toggle(r, on) {
    if (on && !sel.has(r.id) && sel.size >= MAX_VALUES) { hitLimit(); return false; }
    if (on) sel.set(r.id, r.name); else sel.delete(r.id);
    limitHit = false; bar(); return true;
  },
  toggleAll(rows, on) {
    if (!on) { rows.forEach(r => sel.delete(r.id)); limitHit = false; bar(); return; }
    for (const r of rows) { if (sel.has(r.id)) continue; if (sel.size >= MAX_VALUES) { hitLimit(); break; } sel.set(r.id, r.name); }
    bar();
  },
};
function hitLimit() { limitHit = true; toast(`At most ${MAX_VALUES} apps can be selected`); bar(); }

function bar() {
  const el = host && $('[data-selbar]', host);
  if (!el) return;
  const n = sel.size, same = n === filterIds().length && filterIds().every(id => sel.has(id));
  el.hidden = n === 0;
  if (!n) return;
  el.innerHTML = `<span class="n">${int(n)} selected</span>${limitHit || n >= MAX_VALUES ? `<span class="lim">max ${MAX_VALUES}</span>` : ''}
    <button class="btn primary sm" data-sa="apply" ${same ? 'disabled title="Already the filter"' : ''}>${icon('filter')}Apply as filter</button>
    <button class="btn sm" data-sa="add" ${same ? 'disabled' : ''}>${icon('plus')}Add to filter</button>
    ${n === 2 ? `<button class="btn sm" data-sa="compare">${icon('compare')}Compare</button>` : ''}
    <button class="btn sm ghost" data-sa="clear">Clear</button>`;
}
function onBar(e) {
  const b = e.target.closest('[data-sa]'); if (!b) return;
  const a = b.dataset.sa;
  if (a === 'clear') { sel.clear(); limitHit = false; bar(); page.table?.redraw(); return; }
  if (a === 'compare') { const [x, y] = [...sel.keys()]; app.compare('app', x, y); return; }
  let picked = [...sel].map(([id, name]) => ({ id, name }));
  if (a === 'add') picked = [...new Map([...state.filters.app, ...picked].map(x => [x.id, x])).values()];
  if (picked.length > MAX_VALUES) { toast(`A filter holds at most ${MAX_VALUES} apps; kept the first ${MAX_VALUES}`); picked = picked.slice(0, MAX_VALUES); }
  setFilter('app', picked);
  app.filtersChanged();
}

const page = entityPage('app', {
  select,
  mountExtra: () => '<div class="selbar" data-selbar hidden role="region" aria-label="Selected apps"></div>',
  onMount(h, a) { host = h; app = a; filterKey = null; syncFromFilter(); $('[data-selbar]', h).addEventListener('click', onBar); bar(); },
  onRows() { syncFromFilter(); bar(); },
  onUnmount() { host = null; },
});
export const appsPage = page;
