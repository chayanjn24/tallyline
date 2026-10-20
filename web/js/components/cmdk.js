// ⌘K / Ctrl+K command search: pages, actions, saved views and entities of every level (from
// /api/options, loaded lazily and cached per range). Enter = open scoped, ⇧Enter = add as filter,
// ⌥Enter = compare. Remembers recent picks.
import { $ } from '../ui.js';
import { icon } from '../icons.js';
import { esc, money } from '../format.js';
import { get } from '../api.js';
import { state, LEVELS, LEVEL, prefs, filterCount, learn } from '../state.js';
import { PRESETS } from '../periods.js';
import { listViews } from '../views.js';
import { currentTheme, toggleTheme } from '../theme.js';
import { PAGE_META } from './shell.js';

let app = null, dlg = null, hl = 0, shown = [], entities = new Map(), loadingKey = '';
const rangeKey = () => `${state.start}|${state.end}`;
const validRecent = a => Array.isArray(a) && a.every(x => x && LEVELS.includes(x.level) && typeof x.id === 'string' && typeof x.name === 'string');

export function initCmdk(a) {
  app = a; dlg = $('#cmdk');
  dlg.innerHTML = `<div class="ck-in">${icon('search')}<input data-ckq placeholder="Search pages, saved views, actions and names…" aria-label="Command search" autocomplete="off" spellcheck="false"><kbd>esc</kbd></div>
    <div class="ck-list" data-ckl role="listbox"></div>
    <div class="ck-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>⇧</kbd><kbd>↵</kbd> add filter</span><span><kbd>⌥</kbd><kbd>↵</kbd> compare</span></div>`;
  const input = $('[data-ckq]', dlg);
  input.addEventListener('input', () => { hl = 0; draw(); });
  input.addEventListener('keydown', onKey);
  $('[data-ckl]', dlg).addEventListener('click', e => { const it = e.target.closest('[data-i]'); if (it) run(shown[+it.dataset.i], e); });
  $('[data-ckl]', dlg).addEventListener('mousemove', e => { const it = e.target.closest('[data-i]'); if (it && +it.dataset.i !== hl) { hl = +it.dataset.i; paintHl(); } });
  dlg.addEventListener('click', e => { if (e.target === dlg) closeCmdk(); });   // backdrop
  dlg.addEventListener('cancel', e => { e.preventDefault(); closeCmdk(); });
}
export const cmdkOpen = () => dlg?.open;
export function openCmdk() {
  if (dlg.open) return;
  dlg.showModal();
  const input = $('[data-ckq]', dlg);
  input.value = ''; hl = 0;
  loadEntities(); draw();
  input.focus();
}
export function closeCmdk() { if (dlg?.open) dlg.close(); }

function loadEntities() {
  const key = rangeKey();
  if (loadingKey === key) return;
  loadingKey = key; entities = new Map();
  LEVELS.forEach(l => get('/api/options', { start: state.start, end: state.end, level: l }, { quiet: true })
    .then(j => { if (loadingKey !== key) return; entities.set(l, (j.options || []).map(o => ({ level: l, id: String(o.id), name: String(o.name ?? o.id), sub: o.sub || '', rev: o.rev }))); if (dlg.open) draw(); })
    .catch(() => {}));
}

