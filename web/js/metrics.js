// Derived metrics. The API returns only additive sums (requests, bids, revenue…); every rate is
// computed here from those sums, so a total row is never an average of averages. See docs/metrics.md.
import { money, short, moneyX, pct } from './format.js';
import { span } from './periods.js';

const div = (a, b) => (b ? a / b : 0);

// r: a summary side or a breakdown row; hours: active hours (for QPS); oppsOk: false under demand-side filters
export function derive(r, hours, oppsOk = true) {
  if (!r) return null;
  const o = { ...r };
  for (const k of ['req', 'bids', 'wins', 'imps', 'starts', 'completes', 'rev', 'cost']) o[k] = +r[k] || 0;
  if (!oppsOk || r.opps == null) o.opps = null;
  const hasOpps = o.opps != null;
  o.margin = o.rev - o.cost;
  o.marginPct = o.rev ? o.margin / o.rev * 100 : null;
  o.oppFill = hasOpps ? div(o.imps, o.opps) * 100 : null;      // impressions per publisher opportunity
  o.oppEcpm = hasOpps ? div(o.rev * 1000, o.opps) : null;
  o.fill = o.req ? div(o.imps, o.req) * 100 : null;             // impressions per bid request
  o.rpmr = div(o.rev * 1e6, o.req);                             // revenue per million bid requests
  o.bidRate = o.req ? div(o.bids, o.req) * 100 : null;
  o.winRate = o.bids ? div(o.wins, o.bids) * 100 : null;
  o.renderRate = o.wins ? div(o.imps, o.wins) * 100 : null;
  o.ecpm = o.imps ? div(o.rev * 1000, o.imps) : null;
  o.qps = div(o.req, (hours || 1) * 3600);
  o.complRate = o.starts > 0 ? div(o.completes, o.starts) * 100 : null;
  return o;
}

// summary → { total, cmp (completed hours: the side that is compared), prev }
export function sides(s) {
  if (!s || !s.total) return null;
  const ok = s.oppsAvailable !== false;
  const total = derive(s.total, s.total.hours, ok);
  const cmp = s.cur ? derive(s.cur, s.cur.hours, ok) : total;
  const prev = s.prev ? derive(s.prev, s.prev.hours || s.total.hours, ok) : null;
  return { total, cmp, prev, ok };
}

// ---------- chart metrics ----------
export const CHART_METRICS = [['rev', 'Revenue'], ['margin', 'Margin'], ['req', 'Requests'], ['imps', 'Impressions'], ['ecpm', 'eCPM'], ['rpmr', 'RPMR']];
export const HEAT_METRICS = [['rev', 'Revenue'], ['req', 'Requests'], ['imps', 'Impressions'], ['margin', 'Margin'], ['rpmr', 'RPMR']];
export const ADDITIVE = new Set(['rev', 'margin', 'req', 'imps', 'cost']);
export const METRIC_FMT = { rev: money, margin: money, cost: money, req: short, imps: short, ecpm: v => moneyX(v, 2), rpmr: v => moneyX(v, 2), fill: v => pct(v, 2) };

export function metricOf(b, m) {
  if (!b) return null;
  const rev = +b.rev || 0, req = +b.req || 0, imps = +b.imps || 0;
  if (m === 'rev') return rev;
  if (m === 'margin') return rev - (+b.cost || 0);
  if (m === 'cost') return +b.cost || 0;
  if (m === 'req') return req;
  if (m === 'imps') return imps;
  if (m === 'ecpm') return imps ? rev * 1000 / imps : null;
  if (m === 'rpmr') return req ? rev * 1e6 / req : null;
  return null;
}

const SUMMED = ['rev', 'cost', 'req', 'imps'];

// hours → buckets by slot index from the range start: hourly (1–2 days) or daily (3+ days)
export function bucketize(hours, s0, daily) {
  const out = new Map();
  for (const h of hours || []) {
    const lab = String(h.label || h.k), d = lab.slice(0, 10), hh = +lab.slice(11, 13) || 0;
    const off = span(s0, d) - 1;
    if (off < 0) continue;
    const i = daily ? off : off * 24 + hh;
    let b = out.get(i);
    if (!b) { b = { key: daily ? d : lab, rev: 0, cost: 0, req: 0, imps: 0, partial: 0 }; out.set(i, b); }
    for (const k of SUMMED) b[k] += +h[k] || 0;
    if (h.partial != null) b.partial = +h.partial || 0.001;
  }
  return out;
}

// sparkline series of one metric: completed hours (1 day) or daily sums (multi-day)
export function seriesOf(hours, m = 'rev', multi = false) {
  if (!hours || !hours.length) return [];
  if (!multi) return hours.filter(h => h.partial == null).map(h => metricOf(h, m) ?? 0);
  const g = new Map();
  for (const h of hours) {
    const d = String(h.label || h.k).slice(0, 10);
    const b = g.get(d) || { rev: 0, cost: 0, req: 0, imps: 0 };
    for (const k of SUMMED) b[k] += +h[k] || 0;
    g.set(d, b);
  }
  return [...g.values()].map(b => metricOf(b, m) ?? 0);
}
