// Telegram giả lập cho kiểm thử: cùng giao diện với js/tg.js, lưu "Saved Messages" trên máy chủ thử nghiệm.
export function friendlyError(e) { return e?.errorMessage || e?.message || String(e); }
const api = (p, o) => fetch('/__tg/' + p, o).then(async (r) => { if (!r.ok) throw Object.assign(new Error((await r.text()) || r.status), { errorMessage: await Promise.resolve('') }); return r; });
export async function createTelegram({ apiId, apiHash, session = '' }) {
  if (apiHash.length !== 32) throw Object.assign(new Error('API_ID_INVALID'), { errorMessage: 'API_ID_INVALID' });
  let authed = session === 'mock-session';
  return {
    session: () => (authed ? 'mock-session' : ''),
    authorized: async () => authed,
    me: async () => ({ name: 'Lâm Đăng Huy' }),
    sendCode: async (p) => { if (!/^\+\d{9,}$/.test(p.replace(/\s/g, ''))) throw Object.assign(new Error('PHONE_NUMBER_INVALID'), { errorMessage: 'PHONE_NUMBER_INVALID' }); return { viaApp: true }; },
    signIn: async (code) => { if (code.trim() !== '12345') throw Object.assign(new Error('PHONE_CODE_INVALID'), { errorMessage: 'PHONE_CODE_INVALID' }); return 'password'; },
    signInPassword: async (pw) => { if (pw !== 'mat-khau-2fa') throw Object.assign(new Error('PASSWORD_HASH_INVALID'), { errorMessage: 'PASSWORD_HASH_INVALID' }); authed = true; },
    scan: async () => (await api('scan')).json(),
    async upload({ name, size, parts, caption, onProgress = () => {} }) {
      const chunks = []; let n = 0;
      for await (const p of parts) { chunks.push(p); n += p.length; onProgress(n, size); }
      if (n !== size) throw new Error(`size mismatch ${n}/${size}`);
      return (await (await api(`upload?caption=${encodeURIComponent(caption)}&name=${encodeURIComponent(name)}`, { method: 'POST', body: new Blob(chunks) })).json()).id;
    },
    async *download(id, { maxBytes } = {}) {
      const r = await api(`file/${id}${maxBytes ? '?max=' + maxBytes : ''}`);
      const reader = r.body.getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; yield value; }
    },
    remove: async (ids) => { await api('delete', { method: 'POST', body: JSON.stringify(ids) }); },
    logout: async () => { authed = false; },
    disconnect: async () => {},
  };
}
