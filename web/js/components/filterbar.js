// Filter bar: one chip per level (AND across levels, OR within a level), a level menu, and a searchable
// multi-select popover fed by /api/options (narrowed by the other active filters).
import { $, toast } from '../ui.js';
import { icon } from '../icons.js';
import { esc, money, int } from '../format.js';
import { get, guard } from '../api.js';
import { state, LEVELS, LEVEL, MAX_VALUES, query, setFilter, clearFilters, learn, nameOf } from '../state.js';

let onChange = () => {};
const pop = { level: null, sel: new Map(), opts: null, err: '', q: '', anchor: null, hl: 0, g: guard(), timer: null };
let el = null;

export function initFilterBar(cb) {
  onChange = cb;
  $('#fbar').addEventListener('click', onBarClick);
  document.addEventListener('click', e => { if (el && !el.contains(e.target) && !e.target.closest('#fbar') && document.contains(e.target)) closePicker(); });
}

export function renderFilterBar() {
  const act = LEVELS.filter(l => state.filters[l].length);
  const label = x => esc(x.name || '#' + x.id);
  $('#fbar').innerHTML = `<span class="lbl eyebrow">${icon('filter')}Filters</span>`
    + act.map(l => {
      const v = state.filters[l];
      const vals = v.slice(0, 2).map(label).join(', ') + (v.length > 2 ? ` <b>+${v.length - 2}</b>` : '');
      const tip = `${LEVEL[l].one}: ${v.map(x => x.name || '#' + x.id).join(', ')} · click to edit`;
      return `<span class="chip" data-edit="${l}" title="${esc(tip)}" tabindex="0" role="button"><span class="k">${LEVEL[l].one}</span><span class="v">${vals}</span><button class="x" data-rm="${l}" aria-label="Remove ${esc(LEVEL[l].one)} filter">${icon('x')}</button></span>`;
    }).join('')
    + `<button class="addf" id="addf" aria-haspopup="true">${icon('plus')}Add filter</button>`
    + (act.length > 1 ? '<button class="clearf" id="clearf">Clear all</button>' : '')
    + `<span class="fhint">${act.length ? 'Levels combine with AND · values within a level with OR' : 'All traffic'}</span>`;
}

function onBarClick(e) {
  const rm = e.target.closest('[data-rm]');
  if (rm) { e.stopPropagation(); closePicker(); setFilter(rm.dataset.rm, []); onChange(); return; }
  if (e.target.closest('#clearf')) { closePicker(); clearFilters(); onChange(); return; }
  const add = e.target.closest('#addf');
  if (add) { if (el && !pop.level && pop.anchor === add) closePicker(); else openLevels(add); return; }
  const chip = e.target.closest('[data-edit]');
  if (chip && !e.target.closest('.pop')) openPicker(chip.dataset.edit, chip);
}

function mount(anchor, html) {
  closePicker(false);
  el = document.createElement('div');
  el.className = 'pop'; el.innerHTML = html;
  $('#fbar').appendChild(el);
  pop.anchor = anchor;
  const bar = $('#fbar');
  el.style.top = (anchor.offsetTop + anchor.offsetHeight + 6) + 'px';
  el.style.left = Math.max(0, Math.min(anchor.offsetLeft, bar.clientWidth - el.offsetWidth)) + 'px';
  $('#addf')?.classList.toggle('open', anchor.id === 'addf');
  el.addEventListener('click', onPopClick);
  el.addEventListener('change', onPopChange);
  el.addEventListener('input', onPopInput);
  el.addEventListener('keydown', onPopKey);
}
export function closePicker(focusBack = false) {
  if (!el) return;
  el.remove(); el = null; pop.level = null; pop.g.cancel();
  $('#addf')?.classList.remove('open');
  if (focusBack) pop.anchor?.focus();
}
export const pickerOpen = () => !!el;

export function openLevels(anchor = $('#addf')) {
  pop.level = null;
  mount(anchor, `<div class="pop-h eyebrow">Filter by</div><div class="lvls">${LEVELS.map(l =>
    `<button data-lvl="${l}">${icon(LEVEL[l].page)}<span>${LEVEL[l].one}</span>${state.filters[l].length ? `<span class="n">${state.filters[l].length}</span>` : ''}</button>`).join('')}</div>`);
  el.querySelector('button')?.focus();
}

function openPicker(l, anchor) {
  pop.level = l; pop.q = ''; pop.opts = null; pop.err = ''; pop.hl = 0;
  pop.sel = new Map(state.filters[l].map(x => [String(x.id), x.name]));
  mount(anchor, `<div class="pop-h"><button class="back" data-back aria-label="All levels">${icon('back')}</button><span class="eyebrow">${LEVEL[l].one}</span></div>
    <label class="search">${icon('search')}<input id="popq" placeholder="Search name or ID" autocomplete="off" spellcheck="false"></label>
    <div class="olist" id="olist" role="listbox" aria-multiselectable="true"></div>
    <div class="pop-f"><span class="count" id="popn"></span><button class="btn sm" data-clear>Clear</button><button class="btn sm primary" data-apply>Apply</button></div>`);
  drawList();
  $('#popq').focus();
  const my = pop.g.next();
  get('/api/options', { ...query({ noPrev: true, skip: l }), level: l })
    .then(j => {
      if (!pop.g.alive(my)) return;
      pop.opts = (j.options || []).map(o => ({ id: String(o.id), name: String(o.name ?? o.id), sub: o.sub || '', rev: o.rev, req: o.req }));
      pop.opts.forEach(o => learn(l, o.id, o.name));
      fillNames(l);
      drawList();
    })
    .catch(e => { if (pop.g.alive(my)) { pop.err = e.message; drawList(); } });
}