function commands() {
  const pages = Object.entries(PAGE_META).map(([k, m]) => ({ kind: 'page', label: m.title, sub: m.sec, icon: m.icon, hint: 'page', run: () => app.go(k) }));
  const views = listViews().map(v => ({ kind: 'view', label: v.name, sub: v.desc, icon: 'bookmark', hint: 'saved view', run: () => app.openHash(v.hash) }));
  const acts = [
    ...PRESETS.filter(([k]) => k !== 'custom').map(([k, l]) => ({ kind: 'act', label: `Range: ${l === 'MTD' ? 'Month to date' : l}`, icon: 'calendar', hint: state.preset === k ? 'current' : '', run: () => app.preset(k) })),
    { kind: 'act', label: 'Range: Custom…', icon: 'calendar', run: () => setTimeout(() => $('#presets [data-p="custom"]').click(), 0) },
    { kind: 'act', label: 'Range: Last 14 days', icon: 'calendar', run: () => app.last14() },
    { kind: 'act', label: 'Save this view…', icon: 'bookmark', run: () => setTimeout(() => $('#saveBtn').click(), 0) },
    { kind: 'act', label: 'Open the printable report', icon: 'report', run: () => window.open($('#reportLink').href, '_blank', 'noopener') },
    { kind: 'act', label: currentTheme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', icon: currentTheme() === 'dark' ? 'sun' : 'moon', run: () => toggleTheme() },
    { kind: 'act', label: document.body.classList.contains('rail') ? 'Expand menu' : 'Collapse menu', icon: 'sidebar', hint: '[', run: () => app.toggleMenu() },
    { kind: 'act', label: 'Add filter…', icon: 'filter', hint: 'f', run: () => app.openFilter() },
    { kind: 'act', label: 'Open alerts', icon: 'bell', hint: 'a', run: () => app.alerts() },
    { kind: 'act', label: 'Reload data', icon: 'refresh', hint: 'r', run: () => app.reload(true) },
  ];
  if (filterCount()) acts.push({ kind: 'act', label: 'Clear all filters', icon: 'x', run: () => app.clearFilters() });
  return [...pages, ...views, ...acts];
}
const GROUP = { page: 'Pages', view: 'Saved views', act: 'Actions' };
// every token must appear; prefix matches rank first
function score(text, toks) {
  const t = text.toLowerCase();
  let s = 0;
  for (const k of toks) { const i = t.indexOf(k); if (i < 0) return -1; s += i === 0 ? 3 : /[\s\-_.·]/.test(t[i - 1]) ? 2 : 1; }
  return s;
}
function results(q) {
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) {
    const recent = prefs.get('recent', [], validRecent).map(r => ({ ...r, kind: 'ent', grp: 'Recent' }));
    return [...recent, ...commands().map(c => ({ ...c, grp: GROUP[c.kind] }))];
  }
  const cmds = commands().map(c => ({ ...c, s: score(c.label + ' ' + (c.sub || ''), toks) })).filter(c => c.s >= 0).sort((a, b) => b.s - a.s)
    .map(c => ({ ...c, grp: GROUP[c.kind] }));
  const ents = [];
  for (const l of LEVELS) {
    const list = entities.get(l);
    if (!list) continue;
    const hits = [];
    for (const e of list) { const s = score(`${e.name} ${e.id} ${e.sub}`, toks); if (s >= 0) hits.push({ ...e, kind: 'ent', grp: LEVEL[l].many, s }); if (hits.length > 60) break; }
    ents.push(...hits.sort((a, b) => b.s - a.s).slice(0, 6));
  }
  return [...cmds.slice(0, 8), ...ents];
}

function draw() {
  const q = $('[data-ckq]', dlg).value;
  shown = results(q);
  hl = Math.min(hl, Math.max(0, shown.length - 1));
  const loading = LEVELS.some(l => !entities.has(l));
  let grp = '', html = '';
  shown.forEach((it, i) => {
    if (it.grp !== grp) { grp = it.grp; html += `<div class="ck-grp eyebrow">${esc(grp)}</div>`; }
    const ic = it.kind === 'ent' ? LEVEL[it.level].page : it.icon;
    const meta = it.kind === 'ent' ? `<small>${esc(LEVEL[it.level].one)} #${esc(it.id)}</small>` : it.sub ? `<small>${esc(it.sub)}</small>` : '';
    const hint = it.kind === 'ent' ? (it.rev != null ? money(it.rev) : '') : it.hint || '';
    html += `<div class="ck-it${i === hl ? ' hl' : ''}" role="option" aria-selected="${i === hl}" data-i="${i}">${icon(ic)}<span class="lbl">${esc(it.name || it.label)}${meta}</span><span class="hint">${esc(hint)}</span></div>`;
  });
  if (!shown.length) html = `<div class="ck-empty">${loading ? 'Loading names…' : `No results for “${esc(q)}”.`}</div>`;
  else if (q.trim() && loading) html += '<div class="ck-grp eyebrow">Loading more names…</div>';
  $('[data-ckl]', dlg).innerHTML = html;
}
function paintHl() {
  dlg.querySelectorAll('.ck-it').forEach(el => { const on = +el.dataset.i === hl; el.classList.toggle('hl', on); el.setAttribute('aria-selected', String(on)); });
  dlg.querySelector('.ck-it.hl')?.scrollIntoView({ block: 'nearest' });
}
function onKey(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hl = (hl + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % Math.max(1, shown.length); paintHl(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (shown[hl]) run(shown[hl], e); }
  else if (e.key === 'Escape') { e.preventDefault(); closeCmdk(); }
}
function run(it, e) {
  closeCmdk();
  if (it.kind !== 'ent') { it.run(); return; }
  const r = { level: it.level, id: it.id, name: it.name };
  learn(it.level, it.id, it.name);
  prefs.set('recent', [r, ...prefs.get('recent', [], validRecent).filter(x => !(x.level === r.level && x.id === r.id))].slice(0, 6));
  if (e.altKey) app.compare(it.level, it.id);
  else if (e.shiftKey) app.addFilter(it.level, it.id, it.name);
  else app.openEntity(it.level, it.id, it.name);
}
