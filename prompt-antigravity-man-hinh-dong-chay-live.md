# Prompt cho Antigravity — Màn hình "Dòng chảy tín hiệu live" (agent-trade2026)

> Dán nguyên prompt này cho Antigravity. Repo đã có sẵn code, chỉ code thêm màn hình mới, không sửa logic giám sát hiện tại.

## 1. Bối cảnh

- Repo: `mrbit4578/agent-trade2026` (public, main), web app **Next.js 15 + React 19**, deploy trên Vercel, domain chính: **https://tradewatch.mrbit-kiemtien.com/** (domain cũ `agent-trade2026-theta.vercel.app` vẫn dùng được).
- App hiện tại là **dashboard giám sát tín hiệu Trade.2026**: 4 agent chạy theo chuỗi xác định (không phải chat LLM) — **Soát → Dò → Chốt → Điều phối** — chỉ đọc + báo cáo, không đặt lệnh, không tự gửi, không tự đăng.
- Vấn đề: dashboard hiện tại chỉ hiện **kết quả của lần quét cuối cùng** (bảng đối chiếu + 4 ô số). Nhìn vào không biết được: agent nào đang chạy, agent nào kẹt, dữ liệu đang realtime hay đã chết, và chết ở khâu nào. Đã có lần tưởng hệ thống chết (banner 401, nhãn DEMO SANDBOX) mà thực ra chỉ là tab cũ / ô secret trống.

## 2. Mục tiêu

Thêm **một màn hình/tab mới tên "Dòng chảy live"** (đặt cạnh tab dashboard hiện tại, không thay thế dashboard cũ): một sơ đồ dòng chảy trực quan, tự cập nhật, cho thấy **tín hiệu đi từ trạm → Supabase → từng agent → Telegram** đang ở đâu, mới hay cũ, sống hay chết — nhìn một cái là biết hệ thống trơn tru hay kẹt ở khâu nào.

## 3. Dòng chảy cần vẽ (6 nút, nối bằng mũi tên theo đúng thứ tự thật)

| # | Nút | Dữ liệu hiện tại cần lấy | Ý nghĩa |
|---|-----|--------------------------|---------|
| 1 | **Trạm VPS — Collector** | Tín hiệu mới nhất trong bảng `signals` (thời gian `created_at`, coin/side/điểm), tổng số dòng quét 24h | Tín hiệu có đang vào Supabase không |
| 2 | **Agent 1 — Soát** | Lần quét gần nhất: thời gian chạy, số dòng quét, số tín hiệu kỳ vọng (≥70đ + `alert_ready`) | Có đang quét không |
| 3 | **Agent 2 — Dò** | Số tín hiệu đã đối chiếu receipts, số ĐỦ / MUỘN (>15p) / THIẾU | Có đang đối chiếu không |
| 4 | **Agent 3 — Chốt** | Số ca THIẾU đã thẩm định 2 nguồn, số MẤT đã chốt / CẦN KIỂM TRA / CẢNH BÁO GIẢ | Có đang thẩm định không |
| 5 | **Agent 4 — Điều phối** | Báo cáo gộp cuối cùng, thời gian báo cáo, số cảnh báo đã gửi | Có đang tổng hợp + báo cáo không |
| 6 | **Đầu ra — Telegram** | Trạng thái gửi qua `@trademrbit_bot`: lần gửi cuối, số tin đã gửi; bảng `delivery_receipts`: số receipt khớp / tổng kỳ vọng, receipt mới nhất | Cảnh báo có tới tay người nhận không |

Mỗi nút hiển thị: **tên + trạng thái màu + lần hoạt động cuối (giờ + "cách đây X phút") + 1–2 con số vào/ra + lỗi ngắn gọn nếu có**. Nút nào chưa từng chạy thì ghi rõ "chưa từng chạy".

## 4. Quy tắc màu + phát hiện điểm chết (QUAN TRỌNG NHẤT)

- **Xanh (SỐNG):** dữ liệu mới trong ngưỡng — tín hiệu mới nhất < 30 phút; heartbeat sender < 10 phút; lần quét cuối < 20 phút.
- **Vàng (CHẬM):** vượt ngưỡng xanh nhưng chưa tới ngưỡng đỏ — tín hiệu 30–60 phút; heartbeat 10–30 phút; lần quét 20–45 phút.
- **Đỏ (CHẾT/KẸT):** vượt ngưỡng đỏ — tín hiệu > 60 phút; heartbeat > 30 phút; lần quét > 45 phút. Nút đỏ phải ghi rõ **"KẸT TẠI ĐÂY từ HH:MM (cách đây X phút)"**.
- **Banner tổng ở đầu màn hình:** nếu tất cả xanh → "DÒNG CHẢY ĐANG SỐNG — cập nhật lần cuối HH:MM:SS". Nếu có nút đỏ → "ĐANG KẸT TẠI <tên nút> từ HH:MM — nguyên nhân có thể: <gợi ý ngắn, vd: trạm ngừng đẩy / lịch GitHub chưa chạy / chưa cấu hình heartbeat>".
- **Không bao giờ hiện dữ liệu giả:** nút nào chưa có dữ liệu thì ghi "CHƯA CÓ DỮ LIỆU" (màu xám), không tự bịa số 0 thành "đang chạy tốt".

