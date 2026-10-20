// GET-only API client: 3-minute client cache keyed by URL, in-flight dedupe, a thin top progress bar.
// Sequence guards live with the callers (see guard()).
const TTL = 180000;
const cache = new Map();
let pending = 0, hideT = null;

function progress(d) {
  pending = Math.max(0, pending + d);
  const el = document.getElementById('progress');
  if (!el) return;
  clearTimeout(hideT);
  if (pending > 0) {
    el.classList.add('on');
    const cur = parseFloat(el.dataset.p || '0');
    const next = Math.min(.9, cur + (1 - cur) * .35);
    el.dataset.p = next; el.style.transform = `scaleX(${next})`;
  } else {
    el.dataset.p = '1'; el.style.transform = 'scaleX(1)';
    hideT = setTimeout(() => { el.classList.remove('on'); setTimeout(() => { if (!pending) { el.dataset.p = '0'; el.style.transform = 'scaleX(0)'; } }, 260); }, 180);
  }
}

export function url(path, params = {}) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) v.forEach(x => u.append(k, x)); else u.set(k, v);
  }
  const s = u.toString().replace(/%2C/g, ',');
  return path + (s ? '?' + s : '');
}

// get(path, params, { quiet, fresh }) → Promise<json>
export function get(path, params, o = {}) {
  const key = url(path, params);
  const hit = cache.get(key);
  if (!o.fresh && hit && Date.now() - hit.at < TTL) return hit.p;
  if (!o.quiet) progress(1);
  const p = fetch(key, { method: 'GET', headers: { Accept: 'application/json' } }).then(async r => {
    let body = null;
    try { body = await r.json(); } catch { /* non-JSON */ }
    if (!r.ok) throw new Error((body && body.error) || `HTTP ${r.status}`);
    return body;
  }).finally(() => { if (!o.quiet) progress(-1); });
  cache.set(key, { at: Date.now(), p });
  p.catch(() => cache.delete(key));
  return p;
}
export const clearCache = () => cache.clear();

// a sequence guard: const g = guard(); … if (!g.alive(my)) return;
export function guard() {
  let seq = 0;
  return { next: () => ++seq, alive: n => n === seq, cancel: () => { seq++; } };
}

// run tasks with limited concurrency; stops when alive() turns false
export async function pool(items, n, fn, alive = () => true) {
  const q = items.slice();
  const worker = async () => { while (q.length && alive()) { const it = q.shift(); try { await fn(it); } catch { /* optional work */ } } };
  await Promise.all(Array.from({ length: n }, worker));
}
