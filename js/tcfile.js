// Định dạng file TeleCloud "TCLOUD1" — tương thích 100% với telecloud/crypto.py
//
//  header (47 byte, big-endian) = "TCLOUD1"(7) | salt(16) | nonce_prefix(8) | chunk_size u32 | plain_length u64 | metadata_length u32
//  rồi lặp: u32 độ_dài | AES-256-GCM(khối)        (khối = phần của [metadata JSON + nội dung file])
//  khóa  = scrypt(mật khẩu, salt, N=2^15, r=8, p=1)
//  nonce = nonce_prefix | u32 chỉ số khối
//  AAD   = "telecloud-encrypted-file-v1" | header | u32 chỉ số khối
import { Sha256 } from './sha256.js';
import { deriveKey } from './kdf.js';

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
export const MAGIC = te.encode('TCLOUD1');
export const HEADER_SIZE = 47;
export const TAG = 16;
export const CHUNK_SIZE = 1024 * 1024;
const LABEL = te.encode('telecloud-encrypted-file-v1');

export class VaultError extends Error { constructor(m) { super(m); this.name = 'VaultError'; } }

const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
function concat(...a) { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; }
const nonce = (prefix, i) => concat(prefix, u32(i));
const aad = (header, i) => concat(LABEL, header, u32(i));

async function aesKey(raw) { return subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); }

/** Kích thước file mã hóa, tính trước (cần cho tải lên Telegram theo phần). */
export function encryptedSize(plainLength, chunkSize = CHUNK_SIZE) {
  const n = Math.ceil(plainLength / chunkSize);
  return HEADER_SIZE + plainLength + n * (4 + TAG);
}

/** Băm SHA-256 một File/Blob theo từng phần. */
export async function sha256Blob(blob, onProgress = () => {}, step = 4 * 1024 * 1024) {
  const h = new Sha256();
  for (let off = 0; off < blob.size; off += step) {
    h.update(new Uint8Array(await blob.slice(off, off + step).arrayBuffer()));
    onProgress(Math.min(blob.size, off + step));
  }
  return h.hex();
}

/**
 * Mã hóa: trả về { size, parts } — parts là async generator các Uint8Array (không đọc cả file vào RAM).
 * `blob` có thể rỗng (dùng cho file chỉ mục, nội dung nằm trong `extra`).
 */
export async function encrypt(password, metadata, blob, chunkSize = CHUNK_SIZE) {
  const meta = te.encode(JSON.stringify(metadata));
  if (meta.length > 64 * 1024) throw new VaultError('Metadata quá lớn');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prefix = crypto.getRandomValues(new Uint8Array(8));
  const plainLength = meta.length + blob.size;
  const header = new Uint8Array(HEADER_SIZE);
  header.set(MAGIC, 0); header.set(salt, 7); header.set(prefix, 23);
  const dv = new DataView(header.buffer);
  dv.setUint32(31, chunkSize); dv.setBigUint64(35, BigInt(plainLength)); dv.setUint32(43, meta.length);
  const key = await aesKey(await deriveKey(password, salt));
  async function* parts() {
    yield header;
    let index = 0, pending = meta, fileOff = 0;
    const READ = 4 * 1024 * 1024;
    while (pending.length || fileOff < blob.size) {
      while (pending.length < chunkSize && fileOff < blob.size) {
        const piece = new Uint8Array(await blob.slice(fileOff, Math.min(blob.size, fileOff + READ)).arrayBuffer());
        fileOff += piece.length;
        pending = pending.length ? concat(pending, piece) : piece;
      }
      while (pending.length >= chunkSize || (fileOff >= blob.size && pending.length)) {
        const plain = pending.subarray(0, Math.min(chunkSize, pending.length));
        pending = pending.subarray(plain.length);
        const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce(prefix, index), additionalData: aad(header, index) }, key, plain));
        yield concat(u32(ct.length), ct);
        index++;
      }
    }
  }
  return { size: encryptedSize(plainLength, chunkSize), parts: parts() };
}

