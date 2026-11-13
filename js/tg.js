// Kết nối Telegram trực tiếp từ trình duyệt (MTProto qua WebSocket) — thay cho telegram_store.py.
import { loadGram } from './gram.js';

const PART = 512 * 1024;              // kích thước phần tải lên/tải xuống
const BIG = 10 * 1024 * 1024;         // > 10 MB dùng SaveBigFilePart
const PARALLEL = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function friendlyError(e) {
  const code = e?.errorMessage || e?.message || String(e);
  const map = {
    PHONE_NUMBER_INVALID: 'Số điện thoại không hợp lệ. Nhập kèm mã quốc gia, ví dụ +84912345678.',
    PHONE_CODE_INVALID: 'Mã xác minh không đúng.',
    PHONE_CODE_EXPIRED: 'Mã xác minh đã hết hạn, hãy yêu cầu mã mới.',
    PASSWORD_HASH_INVALID: 'Mật khẩu xác minh 2 bước của Telegram không đúng.',
    API_ID_INVALID: 'API ID hoặc API Hash không đúng. Kiểm tra lại tại my.telegram.org.',
    API_ID_PUBLISHED_FLOOD: 'API ID này bị Telegram hạn chế. Hãy tạo API ID khác.',
    AUTH_KEY_UNREGISTERED: 'Phiên đăng nhập Telegram đã hết hiệu lực. Hãy đăng nhập lại.',
    SESSION_REVOKED: 'Phiên đăng nhập đã bị thu hồi. Hãy đăng nhập lại.',
    FILE_REFERENCE_EXPIRED: 'Liên kết tệp đã hết hạn, hãy thử lại.',
  };
  if (map[code]) return map[code];
  if (/FLOOD_WAIT/.test(code)) return `Telegram yêu cầu chờ ${e.seconds || '?'} giây rồi thử lại.`;
  return code;
}

