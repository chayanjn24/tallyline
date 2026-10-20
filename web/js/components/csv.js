// CSV export of the visible columns and every filtered row (not just the current page).
import { COLS } from './columns.js';
import { state, LEVELS } from '../state.js';
import { toast } from '../ui.js';

// text starting with = + - @ (or tab / CR) gets a leading ' so spreadsheets never run it as a formula
const q = v => {
  let t = String(v ?? '');
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return `"${t.replace(/"/g, '""')}"`;
};
function val(c, r) {
  const col = COLS[c];
  if (col.csv) return col.csv(r);
  const v = col.f(r);
  if (col.txt) return v;
  return v == null || Number.isNaN(+v) ? '' : +(+v).toFixed(6);
}
export function csvText(cols, rows) {
  return [cols.map(c => q(COLS[c].t)).join(','), ...rows.map(r => cols.map(c => q(val(c, r))).join(','))].join('\n');
}
export function exportCsv(view, cols, rows) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csvText(cols, rows)], { type: 'text/csv;charset=utf-8' }));
  const fl = LEVELS.filter(l => state.filters[l].length).map(l => l + '-' + state.filters[l].map(x => x.id).join('+')).join('_').replace(/[^\w.+-]/g, '').slice(0, 80);
  a.download = `tallyline_${view}_${state.start}_${state.end}${fl ? '_' + fl : ''}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`Exported ${rows.length.toLocaleString('en-US')} rows · ${a.download}`);
}
