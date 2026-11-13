// Máy chủ thử nghiệm: phục vụ web app + "Saved Messages" giả. Gieo sẵn tệp do bản Python tạo.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const PW = 'Mật khẩu Vault cũ 2025';
const msgs = [];       // {id, caption, bytes, date}
let nextId = 1000;
const add = (caption, bytes) => { const m = { id: nextId++, caption, bytes, date: Math.floor(Date.now() / 1000) }; msgs.push(m); return m; };

// --- gieo dữ liệu do TeleCloud Python tạo ---
const D = process.env.TC_COMPAT_DIR || '/tmp/compat';
function pyEncrypt(name, folder, data, pw = PW) {
  const id = randomBytes(16).toString('hex');
  fs.writeFileSync(`${D}/seed.bin`, data);
  execFileSync('python3', ['-c', `import sys, json, hashlib; sys.path.insert(0,'${D}'); from tc_crypto import encrypt_file; from pathlib import Path
d = Path('${D}/seed.bin').read_bytes()
m = {"version":1,"id":"${id}","name":sys.argv[1],"size":len(d),"mime_type":sys.argv[3],"sha256":hashlib.sha256(d).hexdigest(),"folder":sys.argv[2],"uploaded_at":"2025-12-01T08:00:00+00:00"}
encrypt_file(Path('${D}/seed.bin'), Path('${D}/seed.tcv'), sys.argv[4], m, 1024*1024)`, name, folder, name.endsWith('.txt') ? 'text/plain' : 'application/pdf', pw]);
  add(`TCLOUD1:${id}`, fs.readFileSync(`${D}/seed.tcv`));
  return { id, data };
}
export const seeded = {
  note: pyEncrypt('ghi chú cũ.txt', 'Tệp của tôi', Buffer.from('Tài liệu từ TeleCloud bản Python 🐍\nSố CCCD: 0123456789\n')),
  pdf: pyEncrypt('Hợp đồng thuê nhà.pdf', 'Tài liệu', randomBytes(2_500_000)),
};
pyEncrypt('của két khác.txt', 'Tệp của tôi', Buffer.from('khác'), 'mật khẩu khác hẳn');   // phải bị bỏ qua
add('', Buffer.from('tệp bình thường của người dùng'));                                     // không phải TeleCloud

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const body = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  if (p.startsWith('/__tg/')) {
    const op = p.slice(6);
    if (op === 'scan') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(msgs.map((m) => ({ id: m.id, caption: m.caption, size: m.bytes.length, date: m.date })).reverse())); }
    if (op === 'upload') { const m = add(url.searchParams.get('caption'), await body(req)); res.writeHead(200); return res.end(JSON.stringify({ id: m.id })); }
    if (op.startsWith('file/')) {
      const m = msgs.find((x) => x.id === Number(op.slice(5)));
      if (!m) { res.writeHead(404); return res.end('Không tìm thấy tệp'); }
      const max = Number(url.searchParams.get('max')) || m.bytes.length;
      res.writeHead(200); return res.end(m.bytes.subarray(0, Math.min(max, m.bytes.length)));
    }
    if (op === 'delete') { const ids = JSON.parse(await body(req)); for (const id of ids) { const i = msgs.findIndex((x) => x.id === id); if (i >= 0) msgs.splice(i, 1); } res.writeHead(200); return res.end('{}'); }
    if (op === 'dump') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(msgs.map((m) => ({ id: m.id, caption: m.caption, b64: m.bytes.toString('base64') })))); }
    res.writeHead(404); return res.end();
  }
  let f = p.endsWith('/') ? p + 'index.html' : p;
  if (f === '/js/tg.js') f = '/tests/mock/tg.js';
  if (f === '/js/gram.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); return res.end('export const loadGram = async (cb) => { cb?.(1, 1); return {}; };'); }
  const file = path.join(ROOT, path.normalize(f));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  let out = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(out);
}).listen(8090, () => console.log('test server http://localhost:8090'));
