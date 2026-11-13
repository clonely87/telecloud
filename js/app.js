// TeleCloud Web — giao diện. Chạy hoàn toàn trong trình duyệt, nói chuyện thẳng với Telegram.
import { createTelegram, friendlyError } from './tg.js';
import { Vault, DEFAULT_FOLDER } from './store.js';
import { clearKeyCache } from './kdf.js';
import { loadGram } from './gram.js';
import { icon, fileBadge } from './icons.js';

const AUTO_LOCK_MIN = 15;
const $ = (s) => document.querySelector(s);
const el = (t, p = {}, ...k) => { const e = Object.assign(document.createElement(t), p); e.append(...k); return e; };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('tc_' + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('tc_' + k, JSON.stringify(v)); } catch { /* chế độ riêng tư */ } },
  del(k) { try { localStorage.removeItem('tc_' + k); } catch { /* */ } },
};
const S = { tg: null, vault: null, folder: null, q: '', busy: 0, last: Date.now(), userName: '' };

// ---------- tiện ích ----------
export function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB']; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < 2);
  return `${n.toFixed(n < 10 ? 1 : 0).replace('.', ',')} ${u[i]}`;
}
const fmtDate = (s) => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }); };
let toastT;
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), err ? 6000 : 3000);
}
const errMsg = (e) => friendlyError(e);

function dialog({ title, body = '', ok = 'OK', cancel = 'Hủy', danger = false, input = null, select = null }) {
  const d = $('#dlg'); $('#dlg-title').textContent = title;
  const b = $('#dlg-body'); b.replaceChildren(typeof body === 'string' ? el('p', { textContent: body }) : body);
  let field = null;
  if (input) { field = el('input', { value: input.value || '', placeholder: input.placeholder || '' }); b.append(field); }
  if (select) {
    field = el('select'); for (const o of select.options) field.append(el('option', { value: o, textContent: o, selected: o === select.value }));
    b.append(field);
  }
  $('#dlg-ok').textContent = ok; $('#dlg-ok').className = danger ? 'danger' : '';
  $('#dlg-cancel').hidden = cancel === null; $('#dlg-cancel').textContent = cancel || '';
  b.onkeydown = (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); d.close('ok'); } };
  return new Promise((res) => {
    d.onclose = () => res(d.returnValue === 'ok' ? (field ? field.value.trim() : true) : null);
    d.returnValue = ''; d.showModal();
    if (field?.select) { field.focus(); const dot = field.value.lastIndexOf('.'); field.setSelectionRange?.(0, dot > 0 ? dot : field.value.length); }
  });
}

// ---------- cổng ----------
function gate(step, error = '') {
  $('#app').hidden = true; $('#gate').hidden = false;
  for (const s of document.querySelectorAll('[data-step]')) s.hidden = s.dataset.step !== step;
  $('#gate-error').hidden = !error; $('#gate-error').textContent = error;
  $('#btn-reset').hidden = ['boot', 'busy', 'api'].includes(step);
  const f = { api: '#api-id', phone: '#phone', code: '#code', '2fa': '#tg-pw', unlock: '#vault-pw', create: '#cr-pw' }[step];
  if (f) setTimeout(() => $(f)?.focus(), 30);
}
const busy = (t) => { $('#busy-text').textContent = t; gate('busy'); };

async function boot() {
  const api = store.get('api');
  if (!api) return gate('api');
  $('#boot-text').textContent = 'Đang tải thư viện Telegram…';
  gate('boot');
  try {
    await loadGram((n, t) => ($('#boot-text').textContent = `Đang tải thư viện Telegram… ${Math.round(n / t * 100)}%`));
    $('#boot-text').textContent = 'Đang kết nối Telegram…';
    S.tg = await createTelegram({ ...api, session: store.get('session') || '' });
    if (await S.tg.authorized()) return afterLogin();
    gate('phone');
  } catch (e) {
    $('#api-id').value = api.apiId || ''; $('#api-hash').value = api.apiHash || '';
    gate('api', 'Không kết nối được Telegram: ' + errMsg(e) + ' — kiểm tra mạng rồi bấm Tiếp tục.');
  }
}

async function afterLogin() {
  store.set('session', S.tg.session());
  try { S.userName = (await S.tg.me()).name; } catch { S.userName = ''; }
  $('#who').textContent = S.userName ? `Tài khoản Telegram: ${S.userName}` : '';
  gate('unlock');
}

