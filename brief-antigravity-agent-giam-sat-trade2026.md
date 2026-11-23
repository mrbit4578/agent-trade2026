# Brief cho Antigravity — Agent giám sát luồng tín hiệu Trade.2026 (chạy thật)

## 1. Bối cảnh — Caffeine chỉ làm được tới đâu (đã kiểm chứng live 23/11/2026)

- App "Hãy đọc và tạo agent" tại agent.mrbit-kiemtien.com chỉ tạo **kế hoạch + prompt copy-paste**. Trang kế hoạch https://agent.mrbit-kiemtien.com/plans/1 **KHÔNG có** nút Run/Deploy, không nhập API key, không webhook, không ô chat, không log/trạng thái chạy live. Cách vận hành của nó là thủ công: tạo 4 khung chat Claude/ChatGPT, dán prompt, tự cung cấp dữ liệu.
- Vì vậy đội agent này phải được **code thành một service chạy thật**. Bản brief này là spec để Antigravity code. Kế hoạch 7 ngày thủ công trong app được thay bằng service này, nhưng **4 prompt ở mục 4 của kế hoạch vẫn là spec hành vi** cho từng component — lấy nguyên văn.

## 2. Mục tiêu (P0 trong audit realtime 21/11/2026)

- Giám sát luồng tín hiệu coin Trade.2026 đầu–cuối và phát hiện tín hiệu **MẤT** (đạt ngưỡng nhưng không tới Telegram), có biên nhận bền vững.
- Chỉ giám sát + báo cáo. **Không đặt lệnh, không tự gửi tín hiệu, không tự đăng, không sửa dữ liệu tín hiệu.**

## 3. Kiến trúc đề xuất (khuyên dùng)

- Service **Node.js chạy trên VPS Linode hiện có** (trạm Trade.2026 đang chạy 24/7 tại đó) — không cần server mới.
- Lõi đối chiếu là **code xác định (deterministic), KHÔNG phải 4 khung chat LLM**: việc khớp tín hiệu là phép join giữa 2 danh sách, code làm chính xác và miễn phí hơn LLM. LLM chỉ dùng ở bước tóm tắt báo cáo (tùy chọn, dùng provider free đã có: Novita / UTIM / APINEX).
- Chạy theo lịch: systemd timer hoặc cron **mỗi 15 phút** (khớp nhịp collector); mỗi lần chạy xử lý cửa sổ 24h gần nhất + quét lại các ca THIẾU chưa chốt trong 24h qua.
- 4 vai trò trong kế hoạch map sang component:
  - **Soát** → truy vấn Supabase bảng `signals`: `diem >= 70` AND `phase = 'alert_ready'`. Lưu ý: phase `retest_in_progress` chỉ là PREPARE, engine không sinh verdict ở phase này — Soát chỉ lấy `alert_ready` theo đúng kế hoạch.
  - **Dò** → đối chiếu danh sách kỳ vọng với biên nhận đã gửi (bảng receipts mới, §5) + heartbeat `telegram-sender` (`sent_ids`).
  - **Chốt** → mỗi ca THIẾU phải kiểm **2 nguồn độc lập** (log trạm trên VPS + biên nhận) trước khi kết luận MẤT; chỉ 1 nguồn → `CẦN KIỂM TRA`; có bằng chứng đã gửi → `CẢNH BÁO GIẢ`, loại.
  - **Điều phối** → gom **MỘT báo cáo**: gửi Telegram cho hay + ghi log file trên VPS (sau này thêm Google Sheets).

## 4. Dữ liệu — Supabase (`supabase-almond-fence`, ref `fagveiomuwuyuzzeepvk`)

