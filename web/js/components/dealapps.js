// Deals page: a run-of-network deal (more than one app) expands to an inline table of its top 5 apps.
import { esc, short, money, moneyX, pct } from '../format.js';
import { icon } from '../icons.js';
import { get, url } from '../api.js';
import { query } from '../state.js';
import { ctx } from './columns.js';

const data = new Map();   // key: deal + query → rows | {error}
const keyOf = deal => deal + '|' + url('', query({ noPrev: true }));

export function subRow(r, span, redraw) {
  if (!ctx.open.has(String(r.id)) || !(ctx.counts?.[r.id]?.n > 1)) return '';
  const key = keyOf(r.id);
  if (!data.has(key)) load(r.id, key, redraw);
  return `<tr class="subrow"><td colspan="${span}"><div class="subwrap" data-sub="${esc(r.id)}">${inner(r, data.get(key))}</div></td></tr>`;
}
function inner(r, rows) {
  if (!rows) return `<div class="subh">${icon('app')}Top 5 apps · loading…</div><div style="padding:0 14px">${'<div class="sk sk-line"></div>'.repeat(4)}</div>`;
  if (rows.error) return `<div class="subh">${icon('alert')}Could not load apps: ${esc(rows.error)}</div>`;
  const fr = +r.rev || 0;
  return `<div class="subh">${icon('app')}Top ${rows.length} apps by revenue · click an app to filter by it</div>
    <table class="t compact"><thead><tr><th class="l">App</th><th class="l">Store ID</th><th>Bid requests</th><th>Bids</th><th>Wins</th><th>Impressions</th><th>Revenue</th><th>Payout</th><th>RPMR</th><th>Share of deal revenue</th></tr></thead>
    <tbody>${rows.length ? rows.map(b => `<tr><td class="l"><span class="bname" data-app="${esc(b.app_id)}" data-name="${esc(b.name)}" title="Filter by ${esc(b.name)}">${esc(b.name)}</span></td><td class="l na">${esc(b.bundle)}</td>
      <td>${short(b.req || 0)}</td><td>${short(b.bids || 0)}</td><td>${short(b.wins || 0)}</td><td>${short(b.imps || 0)}</td>
      <td>${money(b.rev || 0)}</td><td>${money(b.cost || 0)}</td><td>${moneyX(b.req ? (b.rev || 0) * 1e6 / b.req : 0, 2)}</td><td>${fr ? pct((b.rev || 0) / fr * 100, 1) : '—'}</td></tr>`).join('')
      : '<tr><td class="l na" colspan="10">No apps in this range</td></tr>'}</tbody></table>`;
}
function load(deal, key, redraw) {
  data.set(key, null);
  get('/api/deal-apps', { ...query({ noPrev: true }), deal }, { quiet: true })
    .then(j => data.set(key, j.rows || []))
    .catch(e => data.set(key, { error: e.message }))
    .finally(() => { if (key === keyOf(deal) && document.querySelector(`[data-sub="${CSS.escape(String(deal))}"]`)) redraw(); });
}
export const clearDealApps = () => data.clear();

// toggles a RON row; returns true when the click was handled
export function onRonClick(e, redraw) {
  const b = e.target.closest('button[data-deal]');
  if (!b) return false;
  const k = b.dataset.deal;
  if (ctx.open.has(k)) ctx.open.delete(k); else ctx.open.add(k);
  redraw();
  return true;
}