$('#f-api').onsubmit = (e) => {
  e.preventDefault();
  const next = { apiId: $('#api-id').value.trim(), apiHash: $('#api-hash').value.trim().toLowerCase() };
  const prev = store.get('api');
  if (!prev || prev.apiId !== next.apiId || prev.apiHash !== next.apiHash) store.del('session');
  store.set('api', next); boot();
};
$('#f-phone').onsubmit = async (e) => {
  e.preventDefault(); busy('Đang gửi mã…');
  try {
    const r = await S.tg.sendCode($('#phone').value);
    $('#code-hint').textContent = r.viaApp ? 'Telegram đã gửi mã vào ứng dụng Telegram trên thiết bị khác của bạn (mục tin nhắn "Telegram").' : 'Telegram đã gửi mã qua SMS.';
    gate('code');
  } catch (err) { gate('phone', errMsg(err)); }
};
$('#f-code').onsubmit = async (e) => {
  e.preventDefault(); busy('Đang đăng nhập…');
  try { (await S.tg.signIn($('#code').value)) === 'password' ? gate('2fa') : afterLogin(); }
  catch (err) { gate('code', errMsg(err)); }
};
$('#f-2fa').onsubmit = async (e) => {
  e.preventDefault(); busy('Đang xác minh…');
  try { await S.tg.signInPassword($('#tg-pw').value); $('#tg-pw').value = ''; afterLogin(); }
  catch (err) { $('#tg-pw').value = ''; gate('2fa', errMsg(err)); }
};

let pendingPw = '';
$('#f-unlock').onsubmit = async (e) => {
  e.preventDefault();
  const pw = $('#vault-pw').value;
  busy('Đang mở khóa…');
  try {
    S.vault = await Vault.open(S.tg, pw, { onProgress: (t) => ($('#busy-text').textContent = t) });
    $('#vault-pw').value = ''; enter();
  } catch (err) {
    $('#vault-pw').value = '';
    if (err.code === 'EMPTY') { pendingPw = pw; $('#cr-pw').value = pw; return gate('create'); }
    gate('unlock', /Sai mật khẩu/.test(err.message) ? 'Sai mật khẩu Vault.' : errMsg(err));
  }
};
$('#f-create').onsubmit = async (e) => {
  e.preventDefault();
  const a = $('#cr-pw').value, b = $('#cr-pw2').value;
  if (a !== b) return gate('create', 'Hai mật khẩu không khớp.');
  if (a.length < 10) return gate('create', 'Mật khẩu Vault cần ít nhất 10 ký tự.');
  busy('Đang tạo Vault…');
  try { S.vault = await Vault.open(S.tg, a, { create: true }); $('#cr-pw').value = $('#cr-pw2').value = ''; enter(); }
  catch (err) { gate('create', errMsg(err)); }
  pendingPw = '';
};
$('#btn-back-unlock').onclick = () => { $('#cr-pw').value = $('#cr-pw2').value = ''; pendingPw = ''; gate('unlock'); };
$('#btn-reset').onclick = async () => {
  if (!await dialog({ title: 'Đổi tài khoản / API?', body: 'Thiết bị này sẽ đăng xuất Telegram và quên API ID/Hash. Dữ liệu trên Telegram không bị ảnh hưởng.', ok: 'Đồng ý' })) return;
  await S.tg?.logout(); store.del('session'); store.del('api'); location.reload();
};

// ---------- màn hình chính ----------
function enter() {
  $('#gate').hidden = true; $('#app').hidden = false;
  S.folder = null; S.last = Date.now();
  S.vault.onChange = render;
  render();
}

function lock(msg) {
  if (S.vault?.pending) S.vault.flush().catch(() => {});
  S.vault = null; clearKeyCache(); closeViewer();
  $('#files').replaceChildren();
  gate('unlock', msg || '');
}

function setSync(t) { $('#sync').textContent = t; }

