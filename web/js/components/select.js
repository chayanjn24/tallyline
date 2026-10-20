// Searchable single-select (Compare pickers). Options load lazily on first open.
import { $ } from '../ui.js';
import { icon } from '../icons.js';
import { esc, money } from '../format.js';

export function createSelect(host, o) {
  let opts = null, err = '', q = '', hl = 0, open = false, value = o.value || null, label = o.label || '';
  host.classList.add('sel-box');
  host.innerHTML = `<button class="sel-btn" aria-haspopup="listbox" aria-expanded="false"><span class="tag ${o.tag.toLowerCase()}">${o.tag}</span><span class="nm"></span>${icon('chev')}</button>`;
  const btn = $('.sel-btn', host);
  const paint = () => { const nm = $('.nm', btn); nm.textContent = value ? (label || '#' + value) : o.placeholder; nm.classList.toggle('ph', !value); nm.title = label || value || ''; };
  paint();

  function list() {
    const s = q.trim().toLowerCase();
    return (opts || []).filter(x => !s || x.name.toLowerCase().includes(s) || x.id.includes(s) || (x.sub || '').toLowerCase().includes(s)).slice(0, 200);
  }
  function draw() {
    const box = $('[data-ol]', host);
    if (!box) return;
    if (err) { box.innerHTML = `<div class="oempty">Could not load: ${esc(err)}</div>`; return; }
    if (!opts) { box.innerHTML = `<div style="padding:4px 8px">${'<div class="sk sk-line"></div>'.repeat(5)}</div>`; return; }
    const L = list();
    hl = Math.min(hl, Math.max(0, L.length - 1));
    box.innerHTML = L.length ? L.map((x, i) => `<div class="opt${i === hl ? ' hl' : ''}${x.id === value ? ' sel' : ''}" role="option" aria-selected="${x.id === value}" data-id="${esc(x.id)}" data-name="${esc(x.name)}">
      <span class="on">${esc(x.name)}</span><span class="oid">#${esc(x.id)}</span><span class="ov">${money(x.rev)}</span></div>`).join('') : '<div class="oempty">No matches</div>';
  }
  function show() {
    if (open) return;
    open = true; q = ''; hl = 0;
    btn.setAttribute('aria-expanded', 'true');
    const p = document.createElement('div');
    p.className = 'pop'; p.dataset.pop = '';
    p.innerHTML = `<div style="padding:12px 12px 8px"><label class="search">${icon('search')}<input data-q placeholder="Search ${esc(o.what)}" autocomplete="off" spellcheck="false"></label></div><div class="olist" data-ol role="listbox"></div>`;
    host.appendChild(p);
    draw();
    $('[data-q]', p).focus();
    if (!opts) o.load().then(r => { opts = r; draw(); }).catch(e => { err = e.message; draw(); });
    p.addEventListener('input', e => { q = e.target.value; hl = 0; draw(); });
    p.addEventListener('keydown', onKey);
    p.addEventListener('click', e => { const it = e.target.closest('[data-id]'); if (it) pick(it.dataset.id, it.dataset.name); });
  }
  function hide(focus) {
    if (!open) return;
    open = false; btn.setAttribute('aria-expanded', 'false');
    host.querySelector('[data-pop]')?.remove();
    if (focus) btn.focus();
  }
  function pick(id, name) { value = id; label = name; paint(); hide(true); o.onPick(id, name); }
  function onKey(e) {
    const items = [...host.querySelectorAll('[data-id]')];
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(true); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      hl = Math.max(0, Math.min(items.length - 1, hl + (e.key === 'ArrowDown' ? 1 : -1)));
      items.forEach((x, i) => x.classList.toggle('hl', i === hl)); items[hl]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[hl]) pick(items[hl].dataset.id, items[hl].dataset.name);
    }
  }
  btn.addEventListener('click', () => (open ? hide() : show()));
  const outside = e => { if (open && !host.contains(e.target)) hide(); };
  document.addEventListener('click', outside);
  return {
    set(id, name) { value = id; label = name || ''; paint(); },
    destroy() { document.removeEventListener('click', outside); },
    get value() { return value; },
  };
}