/** Giải mã theo luồng. push(bytes) → các khối nội dung đã xác thực. Đọc metadata ở khối đầu. */
export class Decryptor {
  constructor(password, { verify = true } = {}) {
    this.password = password; this.verify = verify;
    this.buf = new Uint8Array(0); this.header = null; this.index = 0; this.plainDone = 0;
    this.metaBuf = new Uint8Array(0); this.metadata = null; this.hash = new Sha256(); this.outSize = 0;
  }
  #take(n) { const o = this.buf.subarray(0, n); this.buf = this.buf.subarray(n); return o; }
  async #readHeader() {
    const h = this.#take(HEADER_SIZE).slice();
    for (let i = 0; i < 7; i++) if (h[i] !== MAGIC[i]) throw new VaultError('Định dạng tệp không được hỗ trợ');
    const dv = new DataView(h.buffer);
    this.chunkSize = dv.getUint32(31); this.plainLength = Number(dv.getBigUint64(35)); this.metaLength = dv.getUint32(43);
    if (this.chunkSize < 64 * 1024 || this.chunkSize > 4 * 1024 * 1024) throw new VaultError('Kích thước khối không hợp lệ');
    if (this.metaLength <= 0 || this.metaLength > 65536 || this.metaLength > this.plainLength) throw new VaultError('Metadata không hợp lệ');
    this.header = h; this.prefix = h.slice(23, 31);
    this.key = await aesKey(await deriveKey(this.password, h.slice(7, 23)));
  }
  async push(bytes) {
    this.buf = this.buf.length ? concat(this.buf, bytes) : bytes;
    const out = [];
    if (!this.header) { if (this.buf.length < HEADER_SIZE) return out; await this.#readHeader(); }
    while (this.plainDone < this.plainLength && this.buf.length >= 4) {
      const expected = Math.min(this.chunkSize, this.plainLength - this.plainDone);
      const len = new DataView(this.buf.buffer, this.buf.byteOffset, 4).getUint32(0);
      if (len !== expected + TAG) throw new VaultError('Kích thước khối trong tệp không khớp');
      if (this.buf.length < 4 + len) break;
      this.#take(4);
      const ct = this.#take(len);
      let plain;
      try { plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce(this.prefix, this.index), additionalData: aad(this.header, this.index) }, this.key, ct)); }
      catch { throw new VaultError(this.index === 0 ? 'Sai mật khẩu Vault hoặc tệp bị thay đổi' : 'Tệp bị hỏng hoặc đã bị thay đổi'); }
      this.index++; this.plainDone += plain.length;
      let payload = plain;
      if (!this.metadata) {
        const need = this.metaLength - this.metaBuf.length;
        this.metaBuf = concat(this.metaBuf, plain.subarray(0, need));
        payload = plain.subarray(Math.min(need, plain.length));
        if (this.metaBuf.length === this.metaLength) {
          try { this.metadata = JSON.parse(new TextDecoder().decode(this.metaBuf)); } catch { throw new VaultError('Metadata trong tệp bị lỗi'); }
        }
      }
      if (payload.length) { if (this.verify) this.hash.update(payload); this.outSize += payload.length; out.push(payload); }
    }
    return out;
  }
  get complete() { return this.header && this.plainDone === this.plainLength; }
  finish() {
    if (!this.complete) throw new VaultError('Tệp mã hóa bị cắt cụt');
    if (this.buf.length) throw new VaultError('Tệp có dữ liệu thừa sau phần mã hóa');
    const m = this.metadata;
    if (!m) throw new VaultError('Không tìm thấy metadata');
    if (m.size != null && Number(m.size) !== this.outSize) throw new VaultError('Kích thước sau giải mã không khớp');
    if (this.verify && m.sha256 && this.hash.hex() !== String(m.sha256).toLowerCase()) throw new VaultError('Kiểm tra SHA-256 thất bại');
    return m;
  }
}

/** Số byte đầu cần tải để đọc được metadata (header + khối đầu). */
export const firstChunkBytes = (chunkSize = CHUNK_SIZE) => HEADER_SIZE + 4 + chunkSize + TAG;

export async function decryptAll(password, bytes) {
  const d = new Decryptor(password);
  const parts = await d.push(bytes);
  const meta = d.finish();
  return { metadata: meta, data: concat(...parts) };
}
export { concat };