// ---------- menu bật lên (⋯) ----------
function popMenu(anchor, items) {
  const pop = $('#pop'); pop.replaceChildren();
  for (const it of items) {
    const b = el('button', { disabled: !!it.disabled, title: it.hint || '' }, icon(it.icon), el('span', { textContent: it.label }));
    if (it.danger) b.className = 'danger-item';
    b.onclick = (e) => { e.stopPropagation(); pop.hidden = true; it.run(); };
    pop.append(b);
  }
  const r = anchor.getBoundingClientRect();
  pop.hidden = false;
  pop.style.left = Math.min(innerWidth - pop.offsetWidth - 8, r.left) + 'px';
  pop.style.top = (r.bottom + 4 + pop.offsetHeight > innerHeight ? r.top - pop.offsetHeight - 4 : r.bottom + 4) + 'px';
}
document.addEventListener('click', () => ($('#pop').hidden = true));
addEventListener('resize', () => ($('#pop').hidden = true));

// ---------- cây thư mục ----------
const DRAG_TYPE = 'application/x-telecloud-file';
function dropTarget(node, folder) {
  node.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; node.classList.add('drop-on'); } });
  node.addEventListener('dragleave', () => node.classList.remove('drop-on'));
  node.addEventListener('drop', (e) => {
    const id = e.dataTransfer.getData(DRAG_TYPE);
    node.classList.remove('drop-on');
    if (!id) return;
    e.preventDefault(); e.stopPropagation();
    const f = S.vault.index.files[id];
    if (f && f.folder !== folder) { S.vault.move(id, folder); toast(`Đã chuyển “${f.name}” vào ${folder}`); }
  });
}

async function renameFolder(name) {
  const n = await dialog({ title: 'Đổi tên thư mục', input: { value: name }, ok: 'Lưu' });
  if (!n || n === name) return;
  try { const nn = S.vault.renameFolder(name, n); if (S.folder === name) S.folder = nn; render(); } catch (e) { toast(e.message, true); }
}
async function deleteFolder(name) {
  if (!await dialog({ title: 'Xóa thư mục?', body: `Xóa thư mục “${name}”?`, ok: 'Xóa', danger: true })) return;
  try { S.vault.deleteFolder(name); if (S.folder === name) S.folder = null; render(); } catch (e) { toast(e.message, true); }
}

