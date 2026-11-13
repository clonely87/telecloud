// Kiểm thử đầu-cuối: Chrome thật + Telegram giả lập + dữ liệu do TeleCloud Python tạo.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');

const APP = 'http://localhost:8090/?nosw';
const PW = 'Mật khẩu Vault cũ 2025';
const OUT = new URL('./out/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
let n = 0; const ok = (m) => console.log(`  ✓ ${++n}. ${m}`);
const dump = async () => (await fetch('http://localhost:8090/__tg/dump')).json();
const pyDecrypt = (b64, pw = PW) => {
  fs.writeFileSync('/tmp/compat/check.tcv', Buffer.from(b64, 'base64'));
  return JSON.parse(execFileSync('python3', ['-c', `import sys,json; sys.path.insert(0,'/tmp/compat'); from tc_crypto import decrypt_file; from pathlib import Path
m = decrypt_file(Path('/tmp/compat/check.tcv'), Path('/tmp/compat/check.out'), sys.argv[1]); print(json.dumps(m))`, pw], { encoding: 'utf8' }));
};

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errors = [];
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 860 }, locale: 'vi-VN', ...opts });
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return p;
}
async function login(page) {
  await page.goto(APP);
  await page.waitForSelector('[data-step=api]:not([hidden])');
  await page.fill('#api-id', '123456'); await page.fill('#api-hash', '0123456789abcdef0123456789abcdef');
  await page.click('#f-api button');
  await page.waitForSelector('[data-step=phone]:not([hidden])');
  await page.fill('#phone', '+84 912 345 678'); await page.click('#f-phone button');
  await page.waitForSelector('[data-step=code]:not([hidden])');
  await page.fill('#code', '12345'); await page.click('#f-code button');
  await page.waitForSelector('[data-step="2fa"]:not([hidden])');
  await page.fill('#tg-pw', 'mat-khau-2fa'); await page.click('#f-2fa button');
  await page.waitForSelector('[data-step=unlock]:not([hidden])');
}

// 1. đăng nhập Telegram
const page = await newPage();
await page.goto(APP);
await page.waitForSelector('[data-step=api]:not([hidden])');
await page.screenshot({ path: OUT + '1-api.png' });
await page.fill('#api-id', '123456'); await page.fill('#api-hash', '0123456789abcdef0123456789abcdef');
await page.click('#f-api button');
await page.fill('#phone', '+84 912 345 678'); await page.click('#f-phone button');
await page.fill('#code', '99999'); await page.click('#f-code button');
await page.waitForSelector('#gate-error:not([hidden])');
assert.match(await page.textContent('#gate-error'), /PHONE_CODE_INVALID|không đúng/);
await page.fill('#code', '12345'); await page.click('#f-code button');
await page.fill('#tg-pw', 'mat-khau-2fa'); await page.click('#f-2fa button');
await page.waitForSelector('[data-step=unlock]:not([hidden])');
assert.match(await page.textContent('#who'), /Lâm Đăng Huy/);
ok('Đăng nhập Telegram: số điện thoại → mã (sai mã bị báo lỗi) → mật khẩu 2 bước');

// 2. mở khóa Vault bằng mật khẩu bản Python
await page.fill('#vault-pw', 'sai mật khẩu'); await page.click('#f-unlock button');
await page.waitForSelector('#gate-error:not([hidden])');
assert.match(await page.textContent('#gate-error'), /Sai mật khẩu/);
await page.fill('#vault-pw', PW); await page.click('#f-unlock button');
await page.waitForSelector('#app:not([hidden])');
await page.waitForSelector('.files >> text=ghi chú cũ.txt');
await page.waitForSelector('.files >> text=Hợp đồng thuê nhà.pdf');
const listText = await page.textContent('#files');
assert.ok(!listText.includes('của két khác'), 'tệp của két khác phải bị bỏ qua');
assert.match(await page.textContent('#folders'), /Tài liệu/);
await page.waitForFunction(async () => (await (await fetch('/__tg/scan')).json()).some((m) => m.caption.startsWith('TCLOUDIDX1:')));
ok('Mở khóa bằng mật khẩu Vault cũ: thấy tệp do bản Python tải lên, đúng thư mục; bỏ qua tệp của két khác; tạo chỉ mục');