function items() {
  const q = pop.q.trim().toLowerCase(), opts = pop.opts || [];
  const known = new Set(opts.map(o => o.id));
  const extra = [...pop.sel].filter(([id]) => !known.has(id)).map(([id, name]) => ({ id, name: name || nameOf(pop.level, id) || '#' + id, sub: '' }));
  return [...extra, ...opts].filter(o => !q || o.name.toLowerCase().includes(q) || o.id.includes(q) || o.sub.toLowerCase().includes(q));
}
const countText = () => (pop.sel.size ? `${pop.sel.size} selected · max ${MAX_VALUES}` : 'None selected = all');
function drawList() {
  const box = $('#olist');
  if (!box) return;
  $('#popn').textContent = countText();
  if (pop.err) { box.innerHTML = `<div class="oempty">Could not load options: ${esc(pop.err)}</div>`; return; }
  const list = items();
  pop.hl = Math.min(pop.hl, Math.max(0, list.length - 1));
  box.innerHTML = list.slice(0, 200).map((o, i) => `<label class="opt${i === pop.hl ? ' hl' : ''}" role="option" aria-selected="${pop.sel.has(o.id)}" title="${esc(o.name)}${o.sub ? ' · ' + esc(o.sub) : ''}${o.req != null ? ' · ' + int(o.req) + ' bid requests' : ''}">
      <input type="checkbox" class="cbx" data-id="${esc(o.id)}" ${pop.sel.has(o.id) ? 'checked' : ''} tabindex="-1">
      <span class="on">${esc(o.name)}</span><span class="oid">#${esc(o.id)}</span><span class="ov">${o.rev == null ? '' : money(+o.rev || 0)}</span></label>`).join('')
    + (!pop.opts ? `<div style="padding:4px 8px">${'<div class="sk sk-line"></div>'.repeat(6)}</div>` : '')
    + (pop.opts && !list.length ? '<div class="oempty">No matches in this range</div>' : '')
    + (list.length > 200 ? `<div class="oempty">Showing 200 of ${int(list.length)} · refine the search</div>` : '');
}
function apply() {
  const l = pop.level;
  if (!l) return;
  setFilter(l, [...pop.sel].map(([id, name]) => ({ id, name })));
  closePicker();
  onChange();
}
function onPopClick(e) {
  e.stopPropagation();
  const lv = e.target.closest('[data-lvl]');
  if (lv) { openPicker(lv.dataset.lvl, pop.anchor); return; }
  if (e.target.closest('[data-back]')) { openLevels(pop.anchor); return; }
  if (e.target.closest('[data-clear]')) { pop.sel.clear(); drawList(); return; }
  if (e.target.closest('[data-apply]')) apply();
}
function toggle(id, on) {
  if (on) {
    if (pop.sel.size >= MAX_VALUES) { toast(`At most ${MAX_VALUES} values per filter`); return false; }
    const o = (pop.opts || []).find(x => x.id === id);
    pop.sel.set(id, o ? o.name : pop.sel.get(id) || '');
  } else pop.sel.delete(id);
  return true;
}
function onPopChange(e) {
  const cb = e.target.closest('input[data-id]'); if (!cb) return;
  if (!toggle(cb.dataset.id, cb.checked)) cb.checked = false;
  cb.closest('.opt').setAttribute('aria-selected', String(cb.checked));
  $('#popn').textContent = countText();
}
function onPopInput(e) {
  if (e.target.id !== 'popq') return;
  clearTimeout(pop.timer);
  pop.timer = setTimeout(() => { pop.q = e.target.value; pop.hl = 0; drawList(); }, 110);
}
function onPopKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closePicker(true); return; }
  if (e.target.id !== 'popq') return;
  const opts = [...el.querySelectorAll('label.opt')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    pop.hl = Math.max(0, Math.min(opts.length - 1, pop.hl + (e.key === 'ArrowDown' ? 1 : -1)));
    opts.forEach((o, i) => o.classList.toggle('hl', i === pop.hl));
    opts[pop.hl]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (e.metaKey || e.ctrlKey || !opts.length) { apply(); return; }
    const cb = opts[pop.hl]?.querySelector('input');
    if (cb && toggle(cb.dataset.id, !cb.checked)) { cb.checked = !cb.checked; cb.closest('.opt').setAttribute('aria-selected', String(cb.checked)); }
    $('#popn').textContent = pop.sel.size ? `${pop.sel.size} selected · ⌘Enter to apply` : countText();
  }
}

// fill chip names for ids that came from the URL
function fillNames(l) {
  let changed = false;
  for (const x of state.filters[l]) if (!x.name && nameOf(l, x.id)) { x.name = nameOf(l, x.id); changed = true; }
  if (changed) renderFilterBar();
}
export function resolveNames() {
  for (const l of LEVELS) {
    if (!state.filters[l].some(x => !x.name)) continue;
    get('/api/options', { ...query({ noPrev: true, skip: l }), level: l }, { quiet: true })
      .then(j => { (j.options || []).forEach(o => learn(l, String(o.id), o.name)); fillNames(l); }).catch(() => {});
  }
}