function renderTree(v) {
  const tree = $('#folders'); tree.replaceChildren();
  const all = v.list();
  const collapsed = store.get('tree_collapsed') === true;
  const row = ({ label, folder, count, ic, depth, root }) => {
    const on = S.folder === folder;
    const li = el('li', { className: `node d${depth}${on ? ' on' : ''}${root ? ' root' : ''}`, role: 'treeitem' });
    li.setAttribute('aria-selected', on ? 'true' : 'false');
    const btn = el('button', { className: 'node-main', title: label });
    if (root) {
      const tw = el('span', { className: 'twisty' + (collapsed ? '' : ' open'), title: collapsed ? 'Mở rộng' : 'Thu gọn' }, icon('chevron'));
      tw.onclick = (e) => { e.stopPropagation(); store.set('tree_collapsed', !collapsed); render(); };
      btn.append(tw);
      li.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
    btn.append(icon(ic, 'node-ic'), el('span', { className: 'node-name', textContent: label }), el('span', { className: 'count', textContent: count }));
    btn.onclick = () => { S.folder = folder; render(); };
    li.append(btn);
    if (!root) {
      dropTarget(li, folder);
      const isDefault = folder === DEFAULT_FOLDER;
      const more = el('button', { className: 'node-more', title: 'Tùy chọn thư mục', ariaLabel: 'Tùy chọn thư mục' }, icon('more'));
      more.onclick = (e) => {
        e.stopPropagation();
        popMenu(more, [
          { icon: 'upload', label: 'Tải tệp lên đây', run: () => { S.folder = folder; render(); $('#file-input').click(); } },
          { icon: 'edit', label: 'Đổi tên', disabled: isDefault, hint: isDefault ? 'Thư mục mặc định' : '', run: () => renameFolder(folder) },
          { icon: 'trash', label: 'Xóa thư mục', danger: true, disabled: isDefault || count > 0,
            hint: isDefault ? 'Thư mục mặc định' : count > 0 ? 'Chỉ xóa được thư mục trống' : '', run: () => deleteFolder(folder) },
        ]);
      };
      li.append(more);
    }
    return li;
  };
  tree.append(row({ label: 'Tất cả tệp', folder: null, count: all.length, ic: 'vault', depth: 0, root: true }));
  if (!collapsed) {
    const kids = el('ul', { className: 'children', role: 'group' });
    const folders = v.folders().sort((a, b) => (b.name === DEFAULT_FOLDER) - (a.name === DEFAULT_FOLDER) || a.name.localeCompare(b.name, 'vi'));
    for (const f of folders) kids.append(row({ label: f.name, folder: f.name, count: f.count, ic: S.folder === f.name ? 'folderOpen' : 'folder', depth: 1 }));
    tree.append(el('li', { className: 'group-wrap', role: 'none' }, kids));
  }
  const st = v.stats();
  $('#stats').replaceChildren(icon('database'),
    el('div', {}, el('b', { textContent: `${st.count} tệp · ${fmtSize(st.bytes)}` }), el('small', { textContent: 'Lưu trên Telegram, mã hóa đầu-cuối' })));
}

function render() {
  const v = S.vault; if (!v) return;
  renderTree(v);
  setSync(v.pending ? 'Đang lưu chỉ mục…' : (S.userName || 'Đã đồng bộ'));

  const cr = $('#crumbs'); cr.replaceChildren();
  const home = el('button', { className: 'crumb' + (S.folder ? '' : ' cur'), textContent: 'Tất cả tệp' });
  home.onclick = () => { S.folder = null; render(); };
  cr.append(home);
  if (S.folder) cr.append(icon('chevron', 'sep'), el('span', { className: 'crumb cur', textContent: S.folder }));

  const items = v.list(S.folder, S.q);
  const ul = $('#files'); ul.replaceChildren();
  $('#empty').hidden = items.length > 0;
  $('#list-head').hidden = items.length === 0;
  for (const e of items) {
    const nm = el('div', { className: 'nm' }, el('b', { textContent: e.name }),
      el('small', { textContent: `${fmtSize(e.size)} · ${fmtDate(e.at)}${S.folder ? '' : ' · ' + e.folder}` }));
    nm.onclick = () => open(e);
    const ops = el('div', { className: 'ops' });
    const op = (ic, title, fn) => { const b = el('button', { title, ariaLabel: title }, icon(ic)); b.onclick = (ev) => { ev.stopPropagation(); fn(e); }; ops.append(b); };
    op('download', 'Tải xuống', download); op('move', 'Chuyển thư mục', move); op('edit', 'Đổi tên', rename); op('trash', 'Xóa', remove);
    const more = el('button', { title: 'Thêm', ariaLabel: 'Thêm', className: 'only-sm' }, icon('more'));
    more.onclick = (ev) => { ev.stopPropagation(); popMenu(more, [
      { icon: 'move', label: 'Chuyển thư mục', run: () => move(e) },
      { icon: 'edit', label: 'Đổi tên', run: () => rename(e) },
      { icon: 'trash', label: 'Xóa', danger: true, run: () => remove(e) }]); };
    ops.append(more);
    const li = el('li', { draggable: true }, fileBadge(e), nm,
      el('span', { className: 'c-size', textContent: fmtSize(e.size) }),
      el('span', { className: 'c-date', textContent: fmtDate(e.at) }), ops);
    li.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData(DRAG_TYPE, e.id); ev.dataTransfer.effectAllowed = 'move'; li.classList.add('dragging'); document.body.classList.add('dragging-file'); });
    li.addEventListener('dragend', () => { li.classList.remove('dragging'); document.body.classList.remove('dragging-file'); });
    ul.append(li);
  }
}

$('#search').oninput = (e) => { S.q = e.target.value; render(); };
$('#btn-mkdir').onclick = async () => {
  const n = await dialog({ title: 'Thư mục mới', input: { placeholder: 'Tên thư mục' }, ok: 'Tạo' });
  if (!n) return;
  try { S.folder = S.vault.createFolder(n); render(); } catch (e) { toast(e.message, true); }
};
$('#btn-lock').onclick = () => lock();