- Auth: **CHỈ header `apikey`, KHÔNG `Authorization`** (gửi Bearer sẽ 401 PGRST301).
- Bảng `signals` (28 dòng lúc audit 21/11): cột `id, coin, side, loai, diem, gia_vao, sl, tp1, tp2, rr, phase, trang_thai, ket_qua, ts_vao, ts_dong, phien, bias_4h, cau_truc, nguon, created_at`. **KHÔNG có cột đã gửi.**
- Nguồn sự thật duy nhất cho việc gửi là **Supabase** (sender chỉ đọc Supabase). Journal `data/journal-247.json` lệch với Supabase (giao nhau chỉ 2/28 id) — **KHÔNG dùng journal làm nguồn kỳ vọng**.
- Luật gửi hiện tại của sender (`tools/telegram-sender.js`, VPS, 5 phút/lần — để đối chiếu, **không sửa trong v1**): đọc 300 dòng mới nhất; lọc `diem >= 70`, `phase` ∈ {`alert_ready`, `retest_in_progress`}, `loai = 'that'`, cửa sổ **180 phút**, tối đa 10/lần; dedupe bằng `sent_ids` (200 id) trong heartbeat `telegram-sender`; POST relay timeout 30s, không retry trong lần chạy; chỉ đánh dấu đã gửi khi relay trả `{sent: true}` hoặc `{sent: false, reason: 'duplicate'}`.
- Relay: `POST https://bot-tele-2026.vercel.app/api/signal-relay`, header `X-Signal-Key`. Store dedupe của relay là **file /tmp trên Vercel (tối đa 50 bản ghi, mất khi cold start)** — ĐÂY LÀ LỖ HỔNG GỐC của vụ mất LINK-short, và là lý do cần bảng receipts bền (§5).
- Telegram: @trademrbit_bot (coin) / @Nexuspilot90_bot (forex, engine riêng).

## 5. P0 — Bảng biên nhận bền (việc quan trọng nhất)

- Tạo bảng mới `delivery_receipts` trong Supabase: `signal_id` (khóa chính), `sent_at` (giờ relay xác nhận), `relay_response` (JSON), `telegram_message_id` (nếu lấy được), `checked_at`, `status` (`sent` | `duplicate` | `failed`).
- Sender hiện tại (`telegram-sender.js`) cần sửa **tối thiểu** để ghi biên nhận vào bảng này mỗi khi relay trả kết quả (kể cả duplicate/failed) — đây là thay đổi duy nhất chạm code trạm trong v1, và phải làm theo quy tắc hệ thống: lấy main mới nhất trước khi sửa, đọc lại diff (dòng xóa phải cố ý), kiểm chứng live sau deploy.
- Agent giám sát đọc bảng này (cùng heartbeat) để kết luận ĐỦ/THIẾU — không bao giờ kết luận chỉ từ /tmp relay hay heartbeat (heartbeat chỉ giữ lần chạy gần nhất).

## 6. Runtime — VPS Linode (trạm Trade.2026)

- VPS: IP 104.64.220.43, Ubuntu 24.04, Node 20, user `trade`, repo `/opt/trade2026`. Timer hiện có: collector 15 phút, sender 5 phút, push-data mỗi giờ, snapshot 05:07 + 17:07 UTC.
- Code mới: ví dụ `tools/signal-monitor.js` + timer systemd/cron riêng, chạy dưới user `trade`, log ra file trong `/opt/trade2026` (đừng ghi /tmp).
- Antigravity chạy trên máy Windows của hay — để deploy lên VPS cần SSH key/truy cập VPS (hay cấp). Không hardcode key vào code; key/token chỉ qua biến môi trường trên VPS.

## 7. Cảnh báo — Telegram cho hay

- Khi Chốt xác nhận MẤT (đủ 2 bằng chứng): gửi ngay **1 tin Telegram** cho hay qua bot hiện có (@trademrbit_bot — relay đã có; hoặc bot riêng nếu hay muốn tách kênh cảnh báo).
- Báo cáo ngày 1 lần (buổi sáng): tổng số tín hiệu đạt ngưỡng 24h qua, số ĐỦ/THIẾU/MUỘN, danh sách MẤT đã xác nhận kèm bằng chứng.
- Cần từ hay: **Telegram chat ID của hay** (để bot nhắn đúng người) + token bot — đưa qua biến môi trường, **KHÔNG dán vào chat/code**.

