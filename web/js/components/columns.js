// Table columns and the per-level table configs.
import { esc, short, money, moneyX, pct, chg, deltaCell, int } from '../format.js';
import { icon } from '../icons.js';

// app counts per deal {deal_id: {n, top}}, set by the Deals page; deals whose app list is open
export const ctx = { counts: null, open: new Set(), appName: id => '#' + id };

function appsHtml(r) {
  if (r.id == null || r.id === '' || r.total) return '';
  if (!ctx.counts) return '<span class="sk sk-inl"></span>';
  const c = ctx.counts[r.id];
  if (!c || !c.n) return '<span class="na">—</span>';
  if (c.n === 1) {
    const nm = ctx.appName(c.top);
    return `<span class="bname" data-app="${esc(c.top)}" data-name="${esc(nm)}" title="Dedicated to ${esc(nm)} · click to filter by this app">${esc(nm)}</span>`;
  }
  const open = ctx.open.has(String(r.id));
  return `<button class="ron" data-deal="${esc(r.id)}" aria-expanded="${open}" title="Run of network: show the top 5 apps">RON · ${int(c.n)} apps ${icon('chev')}</button>`;
}
const pill = (v, cls = '') => (v ? `<span class="pill ${cls}">${esc(v)}</span>` : '');
const revD = r => chg(r.cmpRev ?? r.rev, r.prevRev);
const reqD = r => chg(r.cmpReq ?? r.req, r.prevReq);
const dcsv = d => (d == null ? '' : Number.isFinite(d) ? +d.toFixed(2) : 'new');

// t: header, f: sort/raw value, fmt: display, html: custom cell, txt: text column, na: n/a when null, csv: export value, tip: header tooltip
export const COLS = {
  name: { t: 'Name', f: r => r.name || (r.id != null && r.id !== '' ? '#' + r.id : ''), cls: 'l name', txt: true },
  id: { t: 'ID', f: r => r.id, cls: 'l', txt: true },
  partner: { t: 'Partner', f: r => r.partner, cls: 'l', txt: true },
  publisher: { t: 'Publisher', f: r => r.partner, cls: 'l', txt: true },
  demand: { t: 'Demand source', f: r => r.demand, cls: 'l', txt: true },
  dealPub: { t: 'Publisher', f: r => r.publisher, cls: 'l', txt: true },
  bundle: { t: 'Store ID', f: r => r.bundle, cls: 'l', txt: true },
  format: { t: 'Format', f: r => r.format, cls: 'l', txt: true },
  region: { t: 'Region', f: r => r.region, cls: 'l', txt: true },
  apps: { t: 'Apps', f: r => ctx.counts?.[r.id]?.n ?? null, cls: 'l', html: appsHtml,
    csv: r => { const c = ctx.counts?.[r.id]; return !c || !c.n ? '' : c.n === 1 ? ctx.appName(c.top) : `RON (${c.n})`; } },
  mode: { t: 'Setup', f: r => r.mode, cls: 'l', txt: true, html: r => pill(r.mode, r.mode === 'Manual' ? 'solid' : '') },
  enabled: { t: 'Status', f: r => r.enabled, cls: 'l', txt: true, html: r => pill(r.enabled, r.enabled === 'On' ? '' : 'dim') },
  cfgMargin: { t: 'Target margin', f: r => r.cfgMargin ?? -1, fmt: v => (v < 0 ? '' : v + '%'), csv: r => r.cfgMargin ?? '' },
  cfgQps: { t: 'QPS cap', f: r => r.cfgQps ?? -2, fmt: v => (v === -2 ? '' : v === -1 ? 'none' : int(v)), csv: r => (r.cfgQps == null ? '' : r.cfgQps === -1 ? 'none' : r.cfgQps) },
  count: { t: 'Children', f: r => r.count, fmt: int, tip: 'Active entities one level down (sources, placements or deals)' },
  opps: { t: 'Opportunities', f: r => r.opps, fmt: short, na: true, tip: 'Ad opportunities offered by the publisher (supply side only)' },
  req: { t: 'Bid requests', f: r => r.req, fmt: short },
  bids: { t: 'Bids', f: r => r.bids, fmt: short },
  wins: { t: 'Wins', f: r => r.wins, fmt: short },
  imps: { t: 'Impressions', f: r => r.imps, fmt: short },
  starts: { t: 'Video starts', f: r => r.starts, fmt: short },
  completes: { t: 'Completes', f: r => r.completes, fmt: short },
  complRate: { t: 'Completion %', f: r => r.complRate, fmt: v => pct(v, 1) },
  rev: { t: 'Revenue', f: r => r.rev, fmt: money, tip: 'Gross revenue: what buyers pay' },
  // Δ% uses completed hours (cmpRev / cmpReq) while the range is still running
  revD: { t: 'Rev Δ%', f: revD, html: r => deltaCell('rev', revD(r)), csv: r => dcsv(revD(r)) },
  reqD: { t: 'Req Δ%', f: reqD, html: r => deltaCell('req', reqD(r)), csv: r => dcsv(reqD(r)) },
  prevRev: { t: 'Prev revenue', f: r => r.prevRev, fmt: money },
  prevReq: { t: 'Prev requests', f: r => r.prevReq, fmt: short },
  cost: { t: 'Payout', f: r => r.cost, fmt: money, tip: 'What publishers are paid' },
  margin: { t: 'Margin', f: r => r.margin, fmt: money },
  marginPct: { t: 'Margin %', f: r => r.marginPct, fmt: v => pct(v, 1) },
  oppFill: { t: 'Opp fill %', f: r => r.oppFill, fmt: v => pct(v, 3), na: true, tip: 'Impressions ÷ opportunities' },
  oppEcpm: { t: 'Opp eCPM', f: r => r.oppEcpm, fmt: v => moneyX(v, 4), na: true, tip: 'Revenue × 1000 ÷ opportunities' },
  fill: { t: 'Fill %', f: r => r.fill, fmt: v => pct(v, 3), tip: 'Impressions ÷ bid requests' },
  rpmr: { t: 'RPMR', f: r => r.rpmr, fmt: v => moneyX(v, 2), tip: 'Revenue per million bid requests' },
  bidRate: { t: 'Bid rate', f: r => r.bidRate, fmt: v => pct(v, 2), tip: 'Bids ÷ bid requests' },
  winRate: { t: 'Win rate', f: r => r.winRate, fmt: v => pct(v, 1), tip: 'Wins ÷ bids' },
  ecpm: { t: 'eCPM', f: r => r.ecpm, fmt: v => moneyX(v, 2), tip: 'Revenue × 1000 ÷ impressions' },
  qps: { t: 'Avg QPS', f: r => r.qps, fmt: int, tip: 'Bid requests per second, averaged over the hours in range' },
  revDisplay: { t: 'Display rev', f: r => r.revDisplay, fmt: money },
  revVideo: { t: 'Video rev', f: r => r.revVideo, fmt: money },
  revNative: { t: 'Native rev', f: r => r.revNative, fmt: money },
  revCtv: { t: 'CTV rev', f: r => r.revCtv, fmt: money },
  trend: { t: 'Trend', special: true, cls: 'sp nosort', html: r => (r.total ? '' : `<span data-spark="${esc(r.id)}"></span>`) },
};