$('#btn-menu').onclick = (e) => { e.stopPropagation(); $('#menu').hidden = !$('#menu').hidden; };
document.addEventListener('click', () => ($('#menu').hidden = true));
$('#menu').onclick = async (e) => {
  const act = e.target.dataset.act; $('#menu').hidden = true;
  if (act === 'refresh') {
    setSync('Đang đồng bộ…'); S.busy++;
    try { await S.vault.refresh((t) => setSync(t)); toast('Đã đồng bộ với Telegram'); } catch (err) { toast(errMsg(err), true); }
    finally { S.busy--; render(); }
  } else if (act === 'logout') {
    if (!await dialog({ title: 'Đăng xuất Telegram?', body: 'Thiết bị này sẽ đăng xuất khỏi Telegram. Tệp trên Telegram vẫn giữ nguyên.', ok: 'Đăng xuất' })) return;
    if (S.vault?.pending) await S.vault.flush().catch(() => {});
    await S.tg.logout(); store.del('session'); location.reload();
  } else if (act === 'about') {
    dialog({ title: 'TeleCloud Web', cancel: null, body: el('div', { className: 'small' },
      el('p', { textContent: 'Tệp được mã hóa AES-256-GCM ngay trên thiết bị (khóa scrypt từ mật khẩu Vault) rồi gửi thẳng vào Saved Messages. Không có máy chủ trung gian nào.' }),
      el('p', { textContent: 'Định dạng tệp giống hệt TeleCloud bản Python: hai bản dùng chung dữ liệu. Danh sách tệp được lưu thành một tệp chỉ mục đã mã hóa, cũng trong Saved Messages.' }),
      el('p', { textContent: `Vault tự khóa sau ${AUTO_LOCK_MIN} phút không dùng. Phiên đăng nhập Telegram được lưu trên thiết bị này — đừng dùng trên máy lạ.` })) });
  }
};

// ---------- xem trước ----------
let vUrl = null, vItem = null;
function canPreview(e) {
  const m = e.mime || '';
  if (e.size > 200 * 1024 * 1024) return false;
  if (/^(image|video|audio)\//.test(m) || /^text\/|json/.test(m)) return true;
  return m === 'application/pdf' && !/Android|iPhone|iPad/.test(navigator.userAgent);
}
function open(e) { canPreview(e) ? preview(e) : download(e); }
async function preview(e) {
  vItem = e; $('#v-title').textContent = e.name;
  $('#v-body').replaceChildren(el('div', { className: 'spinner' })); $('#viewer').showModal();
  S.busy++;
  try {
    const blob = await S.vault.downloadBlob(e.id);
    if (vItem !== e) return;
    vUrl = URL.createObjectURL(blob);
    const m = e.mime; let node;
    if (m.startsWith('image/')) node = el('img', { src: vUrl, alt: e.name });
    else if (m.startsWith('video/')) node = el('video', { src: vUrl, controls: true, autoplay: true, playsInline: true });
    else if (m.startsWith('audio/')) node = el('audio', { src: vUrl, controls: true, autoplay: true });
    else if (m === 'application/pdf') node = el('iframe', { src: vUrl, title: e.name });
    else node = el('pre', { textContent: (await blob.text()).slice(0, 2_000_000) });
    $('#v-body').replaceChildren(node);
  } catch (err) { closeViewer(); toast(errMsg(err), true); }
  finally { S.busy--; }
}
function closeViewer() {
  if ($('#viewer').open) $('#viewer').close();
  $('#v-body').replaceChildren(); if (vUrl) URL.revokeObjectURL(vUrl); vUrl = null; vItem = null;
}
$('#v-close').onclick = closeViewer;
$('#viewer').addEventListener('close', closeViewer);
$('#v-save').onclick = () => { if (vItem) download(vItem); };

// ---------- truyền tải ----------
const queue = []; let running = false;
function transfer(label, up) {
  $('#transfers').hidden = false;
  const ac = new AbortController();
  const bar = el('span'), st = el('span', { className: 'ts muted', textContent: 'Đang chờ' });
  const x = el('button', { className: 'tx', textContent: '✕', title: 'Hủy' }); x.onclick = () => ac.abort();
  const li = el('li', {}, el('div', { className: 't1' }, el('span', { className: 'tn', textContent: (up ? '↑ ' : '↓ ') + label }), el('span', {}, st, x)), el('div', { className: 'bar' }, bar));
  $('#tlist').prepend(li);
  return {
    signal: ac.signal,
    progress(phase, n, t) { const p = t ? Math.round(n / t * 100) : 0; bar.style.width = p + '%'; st.textContent = (phase === 'hash' ? 'Đang kiểm tra ' : '') + `${p}%`; },
    ok(t = 'Xong') { li.className = 'done'; st.textContent = t; x.remove(); },
    fail(t) { li.className = 'err'; st.textContent = t; x.remove(); },
  };
}
$('#btn-tclear').onclick = () => { for (const li of [...$('#tlist').children]) if (li.className) li.remove(); if (!$('#tlist').children.length) $('#transfers').hidden = true; };
function enqueue(job) { queue.push(job); if (!running) pump(); }
async function pump() {
  running = true;
  while (queue.length) {
    const j = queue.shift();
    if (!S.vault) { j.t.fail('Đã khóa'); continue; }
    S.busy++;
    try { await j.run(); } catch (e) { j.t.fail(j.t.signal.aborted ? 'Đã hủy' : errMsg(e)); }
    finally { S.busy--; S.last = Date.now(); }
  }
  running = false;
}

function uploadFiles(files) {
  const folder = S.folder || DEFAULT_FOLDER;
  for (const f of files) {
    const t = transfer(f.name, true);
    enqueue({ t, run: async () => { await S.vault.upload(f, folder, { signal: t.signal, onProgress: (p, n, tot) => t.progress(p, n, tot) }); t.ok(fmtSize(f.size)); } });
  }
}
$('#btn-upload').onclick = () => $('#file-input').click();
$('#file-input').onchange = (e) => { uploadFiles([...e.target.files]); e.target.value = ''; };
const box = $('#content');
box.addEventListener('dragover', (e) => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); box.classList.add('drag'); });
box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove('drag'); });
box.addEventListener('drop', (e) => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); box.classList.remove('drag'); uploadFiles([...e.dataTransfer.files].filter((f) => f.size)); });

