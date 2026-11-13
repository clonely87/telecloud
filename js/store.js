// Kho (Vault): chỉ mục mã hóa lưu ngay trong Saved Messages, thay cho SQLite trên máy chủ.
//
//  • Tệp:     caption "TCLOUD1:<id>"     (giống hệt bản Python → hai bản dùng chung dữ liệu)
//  • Chỉ mục: caption "TCLOUDIDX1:<id>"  (tệp TCLOUD1 chứa JSON danh sách tệp/thư mục)
//  Mọi thiết bị đọc cùng chỉ mục nên thấy cùng danh sách. Nếu thiếu, chỉ mục được dựng lại
//  bằng cách đọc metadata trong phần đầu của từng tệp (giống "Khôi phục" của bản Python).
import * as TC from './tcfile.js';

export const DEFAULT_FOLDER = 'Tệp của tôi';
const FILE_RE = /^TCLOUD1:([0-9a-f]{32})$/i;
const IDX_RE = /^TCLOUDIDX1:([0-9a-f]{32})$/i;
const hexId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
const nowIso = () => new Date().toISOString().replace('Z', '+00:00');

export const cleanName = (n, max = 240, fallback = 'tep-tin') =>
  ([...String(n || '').replace(/\\/g, '/').split('/').pop().trim()].filter((c) => c >= ' ' && !'\\/:*?"<>|'.includes(c)).join('').slice(0, max)) || fallback;
export const cleanFolder = (n) => cleanName(n, 80, DEFAULT_FOLDER);

function guessMime(name) {
  const e = name.split('.').pop().toLowerCase();
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
    pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', json: 'application/json', zip: 'application/zip',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })[e] || 'application/octet-stream';
}

async function collect(iter) { const a = []; for await (const x of iter) a.push(x); return TC.concat(...a); }

export class Vault {
  constructor(tg, password) {
    this.tg = tg; this.password = password;
    this.index = { v: 1, files: {}, folders: [DEFAULT_FOLDER] };
    this.indexMsg = null;          // id tin nhắn chỉ mục mới nhất đã đọc
    this.dirty = new Map();        // thay đổi chưa lưu: id → entry | null (xóa)
    this.dirtyFolders = { add: new Set(), del: new Set() };
    this.saving = Promise.resolve(); this.saveTimer = null;
    this.onChange = () => {};
  }

  /**
   * Mở két. Trả về Vault, hoặc ném lỗi "EMPTY" nếu Telegram chưa có dữ liệu TeleCloud nào
   * (khi đó gọi lại với create=true sau khi người dùng xác nhận mật khẩu).
   */
  static async open(tg, password, { create = false, onProgress = () => {} } = {}) {
    onProgress('Đang quét Saved Messages…');
    const scan = await tg.scan((n) => onProgress(`Đang quét Saved Messages… ${n} tin`));
    const { files, idx } = Vault.classify(scan);
    // Thử mật khẩu nguyên gốc, rồi dạng Unicode NFC/NFD (bàn phím tiếng Việt khác nhau giữa máy).
    const variants = [...new Set([password, password.normalize('NFC'), password.normalize('NFD')])];
    let lastErr = null;
    for (const pw of variants) {
      const v = new Vault(tg, pw);
      try {
        if (idx.length) { onProgress('Đang mở chỉ mục…'); await v.#loadIndex(idx[0].id); }
        else if (files.length) {
          // Chưa có chỉ mục: mật khẩu đúng nếu mở được ít nhất 1 trong vài tệp mới nhất
          // (Saved Messages có thể lẫn tệp của két khác).
          onProgress('Đang kiểm tra mật khẩu…');
          let okOne = false, firstErr = null;
          for (const f of files.slice(0, 5)) {
            try { await v.#readMeta(f.id); okOne = true; break; } catch (e) { firstErr ??= e; if (!(e instanceof TC.VaultError)) throw e; }
          }
          if (!okOne) throw firstErr;
        }
        else if (!create) { const e = new Error('EMPTY'); e.code = 'EMPTY'; throw e; }
        await v.#reconcile(files, idx, onProgress);
        return v;
      } catch (e) {
        if (e.code === 'EMPTY') throw e;
        lastErr = e;
        if (!(e instanceof TC.VaultError) || !/Sai mật khẩu/.test(e.message)) throw e;
      }
    }
    throw lastErr;
  }

  static classify(scan) {
    const files = [], idx = [];
    for (const m of scan) {
      let r;
      if ((r = FILE_RE.exec(m.caption))) files.push({ ...m, fileId: r[1].toLowerCase() });
      else if ((r = IDX_RE.exec(m.caption))) idx.push(m);
    }
    files.sort((a, b) => b.id - a.id); idx.sort((a, b) => b.id - a.id);
    return { files, idx };
  }

  async #loadIndex(msgId) {
    const { metadata, data } = await TC.decryptAll(this.password, await collect(this.tg.download(msgId)));
    if (metadata.type !== 'index') throw new TC.VaultError('Tệp chỉ mục không hợp lệ');
    const j = JSON.parse(new TextDecoder().decode(data));
    this.index = { v: 1, files: j.files || {}, folders: j.folders?.length ? j.folders : [DEFAULT_FOLDER] };
    this.indexMsg = msgId;
  }

  /** Đọc metadata chỉ từ ~1 MB đầu của tệp. */
  async #readMeta(msgId) {
    const d = new TC.Decryptor(this.password, { verify: false });
    for await (const piece of this.tg.download(msgId, { maxBytes: TC.firstChunkBytes() })) {
      await d.push(piece);
      if (d.metadata) break;
    }
    if (!d.metadata) throw new TC.VaultError('Không đọc được metadata của tệp');
    return d.metadata;
  }