export async function createTelegram({ apiId, apiHash, session = '' }) {
  const m = await loadGram();
  const { TelegramClient, Api } = m;
  const creds = { apiId: Number(apiId), apiHash };
  const client = new TelegramClient(new m.sessions.StringSession(session), creds.apiId, apiHash, {
    useWSS: true, connectionRetries: 5, autoReconnect: true, deviceModel: 'TeleCloud Web', appVersion: '0.4.0',
  });
  client.setLogLevel('error');
  await client.connect();
  let phone = null, phoneCodeHash = null;

  const invokeRetry = async (req, tries = 5) => {
    for (let i = 0; ; i++) {
      try { return await client.invoke(req); }
      catch (e) {
        const code = e?.errorMessage || '';
        if (/FLOOD_WAIT/.test(code) && i < tries) { await sleep(((e.seconds || 5) + 1) * 1000); continue; }
        if (i < tries && !code) { await sleep(1500 * (i + 1)); continue; }   // lỗi mạng
        throw e;
      }
    }
  };

  return {
    session: () => client.session.save(),
    authorized: () => client.checkAuthorization(),

    async me() {
      const u = await client.getMe();
      return { name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || 'Telegram' };
    },

    async sendCode(p) {
      phone = p.replace(/[\s.-]/g, '');
      const r = await client.sendCode(creds, phone);
      phoneCodeHash = r.phoneCodeHash;
      return { viaApp: r.isCodeViaApp };
    },

    async signIn(code) {
      try {
        const r = await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code.trim() }));
        if (r instanceof Api.auth.AuthorizationSignUpRequired) throw new Error('Số điện thoại này chưa có tài khoản Telegram.');
        return 'ok';
      } catch (e) {
        if (e?.errorMessage === 'SESSION_PASSWORD_NEEDED') return 'password';
        throw e;
      }
    },

    async signInPassword(pw) {
      let err = null;
      try {
        await client.signInWithPassword(creds, { password: async () => pw, onError: async (e) => { err = e; return true; } });
      } catch (e) { throw err || e; }
    },

    /** Liệt kê mọi tin nhắn có tệp trong Saved Messages: [{id, caption, size, date}] */
    async scan(onProgress = () => {}) {
      const out = [];
      for await (const msg of client.iterMessages('me', { filter: new Api.InputMessagesFilterDocument() })) {
        const doc = msg.media?.document;
        out.push({ id: msg.id, caption: (msg.message || '').trim(), size: doc ? Number(doc.size) : 0, date: msg.date });
        if (out.length % 100 === 0) onProgress(out.length);
      }
      return out;
    },

    /** Tải lên theo luồng (không giữ cả tệp trong RAM). Trả về id tin nhắn. */
    async upload({ name, size, parts, caption, onProgress = () => {}, signal }) {
      const fileId = m.helpers.generateRandomLong();
      const big = size > BIG;
      const total = Math.ceil(size / PART);
      let sent = 0, index = 0, buf = new Uint8Array(0);
      const inflight = new Set();
      const sendPart = async (i, bytes) => {
        const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        await invokeRetry(big
          ? new Api.upload.SaveBigFilePart({ fileId, filePart: i, fileTotalParts: total, bytes: b })
          : new Api.upload.SaveFilePart({ fileId, filePart: i, bytes: b }));
        sent += bytes.length; onProgress(sent, size);
      };
      const queue = async (bytes) => {
        if (signal?.aborted) throw new Error('Đã hủy');
        const p = sendPart(index++, bytes).finally(() => inflight.delete(p));
        inflight.add(p);
        if (inflight.size >= PARALLEL) await Promise.race(inflight);
      };
      for await (const piece of parts) {
        buf = buf.length ? concat(buf, piece) : piece;
        while (buf.length >= PART) { await queue(buf.slice(0, PART)); buf = buf.subarray(PART); }
      }
      if (buf.length) await queue(buf.slice());
      await Promise.all(inflight);
      if (index !== total) throw new Error(`Số phần tải lên không khớp (${index}/${total})`);
      const file = big ? new Api.InputFileBig({ id: fileId, parts: total, name })
        : new Api.InputFile({ id: fileId, parts: total, name, md5Checksum: '' });
      const randomId = m.helpers.generateRandomLong();
      const res = await invokeRetry(new Api.messages.SendMedia({
        peer: new Api.InputPeerSelf(), randomId, silent: true, message: caption,
        media: new Api.InputMediaUploadedDocument({
          file, mimeType: 'application/octet-stream', forceFile: true,
          attributes: [new Api.DocumentAttributeFilename({ fileName: name })],
        }),
      }), 2);
      for (const u of res.updates || []) {
        if (u instanceof Api.UpdateMessageID) return u.id;
        if (u instanceof Api.UpdateNewMessage && u.message?.message === caption) return u.message.id;
      }
      throw new Error('Telegram không trả về mã tin nhắn sau khi tải lên');
    },

    /** Tải xuống theo luồng: async iterator các Uint8Array. maxBytes để chỉ lấy phần đầu. */
    async *download(msgId, { maxBytes, signal } = {}) {
      const [msg] = await client.getMessages('me', { ids: [msgId] });
      if (!msg?.media?.document) throw new Error('Không tìm thấy tệp trên Telegram — có thể tin nhắn đã bị xóa.');
      const limit = maxBytes ? Math.ceil(maxBytes / PART) : undefined;
      for await (const chunk of client.iterDownload({ file: msg.media, requestSize: PART, limit })) {
        if (signal?.aborted) throw new Error('Đã hủy');
        yield new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      }
    },

    async remove(ids) { if (ids.length) await client.deleteMessages('me', ids, { revoke: true }); },

    async logout() {
      try { await client.invoke(new Api.auth.LogOut()); } catch { /* bỏ qua */ }
      await client.disconnect().catch(() => {});
    },
    disconnect: () => client.disconnect().catch(() => {}),
  };
}

function concat(a, b) { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }
