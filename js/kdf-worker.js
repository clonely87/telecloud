import { scrypt } from './scrypt.js';
const te = new TextEncoder();
self.onmessage = async (e) => {
  try { self.postMessage({ id: e.data.id, key: await scrypt(te.encode(e.data.password), e.data.salt) }); }
  catch (err) { self.postMessage({ id: e.data.id, error: String(err?.message || err) }); }
};