// 3. tải lên (mã hóa trên trình duyệt)
await page.click('#folders >> text=Tài liệu');
const big = crypto.randomBytes(3 * 1024 * 1024 + 4321);
await page.setInputFiles('#file-input', [{ name: 'ảnh chụp CCCD.jpg', mimeType: 'image/jpeg', buffer: big }]);
await page.waitForSelector('#tlist li.done', { timeout: 60000 });
await page.waitForSelector('.files >> text=ảnh chụp CCCD.jpg');
let d = await dump();
const up = d.find((m) => /^TCLOUD1:[0-9a-f]{32}$/.test(m.caption) && Buffer.from(m.b64, 'base64').length > 3e6 && !d.slice(0, 2).includes(m));
const meta = pyDecrypt(up.b64);
assert.equal(meta.name, 'ảnh chụp CCCD.jpg'); assert.equal(meta.folder, 'Tài liệu');
assert.ok(fs.readFileSync('/tmp/compat/check.out').equals(big), 'Python giải mã ra đúng nội dung');
assert.ok(!Buffer.from(up.b64, 'base64').includes(Buffer.from('CCCD')), 'không lộ tên');
ok('Tải lên 3 MB: mã hóa trong trình duyệt; TeleCloud Python giải mã được, đúng tên/thư mục/SHA-256');

// 4. tải xuống tệp do Python tạo
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.files li:has-text("Hợp đồng thuê nhà.pdf") button[title="Tải xuống"]')]);
assert.equal(dl.suggestedFilename(), 'Hợp đồng thuê nhà.pdf');
const pdfBytes = fs.readFileSync(await dl.path());
assert.equal(pdfBytes.length, 2_500_000);
ok('Tải xuống + giải mã tệp do bản Python tạo (kiểm tra SHA-256 trong trình duyệt)');

// 5. xem trước văn bản
await page.click('#folders >> text=Tất cả');
await page.click('.files .nm >> text=ghi chú cũ.txt');
await page.waitForSelector('#v-body pre');
assert.match(await page.textContent('#v-body pre'), /Số CCCD: 0123456789/);
await page.screenshot({ path: OUT + '3-xem-truoc.png' });
await page.click('#v-close');
ok('Xem trước tệp văn bản ngay trong app');

// 6. thư mục mới, chuyển, đổi tên, xóa
await page.click('#btn-mkdir'); await page.fill('#dlg input', 'Ảnh gia đình'); await page.keyboard.press('Enter');
await page.waitForSelector('#folders >> text=Ảnh gia đình');
await page.click('#folders >> text=Tất cả');
await page.click('.files li:has-text("ảnh chụp CCCD.jpg") button[title="Chuyển thư mục"]');
await page.selectOption('#dlg select', 'Ảnh gia đình'); await page.click('#dlg-ok');
await page.click('.files li:has-text("ghi chú cũ.txt") button[title="Đổi tên"]');
await page.fill('#dlg input', 'ghi chú quan trọng.txt'); await page.click('#dlg-ok');
await page.waitForSelector('.files >> text=ghi chú quan trọng.txt');
await page.evaluate(() => window.__tc.S.vault.flush());
d = await dump();
assert.equal(d.filter((m) => m.caption.startsWith('TCLOUDIDX1:')).length, 1, 'chỉ giữ 1 chỉ mục');
ok('Tạo thư mục, chuyển tệp, đổi tên; chỉ mục được lưu lên Telegram (chỉ giữ 1 bản mới nhất)');

