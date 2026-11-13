// Service worker: lưu đệm giao diện và thư viện Telegram (phiên bản cố định) để mở nhanh.
// KHÔNG lưu đệm dữ liệu người dùng: tệp đi qua WebSocket tới Telegram, không qua đây.
const SHELL = 'telecloud-shell-v1';
const LIBS = 'telecloud-libs-v1';
const FILES = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/telecloud-192.png', 'icons/telecloud-512.png',
  'js/app.js', 'js/tg.js', 'js/gram.js', 'js/store.js', 'js/tcfile.js', 'js/kdf.js', 'js/kdf-worker.js', 'js/scrypt.js', 'js/sha256.js'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys()
  .then((ks) => Promise.all(ks.filter((k) => ![SHELL, LIBS].includes(k)).map((k) => caches.delete(k))))
  .then(() => self.clients.claim())));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Thư viện có phiên bản cố định → dùng bản đệm trước.
  if (url.origin === 'https://cdn.jsdelivr.net' || url.origin === 'https://esm.sh') {
    e.respondWith(caches.open(LIBS).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // Giao diện: ưu tiên mạng để luôn có bản mới, mất mạng thì dùng bản đệm.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && !url.search) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
});