async function download(e) {
  if (window.showSaveFilePicker) {
    let fh = null;
    try { fh = await window.showSaveFilePicker({ suggestedName: e.name }); } catch (err) { if (err.name === 'AbortError') return; }
    if (fh) {
      const t = transfer(e.name, false);
      return enqueue({ t, run: async () => {
        const w = await fh.createWritable();
        try { await S.vault.download(e.id, (c) => w.write(c), { signal: t.signal, onProgress: (n, tot) => t.progress('down', n, tot) }); await w.close(); t.ok(); }
        catch (err) { await w.abort().catch(() => {}); throw err; }
      } });
    }
  }
  const t = transfer(e.name, false);
  enqueue({ t, run: async () => {
    const blob = await S.vault.downloadBlob(e.id, { signal: t.signal, onProgress: (n, tot) => t.progress('down', n, tot) });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: e.name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000); t.ok();
  } });
}
async function rename(e) {
  const n = await dialog({ title: 'Đổi tên', input: { value: e.name }, ok: 'Lưu' });
  if (n && n !== e.name) S.vault.rename(e.id, n);
}
async function move(e) {
  const NEW = '＋ Thư mục mới…';
  let f = await dialog({ title: `Chuyển “${e.name}”`, select: { options: [...S.vault.folders().map((x) => x.name), NEW], value: e.folder }, ok: 'Chuyển' });
  if (f === NEW) f = await dialog({ title: 'Thư mục mới', input: { placeholder: 'Tên thư mục' }, ok: 'Tạo & chuyển' });
  if (f && f !== e.folder) S.vault.move(e.id, f);
}
async function remove(e) {
  if (!await dialog({ title: 'Xóa tệp?', body: `Xóa vĩnh viễn “${e.name}” khỏi Telegram? Không khôi phục được.`, ok: 'Xóa', danger: true })) return;
  try { await S.vault.remove(e.id); toast('Đã xóa'); } catch (err) { toast(errMsg(err), true); }
}

// ---------- tự khóa, lưu khi rời trang ----------
for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel']) addEventListener(ev, () => (S.last = Date.now()), { passive: true });
setInterval(() => { if (S.vault && !S.busy && Date.now() - S.last > AUTO_LOCK_MIN * 60000) lock('Vault đã tự khóa sau thời gian không dùng.'); }, 20000);
document.addEventListener('visibilitychange', () => { if (document.hidden && S.vault?.pending) S.vault.flush().catch(() => {}); });
addEventListener('beforeunload', (e) => { if (running || S.vault?.pending) { S.vault?.flush().catch(() => {}); e.preventDefault(); e.returnValue = ''; } });

if ('serviceWorker' in navigator && isSecureContext && !location.search.includes('nosw')) navigator.serviceWorker.register('sw.js').catch(() => {});
$('#btn-mkdir').append(icon('plus'));
$('#btn-lock').prepend(icon('lock'));
$('#search-ic').replaceWith(icon('search', 'search-ic'));
$('#btn-upload').append(icon('upload'), el('span', { textContent: 'Tải lên' }));
window.__tc = { S };
boot();
