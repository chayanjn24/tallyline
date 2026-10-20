// Light / dark theme: follows the system until the viewer picks one with the header toggle.
import { prefs } from './state.js';

const media = matchMedia('(prefers-color-scheme: light)');
const listeners = new Set();

export const currentTheme = () => document.documentElement.dataset.theme || (media.matches ? 'light' : 'dark');

function apply(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  listeners.forEach(fn => fn(currentTheme()));
}
export function initTheme() {
  apply(prefs.get('theme', null, v => v === 'light' || v === 'dark'));
  media.addEventListener('change', () => { if (!document.documentElement.dataset.theme) apply(null); });
}
export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  prefs.set('theme', next);
  apply(next);
}
export const onTheme = fn => listeners.add(fn);
