# TeleCloud Web — dùng trên máy tính và Android, không cần máy chủ

Đây là bản TeleCloud chạy **hoàn toàn trong trình duyệt**. Máy tính và điện thoại đều kết nối **thẳng tới Telegram**, nên không cần bật máy Windows, không cần Tailscale, không cần Python.

- Mã hóa **giống hệt** bản Python (AES-256-GCM, khóa scrypt từ mật khẩu Vault). Hai bản dùng chung dữ liệu: mở web app bằng **mật khẩu Vault cũ** là thấy các tệp đã tải lên trước đây.
- Danh sách tệp và thư mục được lưu thành **một tệp chỉ mục đã mã hóa** ngay trong Saved Messages, thay cho SQLite trên máy tính. Mọi thiết bị đều thấy cùng một danh sách.
- Dùng được trên Chrome/Edge (Windows) và Chrome (Android), cài lên màn hình như ứng dụng.

---

## Cài đặt (một lần, khoảng 10 phút)

### Bước 1 — Đưa thư mục `web` lên GitHub Pages (miễn phí)

1. Đăng nhập <https://github.com> (tạo tài khoản nếu chưa có).
2. **New repository** → đặt tên `telecloud` → chọn **Public** → **Create repository**.
3. Bấm **uploading an existing file**, kéo **toàn bộ nội dung bên trong thư mục `D:\Telecloud\web`** vào (gồm `index.html`, `sw.js`, các thư mục `js`, `icons`…), rồi bấm **Commit changes**.
4. Vào **Settings → Pages**. Ở mục *Branch* chọn `main` và `/ (root)` → **Save**.
5. Sau 1–2 phút, app nằm ở địa chỉ: **`https://<tên-github>.github.io/telecloud/`**

> Mã nguồn công khai không ảnh hưởng an toàn vì trong mã **không có bí mật nào**. API ID/Hash, phiên đăng nhập và mật khẩu chỉ nằm trên thiết bị của bạn.

### Bước 2 — Mở trên máy tính Windows

1. Mở địa chỉ ở Bước 1 bằng **Chrome hoặc Edge**.
2. Nhập **API ID** và **API Hash**. Đây chính là hai giá trị `TELEGRAM_API_ID` và `TELEGRAM_API_HASH` trong file `D:\Telecloud\.env`.
3. Đăng nhập Telegram: nhập số điện thoại (ví dụ `+84912345678`), rồi mã Telegram gửi vào app Telegram, rồi mật khẩu xác minh 2 bước (nếu có).
4. Nhập **mật khẩu Vault cũ** của TeleCloud. Các tệp đã tải lên trước đây sẽ hiện ra.
5. Để cài như ứng dụng: bấm biểu tượng ⊕ **Cài đặt** trên thanh địa chỉ.

### Bước 3 — Mở trên Android

Mở **cùng địa chỉ** bằng Chrome và làm lại như Bước 2. Để cài như app: menu ⋮ → **Thêm vào màn hình chính / Cài đặt ứng dụng**.

Từ giờ bạn có thể **tắt máy tính**. Không cần chạy `TeleCloud_Start.bat` hay `Enable_Remote_Access.bat` nữa.

---

## Sử dụng

| Việc | Cách làm |
|---|---|
| Tải lên | **＋ Tải lên**, hoặc kéo-thả tệp (máy tính). Tệp vào thư mục đang mở |
| Xem | Bấm vào tên tệp: ảnh, video, nhạc, văn bản (và PDF trên máy tính) |
| Tải xuống | Nút ⬇. Trên máy tính, tệp được giải mã thẳng xuống ổ đĩa |
| Thư mục | **＋** cạnh "Thư mục"; nút 📁 để chuyển tệp |
| Đồng bộ | Menu ⋮ → **Đồng bộ lại với Telegram** (lấy tệp do thiết bị khác vừa tải lên) |
| Khóa | 🔒 **Khóa** (app tự khóa sau 15 phút không dùng) |

---

## Lưu ý quan trọng

- **Phiên đăng nhập Telegram được lưu trong trình duyệt** của thiết bị.
  - Chỉ dùng app trên máy của bạn. Không dùng trên máy lạ.
  - Người cầm máy bạn vẫn **không mở được Vault** nếu không biết mật khẩu Vault.
  - Bạn có thể xem và thu hồi phiên trong Telegram: **Cài đặt → Thiết bị**, mục "TeleCloud Web".
  - Muốn đăng xuất trên một thiết bị: menu ⋮ → **Đăng xuất Telegram**.
- **Lần đầu mở Vault,** app tạo tệp chỉ mục bằng cách đọc khoảng 1 MB đầu của mỗi tệp cũ. Nếu bạn có nhiều tệp, lần này sẽ hơi lâu. Những lần sau chỉ cần đọc chỉ mục nên rất nhanh.
- **Dùng song song với bản Python:**
  - Tệp tải lên từ web, bản Python thấy được bằng chức năng **Khôi phục / quét Telegram**.
  - Đổi tên hoặc chuyển thư mục trên web chỉ lưu trong chỉ mục của web; bản Python vẫn hiện tên và thư mục gốc.
- **Nếu tệp chỉ mục bị xóa** (ví dụ do dọn Saved Messages), app tự dựng lại danh sách từ metadata trong từng tệp. Khi đó tên và thư mục quay về như lúc tải lên.
- **Không xóa** các tin nhắn có chú thích `TCLOUD1:…` hoặc `TCLOUDIDX1:…` trong Saved Messages.
- Mỗi tệp tối đa **1,9 GB**. Trên Android, tải xuống tệp rất lớn sẽ tốn RAM.
- **Thư viện Telegram (GramJS 2.26.22)** được tải từ jsDelivr và esm.sh ở lần mở đầu tiên, sau đó lưu sẵn trong trình duyệt.

## Kiểm thử (cho lập trình viên)

```bash
node tests/compat.test.mjs     # so khớp định dạng mã hóa với telecloud/crypto.py (cần Python + cryptography)
node tests/server.mjs &        # Telegram giả lập + dữ liệu do bản Python tạo
node tests/e2e.mjs             # 9 kịch bản trên Chrome thật (cần Playwright)
```
