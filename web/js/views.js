// Saved views: a named snapshot of the URL hash (page, range, filters, metric), kept in this browser.
// A view stores the preset key (e.g. "Last week"), not fixed dates, so it stays current.
import { prefs, hashString, scopeText, state } from './state.js';
import { PRESETS } from './periods.js';
import { fmtRange } from './format.js';

const KEY = 'views';
const MAX = 24;
const valid = a => Array.isArray(a) && a.every(v => v && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.hash === 'string' && v.hash.startsWith('#'));

export const listViews = () => prefs.get(KEY, [], valid);

export function describeCurrent() {
  const range = state.preset === 'custom' ? fmtRange(state.start, state.end) : PRESETS.find(p => p[0] === state.preset)[1];
  return `${range} · ${scopeText()}`;
}

export function saveView(name) {
  const views = listViews();
  const v = { id: Date.now().toString(36), name: name.trim().slice(0, 60) || 'Untitled view', hash: hashString(), desc: describeCurrent(), page: state.page, at: new Date().toISOString() };
  prefs.set(KEY, [v, ...views.filter(x => x.name !== v.name)].slice(0, MAX));
  return v;
}
export function deleteView(id) { prefs.set(KEY, listViews().filter(v => v.id !== id)); }
export function renameView(id, name) { prefs.set(KEY, listViews().map(v => (v.id === id ? { ...v, name: name.trim().slice(0, 60) || v.name } : v))); }
export const activeView = () => listViews().find(v => v.hash === location.hash) || null;