  /** Đối chiếu chỉ mục với danh sách tin nhắn thật trên Telegram. */
  async #reconcile(files, idx, onProgress) {
    const present = new Map(files.map((f) => [f.fileId, f]));
    let changed = false;
    for (const id of Object.keys(this.index.files)) if (!present.has(id)) { delete this.index.files[id]; changed = true; }
    const missing = files.filter((f) => !this.index.files[f.fileId] || this.index.files[f.fileId].m !== f.id);
    let i = 0;
    for (const f of missing) {
      onProgress(`Đang đọc tệp mới ${++i}/${missing.length}…`);
      try {
        const meta = await this.#readMeta(f.id);
        if (String(meta.id || '').toLowerCase() !== f.fileId) continue;
        const old = this.index.files[f.fileId];
        this.index.files[f.fileId] = {
          m: f.id, name: old?.name || cleanName(meta.name), size: Number(meta.size) || 0,
          mime: String(meta.mime_type || 'application/octet-stream'), sha256: String(meta.sha256 || ''),
          folder: old?.folder || cleanFolder(meta.folder), at: meta.uploaded_at || new Date(f.date * 1000).toISOString(),
        };
        changed = true;
      } catch (e) {
        console.warn('Bỏ qua tệp', f.id, e?.message);     // tệp của két khác (mật khẩu khác) hoặc bị hỏng
      }
    }
    for (const e of Object.values(this.index.files)) if (!this.index.folders.includes(e.folder)) { this.index.folders.push(e.folder); changed = true; }
    if (changed || (!idx.length) || idx.length > 1) await this.#writeIndex(idx.map((x) => x.id));
  }

  async refresh(onProgress = () => {}) {
    const { files, idx } = Vault.classify(await this.tg.scan());
    if (idx[0] && idx[0].id !== this.indexMsg) {
      const keep = this.index; await this.#loadIndex(idx[0].id); this.#applyDirty(keep);
    }
    await this.#reconcile(files, idx, onProgress);
    this.onChange();
  }

  // ---------- truy vấn ----------
  folders() {
    const counts = {};
    for (const e of Object.values(this.index.files)) counts[e.folder] = (counts[e.folder] || 0) + 1;
    return this.index.folders.map((name) => ({ name, count: counts[name] || 0 }));
  }

  list(folder = null, q = '') {
    const s = q.trim().toLocaleLowerCase('vi');
    return Object.entries(this.index.files)
      .map(([id, e]) => ({ id, ...e }))
      .filter((e) => (!folder || e.folder === folder) && (!s || e.name.toLocaleLowerCase('vi').includes(s)))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  stats() {
    const all = Object.values(this.index.files);
    return { count: all.length, bytes: all.reduce((n, e) => n + e.size, 0) };
  }

  // ---------- thao tác ----------
  #set(id, entry) {
    if (entry) this.index.files[id] = entry; else delete this.index.files[id];
    this.dirty.set(id, entry ? { ...entry } : null);
    this.#scheduleSave();
    this.onChange();
  }

  async upload(file, folder, { onProgress = () => {}, signal } = {}) {
    if (!file.size) throw new Error('Không thể tải lên tệp rỗng.');
    if (file.size > 1_900_000_000) throw new Error('Tệp vượt giới hạn 1,9 GB.');
    const name = cleanName(file.name);
    folder = cleanFolder(folder);
    onProgress('hash', 0, file.size);
    const sha256 = await TC.sha256Blob(file, (n) => onProgress('hash', n, file.size));
    if (signal?.aborted) throw new Error('Đã hủy');
    const id = hexId(), at = nowIso(), mime = file.type || guessMime(name);
    const meta = { version: 1, id, name, size: file.size, mime_type: mime, sha256, folder, uploaded_at: at };
    const enc = await TC.encrypt(this.password, meta, file);
    const m = await this.tg.upload({ name: `tc_${id}.tcv`, size: enc.size, parts: enc.parts, caption: `TCLOUD1:${id}`,
      signal, onProgress: (n, t) => onProgress('up', Math.round(n / t * file.size), file.size) });
    if (!this.index.folders.includes(folder)) this.#addFolder(folder);
    this.#set(id, { m, name, size: file.size, mime, sha256, folder, at });
    return id;
  }

  /** Giải mã từng khối đã xác thực rồi gọi write(chunk). Kiểm tra SHA-256 ở cuối. */
  async download(id, write, { onProgress = () => {}, signal } = {}) {
    const e = this.index.files[id];
    if (!e) throw new Error('Không tìm thấy tệp trong chỉ mục');
    const d = new TC.Decryptor(this.password);
    for await (const piece of this.tg.download(e.m, { signal })) {
      for (const c of await d.push(piece)) { await write(c); }
      onProgress(d.outSize, e.size);
    }
    return d.finish();
  }

  async downloadBlob(id, opts) {
    const parts = [];
    await this.download(id, (c) => parts.push(c), opts);
    return new Blob(parts, { type: this.index.files[id].mime });
  }

  async remove(id) {
    const e = this.index.files[id];
    if (!e) return;
    await this.tg.remove([e.m]);
    this.#set(id, null);
  }

  rename(id, name) { const e = this.index.files[id]; this.#set(id, { ...e, name: cleanName(name) }); }
  move(id, folder) { folder = cleanFolder(folder); if (!this.index.folders.includes(folder)) this.#addFolder(folder); const e = this.index.files[id]; this.#set(id, { ...e, folder }); }

  #addFolder(name) { this.index.folders.push(name); this.dirtyFolders.add.add(name); this.dirtyFolders.del.delete(name); }
  createFolder(name) {
    name = cleanFolder(name);
    if (this.index.folders.some((f) => f.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'))) throw new Error('Thư mục đã tồn tại.');
    this.#addFolder(name); this.#scheduleSave(); this.onChange(); return name;
  }
  deleteFolder(name) {
    if (name === DEFAULT_FOLDER) throw new Error('Không thể xóa thư mục mặc định.');
    if (Object.values(this.index.files).some((e) => e.folder === name)) throw new Error('Thư mục vẫn còn tệp. Hãy chuyển hoặc xóa tệp trước.');
    this.index.folders = this.index.folders.filter((f) => f !== name);
    this.dirtyFolders.del.add(name); this.dirtyFolders.add.delete(name);
    this.#scheduleSave(); this.onChange();
  }

  // ---------- lưu chỉ mục ----------
  #applyDirty(fromIndex) {
    for (const [id, e] of this.dirty) { if (e) this.index.files[id] = e; else delete this.index.files[id]; }
    for (const f of this.dirtyFolders.add) if (!this.index.folders.includes(f)) this.index.folders.push(f);
    this.index.folders = this.index.folders.filter((f) => !this.dirtyFolders.del.has(f));
    void fromIndex;
  }

  #scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush().catch((e) => console.error('Lưu chỉ mục lỗi', e)), 1500);
  }

  get pending() { return this.dirty.size > 0 || this.dirtyFolders.add.size > 0 || this.dirtyFolders.del.size > 0; }

  /** Lưu ngay các thay đổi (gộp với chỉ mục mới hơn do thiết bị khác ghi, nếu có). */
  flush() {
    clearTimeout(this.saveTimer);
    this.saving = this.saving.catch(() => {}).then(async () => {
      if (!this.pending) return;
      const { idx } = Vault.classify(await this.tg.scan());
      if (idx[0] && idx[0].id !== this.indexMsg) { await this.#loadIndex(idx[0].id); this.#applyDirty(); }
      await this.#writeIndex(idx.map((x) => x.id));
      this.onChange();
    });
    return this.saving;
  }

  async #writeIndex(oldIds) {
    const body = new TextEncoder().encode(JSON.stringify({ v: 1, updated: nowIso(), files: this.index.files, folders: this.index.folders }));
    const blob = new Blob([body]);
    const id = hexId();
    const meta = { version: 1, id, type: 'index', name: 'telecloud-index.json', size: body.length, mime_type: 'application/json',
      sha256: await TC.sha256Blob(blob), folder: '', uploaded_at: nowIso() };
    const enc = await TC.encrypt(this.password, meta, blob);
    const msg = await this.tg.upload({ name: `tcidx_${id}.tcv`, size: enc.size, parts: enc.parts, caption: `TCLOUDIDX1:${id}` });
    this.indexMsg = msg;
    this.dirty.clear(); this.dirtyFolders.add.clear(); this.dirtyFolders.del.clear();
    const stale = oldIds.filter((x) => x !== msg);
    if (stale.length) await this.tg.remove(stale).catch(() => {});
  }
}
