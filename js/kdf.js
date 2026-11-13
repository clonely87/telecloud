// Dẫn xuất khóa: scrypt chạy trong Web Worker để giao diện không bị đứng; có bộ nhớ đệm theo salt.
import { scrypt } from './scrypt.js';

const te = new TextEncoder();
const cache = new Map();          // `${password}|${saltHex}` → Uint8Array  (chỉ trong bộ nhớ)
let worker = null, seq = 0;
const waiting = new Map();

function getWorker() {
  if (worker !== null || typeof Worker === 'undefined' || typeof location === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./kdf-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const w = waiting.get(e.data.id); waiting.delete(e.data.id); e.data.error ? w.reject(new Error(e.data.error)) : w.resolve(e.data.key); };
    worker.onerror = () => { worker = false; };
  } catch { worker = false; }
  return worker;
}

export function clearKeyCache() { cache.clear(); }

export async function deriveKey(password, salt) {
  const id = password + '|' + [...salt].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (cache.has(id)) return cache.get(id);
  const w = getWorker();
  let key;
  if (w) {
    key = await new Promise((resolve, reject) => { const n = ++seq; waiting.set(n, { resolve, reject }); w.postMessage({ id: n, password, salt }); });
  } else {
    key = await scrypt(te.encode(password), salt);
  }
  if (cache.size > 500) cache.clear();
  cache.set(id, key);
  return key;
}
