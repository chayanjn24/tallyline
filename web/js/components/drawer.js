// Bell drawer: the biggest anomalies in the current range and scope, plus deals that receive bid
// requests but never bid. Clicking an item filters to it.
import { $ } from '../ui.js';
import { icon } from '../icons.js';
import { esc, money, short, pct } from '../format.js';
import { get } from '../api.js';
import { query, filterCount, LEVEL } from '../state.js';
import { setBell, setNavCount } from './shell.js';

let app = null, items = [], lastFocus = null;
const drawer = () => $('#drawer');
export const drawerOpen = () => drawer().classList.contains('open');

export function initDrawer(a) {
  app = a;
  drawer().innerHTML = `<div class="d-head">${icon('bell')}<div><h2>Alerts</h2><div class="eyebrow" data-dscope style="margin-top:6px">All traffic</div></div>
      <button class="icon-btn" data-close aria-label="Close alerts (Esc)">${icon('x')}</button></div>
    <div class="d-body">
      <div class="d-sec"><h3>Anomalies<span class="eyebrow">largest first</span></h3><ul class="alerts" data-alerts><li class="quiet">Loading…</li></ul>
        <button class="btn sm ghost d-more" data-allanom>${icon('anomalies')}All anomalies, with causes ${icon('right')}</button></div>
      <div class="d-sec"><h3>Zero-bid deals<span class="eyebrow">requests, no bids</span></h3><div data-zb><div class="quiet">Loading…</div></div></div>
    </div>`;
  $('[data-close]', drawer()).addEventListener('click', closeDrawer);
  $('#drawerScrim').addEventListener('click', closeDrawer);
  drawer().addEventListener('click', onClick);
  drawer().addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('[data-a],[data-deal]')) onClick(e); });
}
export function openDrawer() {
  lastFocus = document.activeElement;
  drawer().classList.add('open'); $('#drawerScrim').classList.add('open');
  drawer().setAttribute('aria-hidden', 'false'); $('#bellBtn').setAttribute('aria-expanded', 'true');
  setTimeout(() => $('[data-close]', drawer())?.focus(), 30);
}
export function closeDrawer() {
  if (!drawerOpen()) return;
  drawer().classList.remove('open'); $('#drawerScrim').classList.remove('open');
  drawer().setAttribute('aria-hidden', 'true'); $('#bellBtn').setAttribute('aria-expanded', 'false');
  lastFocus?.focus?.();
}
export const toggleDrawer = () => (drawerOpen() ? closeDrawer() : openDrawer());

function onClick(e) {
  if (e.target.closest('[data-allanom]')) { closeDrawer(); app.go('anomalies'); return; }
  const li = e.target.closest('[data-a]');
  if (li) { const a = items[+li.dataset.a]; if (a) { closeDrawer(); app.filterAndGo(a.level, [{ id: String(a.entityId), name: a.name }], 'anomalies'); } return; }
  const z = e.target.closest('[data-deal]');
  if (z) { closeDrawer(); app.scope('deal', z.dataset.deal, z.dataset.name); }
}

// loads after the page's own data, quietly (no progress bar)
export async function loadAlerts(c) {
  setBell(null);
  const my = c.seq;
  $('[data-dscope]', drawer()).textContent = filterCount() ? `${filterCount()} filter${filterCount() > 1 ? 's' : ''} on` : 'All traffic';
  const q = query();
  const [an, dl] = await Promise.allSettled([get('/api/anomalies', q, { quiet: true }), get('/api/breakdown', { ...q, dim: 'deal' }, { quiet: true })]);
  if (!c.alive(my)) return;
  const top = an.status === 'fulfilled' ? an.value.alerts.filter(a => !a.cause) : null;
  items = (top || []).slice(0, 6);
  setBell(top ? top.length : 0);
  setNavCount('anomalies', top ? top.length : 0);
  $('[data-alerts]', drawer()).innerHTML = !top ? `<li class="quiet">Could not load anomalies: ${esc(an.reason?.message)}</li>`
    : items.length ? items.map((a, i) => `<li class="al ${a.severity}" data-a="${i}" tabindex="0" title="Filter to ${esc(a.name)} and open Anomalies">
        <div class="at"><span class="sev"></span><span>${esc(a.title)}</span></div>
        <div class="ad">${esc(LEVEL[a.level].one)} · ${esc(a.start.slice(5))}:00 → ${esc(a.end.slice(11))}:00 · ${esc(a.driver ? `${a.driver.step} ${a.driver.normal} → ${a.driver.actual}` : '')}</div>
        <div class="ax">${a.dir < 0 ? '−' : '+'}${money(a.impact)}<small>${a.metric === 'rev' ? 'revenue' : 'rev. equiv.'}</small></div></li>`).join('')
      : `<li class="quiet">${icon('ok')}No anomalies in this range and scope.</li>`;
  $('[data-zb]', drawer()).innerHTML = dl.status === 'fulfilled' ? zeroBidHtml(dl.value) : `<div class="quiet">Could not load deals: ${esc(dl.reason?.message)}</div>`;
}

function zeroBidHtml(b) {
  const rs = b?.rows || [];
  const totReq = rs.reduce((a, r) => a + (+r.req || 0), 0);
  const z = rs.filter(r => (+r.req || 0) > 0 && (+r.bids || 0) === 0).sort((a, b) => b.req - a.req);
  const zReq = z.reduce((a, r) => a + (+r.req || 0), 0);
  const share = totReq ? zReq / totReq * 100 : 0;
  if (!totReq) return '<div class="quiet">No bid requests in this scope.</div>';
  return `<div class="zb-sum"><div><div class="zb-big ${share >= 10 ? 't-bad' : ''}">${pct(share)}</div><div class="muted">of bid requests go to deals that never bid</div></div>
    <div class="muted zb-r"><span class="num">${short(zReq)}</span> of ${short(totReq)} requests<br>${z.length} deal${z.length === 1 ? '' : 's'} never bid</div></div>
    <div class="zbar"><span style="width:${Math.min(100, share).toFixed(1)}%"></span></div>
    ${z.length ? `<ul class="zl">${z.slice(0, 6).map(r => `<li tabindex="0" data-deal="${esc(r.id)}" data-name="${esc(r.name)}" title="${esc(r.name)} · ${esc(r.demand || '')} · click to filter"><span class="zn">${esc(r.name)}<small>${esc(r.demand || '')}</small></span><span class="num">${short(r.req)}</span><span class="num">${pct(r.req / totReq * 100)}</span></li>`).join('')}</ul>`
      : `<div class="quiet">${icon('ok')}Every deal with traffic is bidding.</div>`}`;
}