## 8. Quy tắc an toàn (bắt buộc, từ kế hoạch mục 5)

- V1 chỉ đọc + báo cáo: **KHÔNG gửi lại tín hiệu, KHÔNG ghi/xóa bảng `signals`, KHÔNG sửa log, KHÔNG đặt lệnh, KHÔNG đưa lời khuyên đầu tư.**
- Mọi tác động ra ngoài (gửi tin, sửa dữ liệu) đều cần hay phê duyệt; v1 chỉ có 2 ngoại lệ đã chốt: (a) ghi biên nhận vào bảng receipts (do sender ghi, không phải agent), (b) gửi cảnh báo MẤT cho hay.
- **KHÔNG BAO GIỜ** hỏi/đọc mật khẩu, API key, service role key, token bot trong khung chat — cấu hình qua biến môi trường. Không bịa số, không bịa giờ gửi; không có dữ liệu thì ghi "chưa có dữ liệu"; mọi con số kèm nguồn + giờ chụp (UTC + VN).

## 9. Kiểm thử chấp nhận (phải pass trước khi coi là xong)

1. Soát khung 10/11/2026 (UTC): phải thấy `LINK-short-1794327319494` — 88 điểm, `alert_ready`, `loai='that'`, `ts_vao` 16:15:19Z — và Dò + Chốt phải kết luận **MẤT** (đây là ca lỡ gửi thật duy nhất đã biết).
2. Chạy 1 ngày sạch (không tín hiệu đạt ngưỡng mới): báo "0 mất", không báo giả.
3. Đếm Soát khớp với đếm tay trên Supabase (không thiếu dòng, không trùng id).
4. Biên nhận bền: restart service/VPS xong vẫn tra cứu được receipt đã ghi (không mất như /tmp relay).
5. Không gửi trùng cảnh báo cho cùng 1 ca MẤT (dedupe theo `signal_id`).

## 10. Ngoài phạm vi v1 (đừng làm trong lần này)

- P1: điều tra độ chính xác (expectancy −0,34R, long 0/56) — làm sau.
- P2: skill Auto Run 5m / River, cảnh báo đóng băng giá.
- P3: sender retry, NN, realtime event-driven.
- Không sửa engine tín hiệu, không sửa collector/sender ngoài việc ghi receipts (§5).

## 11. Tài liệu tham chiếu

- Kế hoạch Caffeine: https://agent.mrbit-kiemtien.com/plans/1 (4 prompt đầy đủ ở mục 4 — lấy nguyên văn làm spec hành vi).
- Báo cáo audit realtime 21/11: `~/workspace/your_files/trade2026-realtime-audit-2026-11-21.md` (35/44 mục kiểm chứng; §2.4 Supabase, §2.6 sender → relay → Telegram, §R1 biên nhận, §P0).
- Repo: github.com/hayhahen-ui/Trade.2026 (main). Kit relay: `~/workspace/your_files/bot-tele-2026-multibot/`.
- Supabase helper: `~/workspace/custom-connectors/custom.supabase-trade2026/bin/supabase-rest` (auth chỉ apikey).

## 12. Thứ hay cần chuẩn bị cho Antigravity

- [ ] SSH vào VPS Linode (user `trade`, IP 104.64.220.43) từ máy Windows.
- [ ] Supabase URL + anon/service key (đưa qua biến môi trường trên VPS, không dán vào chat).
- [ ] Telegram chat ID của hay + token bot dùng để gửi cảnh báo.
- [ ] Quyết định: cảnh báo MẤT gửi qua @trademrbit_bot hiện có hay bot riêng.
