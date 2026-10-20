// Shell: header controls, left menu (collapsible rail / phone slide-over, saved views), page head
// (title, comparison pill, freshness), and the save-view popover.
import { $, $$, toast } from '../ui.js';
import { icon } from '../icons.js';
import { esc, fmtRange, fmtDay } from '../format.js';
import { PRESETS } from '../periods.js';
import { state, prefs, isLive, hashString } from '../state.js';
import { listViews, saveView, deleteView, describeCurrent, activeView } from '../views.js';
import { currentTheme, toggleTheme, onTheme } from '../theme.js';

export const PAGE_META = {
  overview: { title: 'Overview', sec: 'Tallyline', icon: 'overview' },
  demand_partner: { title: 'Demand partners', sec: 'Demand', icon: 'demand_partner' },
  demand_source: { title: 'Demand sources', sec: 'Demand', icon: 'demand_source' },
  deal: { title: 'Deals', sec: 'Demand', icon: 'deal' },
  publisher: { title: 'Publishers', sec: 'Supply', icon: 'publisher' },
  placement: { title: 'Placements', sec: 'Supply', icon: 'placement' },
  app: { title: 'Apps', sec: 'Supply', icon: 'app' },
  anomalies: { title: 'Anomalies', sec: 'Analyze', icon: 'anomalies' },
  compare: { title: 'Compare', sec: 'Analyze', icon: 'compare' },
  heatmap: { title: 'Heatmap', sec: 'Analyze', icon: 'heatmap' },
};
const NAV = ['overview', 'Demand', 'demand_partner', 'demand_source', 'deal', 'Supply', 'publisher', 'placement', 'app', 'Analyze', 'anomalies', 'compare', 'heatmap'];
const isPhone = () => matchMedia('(max-width: 860px)').matches;
let h = {};   // handlers from main.js
let lastSum = null;

export function initShell(handlers) {
  h = handlers;
  $('#nav').innerHTML = NAV.map(k => (PAGE_META[k]
    ? `<a href="#v=${k}" data-page="${k}" data-tip="${PAGE_META[k].title}">${icon(PAGE_META[k].icon)}<span>${PAGE_META[k].title}</span><b class="nav-n" data-navn="${k}" hidden></b></a>`
    : `<div class="nav-sec eyebrow">${k}</div>`)).join('')
    + '<div class="nav-sec eyebrow">Saved views</div><div class="nav-views" id="navViews"></div>'
    + `<button class="nav-toggle" id="railBtn" title="Collapse menu ([)">${icon('sidebar')}<span>Collapse</span></button>`
    + `<div class="nav-foot"><div><span>Command search</span><kbd>⌘K</kbd></div><div><span>Filter · Alerts · Reload</span><span><kbd>f</kbd> <kbd>a</kbd> <kbd>r</kbd></span></div><div><span>Synthetic data · UTC</span></div></div>`;
  $('#menuBtn').innerHTML = icon('menu');
  $('#refreshBtn').innerHTML = icon('refresh');
  $('#bellBtn').innerHTML = icon('bell') + '<span class="badge" id="bellBadge" hidden></span>';
  $('#cmdkBtn').innerHTML = `${icon('search')}<span>Search</span><kbd>⌘K</kbd>`;
  $('#cmdkIcon').innerHTML = icon('search');
  $('#saveBtn').innerHTML = icon('bookmark');
  $('#reportLink').innerHTML = `${icon('report')}<span>Report</span>`;
  paintTheme();
  onTheme(paintTheme);
  $('#presets').innerHTML = PRESETS.map(([k, l]) => `<button data-p="${k}"${k === 'mtd' ? ' title="Month to date"' : ''}>${l}</button>`).join('');
  setRail(prefs.get('rail', false, v => typeof v === 'boolean'), false);
  renderViews();
  wire();
}
function paintTheme() {
  const dark = currentTheme() === 'dark';
  $('#themeBtn').innerHTML = icon(dark ? 'sun' : 'moon');
  $('#themeBtn').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  $('#themeBtn').title = dark ? 'Light theme' : 'Dark theme';
}

