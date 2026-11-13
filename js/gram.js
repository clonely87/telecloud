// Nạp thư viện Telegram GramJS 2.26.22 trực tiếp trong trình duyệt (không cần máy chủ, không cần build).
// Mã nguồn CommonJS lấy từ jsDelivr, các thư viện phụ lấy từ esm.sh, phiên bản cố định.
// Service worker lưu đệm các file này nên chỉ tải ở lần mở đầu tiên.
const VER = '2.26.22';
const BASE = `https://cdn.jsdelivr.net/npm/telegram@${VER}`;
const FILES = ('/client/2fa.js,/client/account.js,/client/auth.js,/client/bots.js,/client/buttons.js,/client/chats.js,/client/dialogs.js,/client/downloads.js,/client/fs.js,/client/index.js,/client/messageParse.js,/client/messages.js,/client/os.js,/client/path.js,/client/telegramBaseClient.js,/client/TelegramClient.js,/client/updates.js,/client/uploads.js,/client/users.js,/crypto/AuthKey.js,/crypto/converters.js,/crypto/crypto.js,/crypto/CTR.js,/crypto/Factorizator.js,/crypto/IGE.js,/crypto/RSA.js,/crypto/words.js,/CryptoFile.js,/entityCache.js,/errors/Common.js,/errors/index.js,/errors/RPCBaseErrors.js,/errors/RPCErrorList.js,/events/Album.js,/events/CallbackQuery.js,/events/common.js,/events/DeletedMessage.js,/events/EditedMessage.js,/events/index.js,/events/NewMessage.js,/events/Raw.js,/extensions/AsyncQueue.js,/extensions/BinaryReader.js,/extensions/BinaryWriter.js,/extensions/Deferred.js,/extensions/html.js,/extensions/index.js,/extensions/Logger.js,/extensions/markdown.js,/extensions/markdownv2.js,/extensions/MessagePacker.js,/extensions/net.js,/extensions/PendingState.js,/extensions/PromisedNetSockets.js,/extensions/PromisedWebSockets.js,/extensions/socks.js,/Helpers.js,/index.js,/inspect.js,/network/Authenticator.js,/network/connection/Connection.js,/network/connection/index.js,/network/connection/TCPAbridged.js,/network/connection/TCPFull.js,/network/connection/TCPMTProxy.js,/network/connection/TCPObfuscated.js,/network/index.js,/network/MTProtoPlainSender.js,/network/MTProtoSender.js,/network/MTProtoState.js,/network/RequestState.js,/Password.js,/platform.js,/requestIter.js,/sessions/Abstract.js,/sessions/CacheApiSession.js,/sessions/index.js,/sessions/localStorage.js,/sessions/Memory.js,/sessions/StoreSession.js,/sessions/StringSession.js,/tl/AllTLObjects.js,/tl/api.js,/tl/apiTl.js,/tl/core/GZIPPacked.js,/tl/core/index.js,/tl/core/MessageContainer.js,/tl/core/RPCResult.js,/tl/core/TLMessage.js,/tl/custom/button.js,/tl/custom/chatGetter.js,/tl/custom/dialog.js,/tl/custom/draft.js,/tl/custom/file.js,/tl/custom/forward.js,/tl/custom/index.js,/tl/custom/inlineResult.js,/tl/custom/inlineResults.js,/tl/custom/message.js,/tl/custom/messageButton.js,/tl/custom/senderGetter.js,/tl/generationHelpers.js,/tl/index.js,/tl/MTProtoRequest.js,/tl/patched/index.js,/tl/schemaTl.js,/Utils.js,/Version.js').split(',');

let loading = null;

export function loadGram(onProgress = () => {}) {
  loading ??= (async () => {
    const src = {};
    let done = 0;
    await Promise.all(FILES.map(async (f) => {
      const r = await fetch(BASE + f);
      if (!r.ok) throw new Error(`Không tải được thư viện Telegram (${f}: ${r.status})`);
      src[f] = await r.text();
      onProgress(++done, FILES.length);
    }));
    const esm = (s) => import(`https://esm.sh/${s}`);
    const cjs = async (s) => { const ns = await esm(s); return ns.default ?? ns; };
    const [buffer, mutex, bigInt, aes, pako, store2, tce, mime, path] = await Promise.all([
      esm('buffer@6.0.3'), cjs('async-mutex@0.3.2'), cjs('big-integer@1.6.52'), esm('@cryptography/aes@0.1.1'),
      cjs('pako@2.1.0'), cjs('store2@2.14.3'), esm('ts-custom-error@3.3.1'), cjs('mime@3.0.0'), cjs('path-browserify@1.0.1')]);
    globalThis.Buffer ??= buffer.Buffer;
    const ext = {
      buffer, 'async-mutex': mutex, 'big-integer': bigInt, '@cryptography/aes': Object.assign({ __esModule: true }, aes),
      pako, store2, 'ts-custom-error': tce, mime, path,
      websocket: { w3cwebsocket: WebSocket },
      htmlparser2: { Parser: class {} },
      os: { type: () => 'Browser', release: () => '1.0', hostname: () => 'web' },
      net: {}, socks: {}, fs: {}, 'node-localstorage': { LocalStorage: class {} },
      util: { inspect: { custom: Symbol.for('nodejs.util.inspect.custom') } },
    };
    const cache = {};
    const resolve = (from, spec) => {
      const parts = from.split('/').filter(Boolean); parts.pop();
      for (const p of spec.split('/')) { if (p === '..') parts.pop(); else if (p && p !== '.') parts.push(p); }
      const base = '/' + parts.join('/');
      for (const c of [base, base + '.js', (base === '/' ? '' : base) + '/index.js']) if (c in src) return c;
      throw new Error(`GramJS: không tìm thấy ${spec} từ ${from}`);
    };
    const req = (from, spec) => {
      if (spec === 'crypto') spec = '/crypto/crypto';      // dùng bộ mã hóa riêng của GramJS cho trình duyệt
      if (!spec.startsWith('.') && !spec.startsWith('/')) {
        if (spec in ext) return ext[spec];
        throw new Error(`GramJS: thiếu thư viện ${spec}`);
      }
      const id = resolve(from, spec);
      if (cache[id]) return cache[id].exports;
      const module = { exports: {} };
      cache[id] = module;
      // eslint-disable-next-line no-new-func
      new Function('exports', 'require', 'module', '__filename', '__dirname', `${src[id]}\n//# sourceURL=gramjs${id}`)
        .call(module.exports, module.exports, (s) => req(id, s), module, id, id.replace(/\/[^/]*$/, ''));
      return module.exports;
    };
    return req('/_.js', './index.js');
  })();
  loading.catch(() => { loading = null; });
  return loading;
}
