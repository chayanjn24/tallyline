// Date presets → a range and the window it is compared with. All dates are UTC.
const DAY = 864e5;
export const PRESETS = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['thisweek', 'This week'], ['lastweek', 'Last week'],
  ['mtd', 'MTD'], ['lastmonth', 'Last month'], ['custom', 'Custom'],
];
export const PRESET_KEYS = PRESETS.map(p => p[0]).filter(k => k !== 'custom');
export const MAX_DAYS = 31;

export const iso = d => d.toISOString().slice(0, 10);
export const addDays = (s, n) => iso(new Date(Date.parse(s + 'T00:00:00Z') + n * DAY));
export const span = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY) + 1; // inclusive days
export const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));
const dow = s => (new Date(s + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
const pad2 = n => String(n).padStart(2, '0');
const monthDays = s => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7), 0)).getUTCDate();
const shiftMonth = (s, k) => iso(new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1 + k, 1)));

export const today = () => iso(new Date());

// preset → { preset, start, end, pstart, pend, cmp } where cmp names the comparison
export function windowFor(preset, s, e) {
  const t = today();
  if (preset === 'today') return { preset, start: t, end: t, pstart: addDays(t, -1), pend: addDays(t, -1), cmp: 'vs yesterday' };
  if (preset === 'yesterday') { const y = addDays(t, -1); return { preset, start: y, end: y, pstart: addDays(y, -1), pend: addDays(y, -1), cmp: 'vs day before' }; }
  if (preset === 'thisweek') { const m = addDays(t, -dow(t)); return { preset, start: m, end: t, pstart: addDays(m, -7), pend: addDays(t, -7), cmp: 'vs last week' }; }
  if (preset === 'lastweek') { const m = addDays(t, -dow(t) - 7); return { preset, start: m, end: addDays(m, 6), pstart: addDays(m, -7), pend: addDays(m, -1), cmp: 'vs week before' }; }
  if (preset === 'mtd') {
    const ms = t.slice(0, 8) + '01', ps = shiftMonth(ms, -1);
    return { preset, start: ms, end: t, pstart: ps, pend: ps.slice(0, 8) + pad2(Math.min(+t.slice(8), monthDays(ps))), cmp: 'vs last month' };
  }
  if (preset === 'lastmonth') {
    const s0 = shiftMonth(t, -1), ps = shiftMonth(s0, -1);
    return { preset, start: s0, end: s0.slice(0, 8) + pad2(monthDays(s0)), pstart: ps, pend: ps.slice(0, 8) + pad2(monthDays(ps)), cmp: 'vs month before' };
  }
  // custom: N days compared with the N days before (max 31)
  let a = isDate(s) ? s : t, b = isDate(e) ? e : t;
  if (a > b) [a, b] = [b, a];
  if (b > t) b = t;
  if (span(a, b) > MAX_DAYS) a = addDays(b, -(MAX_DAYS - 1));
  const n = span(a, b);
  return { preset: 'custom', start: a, end: b, pstart: addDays(a, -n), pend: addDays(a, -1), cmp: n === 1 ? (a === t ? 'vs yesterday' : 'vs day before') : `vs previous ${n} days` };
}