function wire() {
  $('#nav').addEventListener('click', e => {
    if (e.target.closest('#railBtn')) { toggleMenu(); return; }
    const del = e.target.closest('[data-vdel]');
    if (del) { e.preventDefault(); e.stopPropagation(); deleteView(del.dataset.vdel); renderViews(); toast('Saved view removed'); return; }
    const a = e.target.closest('a[data-page]');
    if (a && !(e.metaKey || e.ctrlKey || e.shiftKey)) { e.preventDefault(); closeNav(); h.go(a.dataset.page); return; }
    const v = e.target.closest('a[data-view]');
    if (v && !(e.metaKey || e.ctrlKey || e.shiftKey)) { e.preventDefault(); closeNav(); h.openHash(v.getAttribute('href')); }
  });
  $('#menuBtn').addEventListener('click', toggleMenu);
  $('#navScrim').addEventListener('click', closeNav);
  $('#presets').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.p === 'custom') { e.stopPropagation(); toggleCustom(b); } else { closeCustom(); h.preset(b.dataset.p); }
  });
  $('#cApply').addEventListener('click', applyCustom);
  $('#custom').addEventListener('keydown', e => { if (e.key === 'Enter') applyCustom(); if (e.key === 'Escape') { e.stopPropagation(); closeCustom(); } });
  ['#cStart', '#cEnd'].forEach(s => $(s).addEventListener('input', customHint));
  document.addEventListener('click', e => {
    if (!e.target.closest('#custom')) closeCustom();
    if (!e.target.closest('#savePop') && !e.target.closest('#saveBtn')) closeSave();
  });
  $('#refreshBtn').addEventListener('click', () => h.reload());
  $('#cmdkBtn').addEventListener('click', () => h.cmdk());
  $('#cmdkIcon').addEventListener('click', () => h.cmdk());
  $('#bellBtn').addEventListener('click', e => { e.stopPropagation(); h.alerts(); });
  $('#themeBtn').addEventListener('click', () => toggleTheme());
  $('#saveBtn').addEventListener('click', e => { e.stopPropagation(); openSave(); });
  $('#savePop').addEventListener('keydown', e => { if (e.key === 'Enter') doSave(); if (e.key === 'Escape') { e.stopPropagation(); closeSave(); } });
  $('#sSave').addEventListener('click', doSave);
  // keep the menu below the (possibly wrapped) header
  new ResizeObserver(() => document.documentElement.style.setProperty('--hdr-h', $('#hdr').offsetHeight + 'px')).observe($('#hdr'));
}

// ---------- custom range popover ----------
function toggleCustom(btn) {
  const el = $('#custom');
  if (!el.hidden) { closeCustom(); return; }
  $('#cStart').value = state.start; $('#cEnd').value = state.end;
  el.hidden = false;
  place(el, btn);
  customHint();
  $('#cStart').focus();
}
function place(el, btn) {
  const hr = $('#hdr').getBoundingClientRect(), br = btn.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(br.left - hr.left, hr.width - el.offsetWidth - 8)) + 'px';
  el.style.top = (br.bottom - hr.top + 6) + 'px';
}
export function closeCustom() { $('#custom').hidden = true; }
function customHint() {
  const a = $('#cStart').value, b = $('#cEnd').value;
  const n = a && b ? Math.abs(Math.round((Date.parse(b) - Date.parse(a)) / 864e5)) + 1 : 0;
  $('#cHint').textContent = n ? (n > 31 ? `${n} days · trimmed to 31` : `${n} day${n > 1 ? 's' : ''}`) : '';
}
function applyCustom() {
  if (!$('#cStart').value || !$('#cEnd').value) return;
  closeCustom(); h.custom($('#cStart').value, $('#cEnd').value);
}

// ---------- save view popover ----------
function openSave() {
  const el = $('#savePop');
  if (!el.hidden) { closeSave(); return; }
  $('#sName').value = activeView()?.name || `${PAGE_META[state.page].title} · ${describeCurrent().split(' · ')[0]}`;
  $('#sDesc').textContent = describeCurrent();
  el.hidden = false;
  place(el, $('#saveBtn'));
  $('#sName').select();
}
export function closeSave() { $('#savePop').hidden = true; }
function doSave() {
  const v = saveView($('#sName').value);
  closeSave(); renderViews();
  toast(`Saved “${v.name}”. It's in the menu and in ⌘K.`);
}
export function renderViews() {
  const views = listViews(), cur = location.hash;
  $('#navViews').innerHTML = views.length
    ? views.map(v => `<a href="${esc(v.hash)}" data-view="${esc(v.id)}" data-tip="${esc(v.name)}" title="${esc(v.desc || '')}"${v.hash === cur ? ' aria-current="true"' : ''}>${icon('bookmark')}<span>${esc(v.name)}</span><button class="vdel" data-vdel="${esc(v.id)}" aria-label="Delete saved view ${esc(v.name)}">${icon('x')}</button></a>`).join('')
    : '<p class="nav-empty">Save the current page, range and filters with the bookmark button. Views stay in this browser.</p>';
}

