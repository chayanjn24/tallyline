// Small shared UI helpers: DOM lookup, empty / error / loading states, toasts, floating menus.
import { esc } from './format.js';
import { icon } from './icons.js';

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function emptyState({ title = 'Nothing here', text = '', actions = '', ico = 'empty', sm = false } = {}) {
  return `<div class="state${sm ? ' sm' : ''}"><div class="ico">${icon(ico)}</div><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${actions ? `<div class="acts">${actions}</div>` : ''}</div>`;
}
export function errorState(msg, { retry = true, sm = false } = {}) {
  return `<div class="state err${sm ? ' sm' : ''}" role="alert"><div class="ico">${icon('alert')}</div><h3>Could not load this view</h3><p>${esc(msg)}</p>`
    + (retry ? '<div class="acts"><button class="btn" data-act="retry">Retry</button></div>' : '') + '</div>';
}
export const skLines = (n, w = [92, 78, 86, 64]) => Array.from({ length: n }, (_, i) => `<div class="sk sk-line" style="width:${w[i % w.length]}%"></div>`).join('');
export function skTable(rows = 12) {
  const row = () => `<div class="sk-row">${Array.from({ length: 7 }, (_, i) => `<div class="sk sk-line" style="width:${i ? 60 + (i * 7) % 30 : 70}%"></div>`).join('')}</div>`;
  return `<div class="tw" aria-busy="true"><div class="sk-row" style="height:36px"></div>${Array.from({ length: rows }, row).join('')}</div>`;
}

// ---------- toasts ----------
export function toast(msg, ms = 2600) {
  const box = $('#toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, ms);
}

// ---------- floating menu (row ⋯ menus) ----------
let openMenu = null;
export function closeMenu() {
  if (!openMenu) return;
  openMenu.anchor?.setAttribute('aria-expanded', 'false');
  openMenu.el.remove(); openMenu = null;
}
// items: [{ label, icon, run, href }] or 'sep'
export function showMenu(anchor, items, title = '') {
  closeMenu();
  const el = document.createElement('div');
  el.className = 'menu'; el.setAttribute('role', 'menu');
  el.innerHTML = (title ? `<div class="menu-h eyebrow">${esc(title)}</div>` : '') + items.map((it, i) => (it === 'sep' ? '<hr>'
    : it.href ? `<a role="menuitem" href="${esc(it.href)}" target="_blank" rel="noopener" data-i="${i}">${icon(it.icon || 'right')}${esc(it.label)}</a>`
      : `<button role="menuitem" data-i="${i}">${icon(it.icon || 'right')}${esc(it.label)}</button>`)).join('');
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect(), mw = el.offsetWidth, mh = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(r.right - mw, innerWidth - mw - 8)) + 'px';
  el.style.top = (r.bottom + mh + 8 > innerHeight ? Math.max(8, r.top - mh - 4) : r.bottom + 4) + 'px';
  anchor.setAttribute('aria-expanded', 'true');
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-i]'); if (!b) return;
    const it = items[+b.dataset.i];
    closeMenu();
    if (it.run) { e.preventDefault(); it.run(); }
  });
  el.addEventListener('keydown', e => {
    const all = $$('[role=menuitem]', el), i = all.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus(); }
    if (e.key === 'Escape') { closeMenu(); anchor.focus(); }
  });
  openMenu = { el, anchor };
  el.querySelector('[role=menuitem]')?.focus({ preventScroll: true });
}
document.addEventListener('click', e => { if (openMenu && !openMenu.el.contains(e.target) && !openMenu.anchor.contains(e.target)) closeMenu(); });
addEventListener('scroll', closeMenu, { passive: true, capture: true });
addEventListener('resize', closeMenu);

// animate a number-bearing element from its previous value (hero KPIs)
export function tweenText(el, to, fmt, ms = 240) {
  const from = +el.dataset.v;
  el.dataset.v = to;
  if (reduced() || !Number.isFinite(from) || !Number.isFinite(to) || from === to) { el.innerHTML = fmt(to); return; }
  const t0 = performance.now();
  const step = t => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.innerHTML = fmt(from + (to - from) * e);
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