// 6b. cây thư mục: kéo-thả tệp vào thư mục, đổi tên thư mục qua menu ⋯, thu gọn/mở rộng
await page.click('#folders >> text=Tất cả');
await page.dragAndDrop('.files li:has-text("Hợp đồng thuê nhà.pdf")', '#folders .node.d1:has-text("Ảnh gia đình")');
await page.waitForFunction(() => window.__tc.S.vault.list().find((e) => e.name === 'Hợp đồng thuê nhà.pdf')?.folder === 'Ảnh gia đình');
await page.hover('#folders .node.d1:has-text("Ảnh gia đình")');
await page.click('#folders .node.d1:has-text("Ảnh gia đình") .node-more');
await page.screenshot({ path: OUT + '2b-menu-thu-muc.png' });
await page.click('#pop >> text=Đổi tên');
await page.fill('#dlg input', 'Giấy tờ gia đình'); await page.keyboard.press('Enter');
await page.waitForSelector('#folders >> text=Giấy tờ gia đình');
assert.equal(await page.isVisible('#folders >> text=Ảnh gia đình'), false);
assert.equal(await page.evaluate(() => window.__tc.S.vault.list('Giấy tờ gia đình').length), 2);
await page.click('#folders .twisty'); await page.waitForSelector('#folders .node.d1', { state: 'detached' });
await page.click('#folders .twisty'); await page.waitForSelector('#folders .node.d1');
await page.click('#folders >> text=Giấy tờ gia đình');
await page.waitForSelector('#crumbs >> text=Giấy tờ gia đình');
await page.click('#btn-tclear');
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + '2c-cay-thu-muc.png' });
await page.evaluate(() => window.__tc.S.vault.flush());
ok('Cây thư mục: kéo-thả tệp vào thư mục, đổi tên thư mục qua menu ⋯, thu gọn/mở rộng, đường dẫn (breadcrumb)');

// 7. thiết bị thứ hai (điện thoại) thấy đúng thay đổi
const phone = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await login(phone);
await phone.fill('#vault-pw', PW); await phone.click('#f-unlock button');
await phone.waitForSelector('.files >> text=ghi chú quan trọng.txt');
await phone.click('#folders >> text=Giấy tờ gia đình');
await phone.waitForSelector('.files >> text=ảnh chụp CCCD.jpg');
await phone.screenshot({ path: OUT + '4-dien-thoai.png' });
// điện thoại tải lên, máy tính đồng bộ thấy
await phone.setInputFiles('#file-input', [{ name: 'từ điện thoại.txt', mimeType: 'text/plain', buffer: Buffer.from('xin chào từ Android') }]);
await phone.waitForSelector('.files >> text=từ điện thoại.txt');
await phone.evaluate(() => window.__tc.S.vault.flush());
await page.click('#btn-menu'); await page.click('[data-act=refresh]');
await page.waitForSelector('.files >> text=từ điện thoại.txt');
ok('Điện thoại (Android) mở cùng Vault, thấy đúng tên/thư mục đã sửa; tệp điện thoại tải lên hiện trên máy tính');

// 8. xóa
const before = (await dump()).filter((m) => /^TCLOUD1:/.test(m.caption)).length;
await page.click('.files li:has-text("từ điện thoại.txt") button[title="Xóa"]');
await page.click('#dlg-ok');
await page.waitForFunction(() => !document.querySelector('#files').textContent.includes('từ điện thoại'));
assert.equal((await dump()).filter((m) => /^TCLOUD1:/.test(m.caption)).length, before - 1);
ok('Xóa tệp khỏi Telegram');

// 9. khóa & tự khôi phục chỉ mục khi bị xóa
await page.click('#btn-lock');
await page.waitForSelector('[data-step=unlock]:not([hidden])');
await page.screenshot({ path: OUT + '5-khoa.png' });
for (const m of (await dump()).filter((x) => x.caption.startsWith('TCLOUDIDX1:'))) await fetch('http://localhost:8090/__tg/delete', { method: 'POST', body: JSON.stringify([m.id]) });
await page.fill('#vault-pw', PW); await page.click('#f-unlock button');
await page.waitForSelector('.files >> text=Hợp đồng thuê nhà.pdf');
await page.waitForSelector('.files >> text=ảnh chụp CCCD.jpg');
ok('Khóa/mở khóa; mất tệp chỉ mục vẫn tự dựng lại từ metadata trong từng tệp');
await page.screenshot({ path: OUT + '2-may-tinh.png' });

await browser.close();
assert.deepEqual(errors, [], 'lỗi trình duyệt: ' + errors.join('\n'));
console.log(`\nTẤT CẢ ${n} kịch bản đạt. Ảnh: ${OUT}`);
