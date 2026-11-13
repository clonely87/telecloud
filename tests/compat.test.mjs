// Kiểm thử chéo với telecloud/crypto.py (bản Python gốc)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import * as TC from '../js/tcfile.js';
const PW = 'Mật khẩu Vault rất dài 2026';
const D = process.env.TC_COMPAT_DIR || '/tmp/compat';
const py = (code) => execFileSync('python3', ['-c', `import sys; sys.path.insert(0,'${D}'); from tc_crypto import *; from pathlib import Path\n${code}`], { encoding: 'utf8' });
let n = 0; const ok = (m) => console.log(`  ✓ ${++n}. ${m}`);

async function jsEncrypt(data, meta) {
  const { size, parts } = await TC.encrypt(PW, meta, new Blob([data]));
  const out = []; for await (const p of parts) out.push(p);
  const all = Buffer.concat(out); assert.equal(all.length, size); return all;
}
for (const len of [1, 1000, 1048576 - 200, 1048576, 3 * 1048576 + 17]) {
  const data = randomBytes(len);
  const sha = createHash('sha256').update(data).digest('hex');
  const meta = { version: 1, id: randomBytes(16).toString('hex'), name: `ảnh ${len}.bin`, size: len, mime_type: 'application/octet-stream', sha256: sha, folder: 'Tệp của tôi', uploaded_at: new Date().toISOString().replace('Z', '+00:00') };
  // JS → Python
  fs.writeFileSync(`${D}/js.tcv`, await jsEncrypt(data, meta));
  const r = JSON.parse(py(`import json; m = decrypt_file(Path('${D}/js.tcv'), Path('${D}/js.out'), sys.argv[1] if len(sys.argv)>1 else ${JSON.stringify(PW)}); print(json.dumps(m))`));
  assert.equal(r.name, meta.name); assert.ok(fs.readFileSync(`${D}/js.out`).equals(data));
  // Python → JS
  fs.writeFileSync(`${D}/src.bin`, data);
  py(`import json; encrypt_file(Path('${D}/src.bin'), Path('${D}/py.tcv'), ${JSON.stringify(PW)}, json.loads(${JSON.stringify(JSON.stringify(meta))}), 1024*1024)`);
  const d = new TC.Decryptor(PW); const ct = fs.readFileSync(`${D}/py.tcv`); const parts = [];
  for (let o = 0; o < ct.length; o += 300000) parts.push(...await d.push(new Uint8Array(ct.subarray(o, o + 300000))));
  const m = d.finish();
  assert.equal(m.name, meta.name); assert.ok(Buffer.concat(parts).equals(data));
}
ok('JS ↔ Python: mã hóa bên này, giải mã bên kia khớp từng byte (5 kích thước, kể cả ranh giới khối 1 MiB)');

// sai mật khẩu & sửa dữ liệu
const ct = fs.readFileSync(`${D}/py.tcv`);
await assert.rejects(TC.decryptAll('sai', new Uint8Array(ct)), /Sai mật khẩu/);
const bad = Buffer.from(ct); bad[bad.length - 5] ^= 1;
await assert.rejects(TC.decryptAll(PW, new Uint8Array(bad)), TC.VaultError);
await assert.rejects(TC.decryptAll(PW, new Uint8Array(ct.subarray(0, ct.length - 100))), /cắt cụt/);
ok('Sai mật khẩu, sửa byte, cắt cụt đều bị phát hiện');

// đọc metadata chỉ từ phần đầu
const d2 = new TC.Decryptor(PW, { verify: false });
await d2.push(new Uint8Array(ct.subarray(0, TC.firstChunkBytes())));
assert.equal(d2.metadata.folder, 'Tệp của tôi');
ok(`Đọc metadata chỉ cần ${TC.firstChunkBytes()} byte đầu (không tải cả file)`);
console.log(`\n${n} nhóm kiểm thử tương thích đạt`);