## 5. Nguồn dữ liệu — chỉ dùng cái đã có, không tạo nguồn mới

- Đọc bảng Supabase `signals` (GET, header `apikey` — xem `src/lib/monitor/supabase.ts`), `delivery_receipts`, `monitor_alerts`, và lịch sử các lần chạy monitor đã lưu trong app.
- Heartbeat telegram-sender: đọc từ nguồn hiện tại của app (bảng heartbeat / `VPS_HEARTBEAT_URL` nếu có).
- **Trạng thái thật lúc giao prompt (để test đối chiếu, không hardcode vào code):**
  - Tín hiệu mới nhất vẫn là **DOGE-short 83đ, `alert_ready`, 22/11 23:00Z** — verdict CẦN KIỂM TRA (chưa có receipt, chưa có heartbeat).
  - **Heartbeat sender đang CHƯA CÓ DỮ LIỆU** (chưa cấu hình `VPS_HEARTBEAT_URL`, bản vá sender trên VPS chưa áp) — màn hình mới PHẢI hiện đúng trạng thái này, không được tự "xanh" hoá.
  - **Lịch GitHub Actions 15 phút đang KHÔNG chạy theo lịch** (chỉ có 1 lần chạy tay 13:46 ngày 23/11) — màn hình phải phân biệt được "lần quét tay" và "lần quét theo lịch".
  - Quét tay từ dashboard đã hoạt động (RUN `run_mwt17usg` 15:56 ngày 23/11).

## 6. Hành vi màn hình

- **Tự refresh mỗi 30 giây** (polling), có nút refresh tay, và dòng chữ "Cập nhật lần cuối HH:MM:SS — dữ liệu cũ X giây".
- **Chỉ đọc (read-only):** màn hình này không đặt lệnh, không gửi Telegram, không đăng gì, không đổi cấu hình.
- **Không cần nhập secret để XEM** (giữ như dashboard hiện tại — tải trang là xem được). Nút "Chạy quét ngay" giữ nguyên như cũ: vẫn yêu cầu nhập `MONITOR_SECRET`.
- **Responsive** (xem được trên điện thoại), khớp phong cách dark + bảng màu hiện tại của dashboard.
- Mỗi nút bấm vào được thì hiện chi tiết: 5 dòng gần nhất (vd: 5 tín hiệu mới nhất, 5 lần chạy gần nhất, 5 receipt mới nhất).

## 7. Ràng buộc kỹ thuật (bắt buộc)

- **Không đổi logic engine/monitor hiện tại** (`src/lib/monitor/*`, engine Soát/Dò/Chốt/Điều phối, API `/api/monitor/run` và `/api/monitor/cron`).
- **Không chạm tới bảo mật:** không đổi cách xác thực `MONITOR_SECRET`, không đổi RLS, không đổi env/secrets, không commit bất kỳ secret/key nào, không hardcode URL/key.
- **Không đổi cron/workflow GitHub** (`.github/workflows/monitor-cron.yml`) và không đổi tên miền.
- Dùng lại code/lib hiện có trong repo; không thêm dependency nặng; code TypeScript strict, `npm run build` phải pass, deploy Vercel preview phải chạy được.

## 8. Kiểm thử chấp nhận (Antigravity tự chạy đủ 5 bài, ghi kết quả vào PR)

1. **Mở màn hình mới:** thấy đủ 6 nút theo đúng thứ tự + banner tổng + thời gian cập nhật; số liệu khớp với dashboard cũ ở cùng thời điểm.
2. **Giả lập heartbeat cũ > 30 phút** (sửa tạm thời gian trong dữ liệu test, không sửa dữ liệu thật): nút Telegram/heartbeat chuyển ĐỎ + banner tổng báo đúng "KẸT TẠI <nút> từ HH:MM".
3. **Giả lập không có tín hiệu mới 60 phút:** nút Trạm chuyển ĐỎ, các nút sau nó chuyển XÁM "chờ dữ liệu", không hiện xanh giả.
4. **Reload trang:** màn hình tải lại bình thường, không cần nhập secret để xem; nút "Chạy quét ngay" vẫn đòi secret như cũ.
5. **Trên điện thoại (chiều rộng ~390px):** 6 nút xếp dọc vẫn đọc được, không tràn, không vỡ layout.

## 9. Bàn giao

- Commit lên repo `mrbit4578/agent-trade2026` (nhánh mới, PR mô tả rõ thay đổi + ảnh chụp màn hình mới + kết quả 5 bài kiểm thử).
- Deploy preview Vercel chạy được để chủ repo bấm xem trực tiếp.
- Không merge tự ý — chủ repo tự merge sau khi xem preview.

---
*Prompt soạn ngày 23/11/2026. Trạng thái hệ thống lúc soạn: dashboard LIVE tại tradewatch.mrbit-kiemtien.com; quét tay đã chạy (RUN 15:56); lịch GitHub 15 phút chưa chạy; heartbeat sender chưa có dữ liệu; bản vá sender VPS chưa áp.*