// ---------- menu: rail on desktop, slide-over on phones ----------
function setRail(on, save = true) {
  document.body.classList.toggle('rail', on);
  $('#menuBtn').setAttribute('aria-expanded', String(!on));
  const rb = $('#railBtn');
  if (rb) { rb.title = on ? 'Expand menu ([)' : 'Collapse menu ([)'; rb.querySelector('span').textContent = on ? 'Expand' : 'Collapse'; }
  if (save) prefs.set('rail', on);
}
function closeNav() { document.body.classList.remove('nav-open'); if (isPhone()) $('#menuBtn').setAttribute('aria-expanded', 'false'); }
export function toggleMenu() {
  if (isPhone()) {
    const open = !document.body.classList.contains('nav-open');
    document.body.classList.toggle('nav-open', open);
    $('#menuBtn').setAttribute('aria-expanded', String(open));
    if (open) $('#nav a[aria-current="page"]')?.focus();
    return;
  }
  setRail(!document.body.classList.contains('rail'));
}
export const navOpen = () => document.body.classList.contains('nav-open');
export { closeNav };

// ---------- sync with state ----------
export function syncShell() {
  $$('#nav a[data-page]').forEach(a => {
    if (a.dataset.page === state.page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  $$('#presets button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === state.preset)));
  const cb = $('#presets [data-p="custom"]');
  cb.textContent = state.preset === 'custom' ? fmtRange(state.start, state.end) : 'Custom';
  cb.title = 'Custom range (max 31 days)';
  $('#reportLink').href = '/report.html' + hashString();
  document.title = `${PAGE_META[state.page].title} · Tallyline`;
  renderViews();
  renderHead();
}

function renderHead() {
  const meta = PAGE_META[state.page];
  const s = lastSum === 'err' ? 'err' : lastSum && lastSum.start === state.start && lastSum.end === state.end ? lastSum : null;
  const cut = s !== 'err' && s?.cmp?.completedOnly && s.cmp.curTo ? ` <span class="sep">·</span> Δ to ${esc(s.cmp.curTo.slice(11, 13))}:00` : '';
  const title = 'Comparison window: ' + fmtRange(state.pstart, state.pend)
    + (cut ? '. While the range is still running, every Δ compares completed hours only (the live hour is left out on both sides).' : '');
  const v = activeView();
  $('#pagehead').innerHTML = `<div><div class="eyebrow">${esc(meta.sec)}${v ? ` <span class="sep">/</span> ${icon('bookmark')}${esc(v.name)}` : ''}</div><h1>${esc(meta.title)}</h1>
      <div class="ph-sub">${esc(fmtRange(state.start, state.end))} · UTC</div></div>
    <div class="ph-meta"><span class="cmp-pill" title="${esc(title)}"><b>${esc(fmtRange(state.start, state.end))}</b> ${esc(state.cmp)}${cut}</span>${freshHtml(s)}</div>`;
}
function freshHtml(s) {
  if (s === 'err') return '<span class="fresh err"><span class="dot"></span>Could not reach the API</span>';
  const k = s?.latestUtc;
  if (!k || !/^\d{4}-\d{2}-\d{2} \d{2}$/.test(k)) return '<span class="fresh"><span class="dot"></span>Checking data…</span>';
  return `<span class="fresh${isLive() ? ' live' : ''}" title="The newest hour (${esc(k)}:00 UTC) is still filling in; it is projected on charts and left out of every Δ."><span class="dot"></span>Live · ${fmtDay(k.slice(0, 10))} ${k.slice(11, 13)}:00 UTC</span>`;
}
export function setSummaryMeta(s) { lastSum = s; renderHead(); }
export function setRefreshing(on) { $('#refreshBtn').classList.toggle('spin', on); }
export function setBell(count) {
  const b = $('#bellBadge');
  if (!b) return;
  if (count == null) { b.hidden = true; return; }
  b.hidden = false; b.textContent = count > 9 ? '9+' : String(count);
  b.classList.toggle('zero', count === 0);
  $('#bellBtn').title = count ? `${count} item${count > 1 ? 's' : ''} need attention (a)` : 'Nothing needs attention (a)';
}
// a small count next to a menu item (anomalies)
export function setNavCount(page, n) {
  const el = $(`[data-navn="${page}"]`);
  if (!el) return;
  el.hidden = !n; el.textContent = n > 99 ? '99+' : String(n || '');
}
