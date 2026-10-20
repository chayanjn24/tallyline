// Column picker popover (floating, fixed-positioned).
import { esc } from '../format.js';
import { COLS, GROUPS, HIDDEN_DEFAULT } from './columns.js';

let el = null;
export function closeColumnPicker() { if (el) { el.remove(); el = null; } }
export function openColumnPicker(anchor, cols, hidden, onChange) {
  if (el) { closeColumnPicker(); return; }
  el = document.createElement('div');
  el.className = 'menu colpick';
  const inGroup = new Set(GROUPS.flatMap(g => g[1]));
  const box = c => `<label><input type="checkbox" class="cbx" data-c="${c}" ${hidden.has(c) ? '' : 'checked'}>${esc(COLS[c].t)}</label>`;
  const main = cols.filter(c => !inGroup.has(c));
  el.innerHTML = `<div class="grp eyebrow">Columns</div>${main.map(box).join('')}`
    + GROUPS.map(([g, cs]) => { const own = cs.filter(c => cols.includes(c)); return own.length ? `<div class="grp eyebrow">${esc(g)}</div>${own.map(box).join('')}` : ''; }).join('')
    + `<div class="grp"><button class="btn sm" data-reset>Show defaults</button></div>`;
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const below = innerHeight - r.bottom - 14;
  if (below >= 220) { el.style.top = (r.bottom + 6) + 'px'; el.style.maxHeight = below + 'px'; }
  else { el.style.maxHeight = Math.max(220, r.top - 14) + 'px'; el.style.top = Math.max(8, r.top - el.offsetHeight - 6) + 'px'; }
  el.style.left = Math.max(8, Math.min(r.right - el.offsetWidth, innerWidth - el.offsetWidth - 8)) + 'px';
  el.addEventListener('change', e => {
    const c = e.target.dataset.c; if (!c) return;
    if (e.target.checked) hidden.delete(c); else hidden.add(c);
    onChange();
  });
  el.addEventListener('click', e => {
    if (!e.target.closest('[data-reset]')) return;
    hidden.clear(); HIDDEN_DEFAULT.filter(c => cols.includes(c)).forEach(c => hidden.add(c));
    el.querySelectorAll('[data-c]').forEach(i => { i.checked = !hidden.has(i.dataset.c); });
    onChange();
  });
  setTimeout(() => document.addEventListener('click', outside), 0);
}
function outside(e) {
  if (el && !el.contains(e.target)) { closeColumnPicker(); document.removeEventListener('click', outside); }
  if (!el) document.removeEventListener('click', outside);
}
addEventListener('keydown', e => { if (e.key === 'Escape') closeColumnPicker(); });