const CMP = ['revD', 'reqD', 'prevRev', 'prevReq'];
const FMT = ['revDisplay', 'revVideo', 'revNative', 'revCtv'];
const VQ = ['starts', 'completes', 'complRate'];
const FUNNEL = ['req', 'bids', 'wins', 'imps', 'rev', ...CMP, 'cost', 'margin', 'marginPct', 'bidRate', 'winRate', 'fill', 'ecpm', 'rpmr'];
// lean defaults; extras live in the column picker
export const HIDDEN_DEFAULT = ['prevRev', 'prevReq', 'id', ...FMT, ...VQ];
export const GROUPS = [['Revenue by format', FMT], ['Video quality', VQ], ['Comparison', CMP]];
export const SUM_KEYS = ['opps', 'req', 'bids', 'wins', 'imps', 'starts', 'completes', 'rev', 'cost', 'count', 'prevRev', 'prevReq', 'cmpRev', 'cmpReq', ...FMT];

// level → table view. drill: the page a name click opens (with that row as the filter)
export const VIEWS = {
  demand_partner: { level: 'dp', cols: ['name', 'trend', 'id', 'count', ...FUNNEL, 'qps', ...FMT, ...VQ], drill: 'demand_source', search: 'name or ID' },
  demand_source: { level: 'ds', cols: ['name', 'trend', 'id', 'partner', 'format', 'region', ...FUNNEL, 'qps', ...FMT, ...VQ], drill: 'deal', search: 'name, ID or partner' },
  deal: { level: 'deal', cols: ['name', 'trend', 'id', 'demand', 'partner', 'dealPub', 'apps', 'mode', 'enabled', 'cfgMargin', 'cfgQps', ...FUNNEL, 'qps', ...FMT, ...VQ], drill: 'app', search: 'name, ID, demand source or publisher' },
  publisher: { level: 'pub', cols: ['name', 'trend', 'id', 'region', 'count', 'opps', ...FUNNEL, 'oppFill', 'oppEcpm', 'qps', ...FMT, ...VQ], drill: 'placement', search: 'name or ID' },
  placement: { level: 'plc', cols: ['name', 'trend', 'id', 'publisher', 'format', 'opps', ...FUNNEL, 'oppFill', 'oppEcpm', 'qps', ...FMT, ...VQ], drill: 'app', search: 'name, ID or publisher' },
  app: { level: 'app', cols: ['name', 'trend', 'bundle', 'id', 'publisher', 'opps', ...FUNNEL, 'oppFill', 'oppEcpm', 'qps', ...FMT, ...VQ], drill: 'deal', search: 'name, store ID or publisher' },
};
