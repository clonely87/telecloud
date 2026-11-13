// scrypt (RFC 7914) — trùng tham số với bản Python: N=2^15, r=8, p=1, 32 byte.
// PBKDF2-HMAC-SHA256 dùng WebCrypto; phần ROMix viết bằng JS.
const subtle = globalThis.crypto.subtle;

async function pbkdf2(password, salt, len) {
  const key = await subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1 }, key, len * 8));
}

function salsa208(B, x) {
  for (let i = 0; i < 16; i++) x[i] = B[i];
  for (let i = 0; i < 8; i += 2) {
    let t;
    t = x[0] + x[12]; x[4] ^= (t << 7) | (t >>> 25); t = x[4] + x[0]; x[8] ^= (t << 9) | (t >>> 23);
    t = x[8] + x[4]; x[12] ^= (t << 13) | (t >>> 19); t = x[12] + x[8]; x[0] ^= (t << 18) | (t >>> 14);
    t = x[5] + x[1]; x[9] ^= (t << 7) | (t >>> 25); t = x[9] + x[5]; x[13] ^= (t << 9) | (t >>> 23);
    t = x[13] + x[9]; x[1] ^= (t << 13) | (t >>> 19); t = x[1] + x[13]; x[5] ^= (t << 18) | (t >>> 14);
    t = x[10] + x[6]; x[14] ^= (t << 7) | (t >>> 25); t = x[14] + x[10]; x[2] ^= (t << 9) | (t >>> 23);
    t = x[2] + x[14]; x[6] ^= (t << 13) | (t >>> 19); t = x[6] + x[2]; x[10] ^= (t << 18) | (t >>> 14);
    t = x[15] + x[11]; x[3] ^= (t << 7) | (t >>> 25); t = x[3] + x[15]; x[7] ^= (t << 9) | (t >>> 23);
    t = x[7] + x[3]; x[11] ^= (t << 13) | (t >>> 19); t = x[11] + x[7]; x[15] ^= (t << 18) | (t >>> 14);
    t = x[0] + x[3]; x[1] ^= (t << 7) | (t >>> 25); t = x[1] + x[0]; x[2] ^= (t << 9) | (t >>> 23);
    t = x[2] + x[1]; x[3] ^= (t << 13) | (t >>> 19); t = x[3] + x[2]; x[0] ^= (t << 18) | (t >>> 14);
    t = x[5] + x[4]; x[6] ^= (t << 7) | (t >>> 25); t = x[6] + x[5]; x[7] ^= (t << 9) | (t >>> 23);
    t = x[7] + x[6]; x[4] ^= (t << 13) | (t >>> 19); t = x[4] + x[7]; x[5] ^= (t << 18) | (t >>> 14);
    t = x[10] + x[9]; x[11] ^= (t << 7) | (t >>> 25); t = x[11] + x[10]; x[8] ^= (t << 9) | (t >>> 23);
    t = x[8] + x[11]; x[9] ^= (t << 13) | (t >>> 19); t = x[9] + x[8]; x[10] ^= (t << 18) | (t >>> 14);
    t = x[15] + x[14]; x[12] ^= (t << 7) | (t >>> 25); t = x[12] + x[15]; x[13] ^= (t << 9) | (t >>> 23);
    t = x[13] + x[12]; x[14] ^= (t << 13) | (t >>> 19); t = x[14] + x[13]; x[15] ^= (t << 18) | (t >>> 14);
  }
  for (let i = 0; i < 16; i++) B[i] = (B[i] + x[i]) | 0;
}

function blockMix(B, Y, r, x, tmp) {
  // X = B[2r-1]
  tmp.set(B.subarray((2 * r - 1) * 16, 2 * r * 16));
  for (let i = 0; i < 2 * r; i++) {
    for (let j = 0; j < 16; j++) tmp[j] ^= B[i * 16 + j];
    salsa208(tmp, x);
    // Y: chẵn vào nửa đầu, lẻ vào nửa sau
    const dst = (i & 1) ? (r + (i >> 1)) * 16 : (i >> 1) * 16;
    Y.set(tmp, dst);
  }
}

function romix(B32, N, r) {
  const len = 32 * r;
  const V = new Int32Array(len * N);
  const X = new Int32Array(len), Y = new Int32Array(len), x = new Int32Array(16), tmp = new Int32Array(16);
  X.set(B32);
  for (let i = 0; i < N; i++) { V.set(X, i * len); blockMix(X, Y, r, x, tmp); X.set(Y); }
  for (let i = 0; i < N; i++) {
    const j = X[(2 * r - 1) * 16] & (N - 1);
    for (let k = 0; k < len; k++) X[k] ^= V[j * len + k];
    blockMix(X, Y, r, x, tmp); X.set(Y);
  }
  B32.set(X);
}

/** scrypt(password: Uint8Array, salt: Uint8Array) → Uint8Array(dkLen) */
export async function scrypt(password, salt, N = 32768, r = 8, p = 1, dkLen = 32) {
  const B = await pbkdf2(password, salt, p * 128 * r);
  for (let i = 0; i < p; i++) {
    const chunk = B.subarray(i * 128 * r, (i + 1) * 128 * r);
    // little-endian Int32 view
    const B32 = new Int32Array(32 * r);
    const dv = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    for (let k = 0; k < 32 * r; k++) B32[k] = dv.getInt32(k * 4, true);
    romix(B32, N, r);
    for (let k = 0; k < 32 * r; k++) dv.setInt32(k * 4, B32[k], true);
  }
  return pbkdf2(password, B, dkLen);
}
