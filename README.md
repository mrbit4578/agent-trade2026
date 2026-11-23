# Trade.2026 · Signal Monitor Live Agent

Web Agent giám sát luồng tín hiệu Trade.2026 đầu–cuối chạy live trên **Next.js App Router + Vercel Serverless + Vercel Cron** (mỗi 15 phút), triển khai đầy đủ đặc tả từ [brief-antigravity-agent-giam-sat-trade2026.md](./brief-antigravity-agent-giam-sat-trade2026.md).

## Kiến trúc 4-Agent xác định (Deterministic Core)

1. **Agent 1 · Soát**: Truy vấn Supabase `signals` (chỉ đọc `GET`, auth chỉ dùng header `apikey` — không gửi `Authorization: Bearer`), lọc `diem >= 70` AND `phase = 'alert_ready'`, loại bỏ `retest_in_progress` và trùng ID.
2. **Agent 2 · Dò**: Join danh sách kỳ vọng với bảng biên nhận bền `delivery_receipts` và heartbeat `telegram-sender` (`sent_ids`), phân loại sơ bộ `ĐỦ` / `MUỘN (>15p)` / `THIẾU`.
3. **Agent 3 · Chốt**: Kiểm chứng **2 nguồn độc lập** cho mỗi ca `THIẾU`:
   - 2/2 nguồn cùng xác nhận chưa gửi → **`MẤT`**
   - Chỉ có 1 nguồn khả dụng → **`CẦN KIỂM TRA`**
   - Có bằng chứng đã gửi ở nguồn độc lập → **`CẢNH BÁO GIẢ`** (loại)
4. **Agent 4 · Điều phối**: Gom **MỘT** báo cáo chuẩn UTC + VN (UTC+7), chống gửi trùng theo `signal_id` (`monitor_alerts`), gửi cảnh báo Telegram khi có ca `MẤT` mới.

## Quy tắc an toàn v1

- Chỉ giám sát & báo cáo: **KHÔNG** sửa/xóa bảng `signals`, **KHÔNG** đặt lệnh, **KHÔNG** tự gửi lại tín hiệu.
- Không hardcode API key/token; toàn bộ credentials cấu hình qua Vercel Environment Variables (xem `.env.example`).

## Cấu hình Live trên Vercel

Thêm các biến môi trường trong **Vercel → Project Settings → Environment Variables**:

- `SUPABASE_URL` (mặc định `https://fagveiomuwuyuzzeepvk.supabase.co`)
- `SUPABASE_SERVICE_KEY` (hoặc `SUPABASE_API_KEY`, auth chỉ header `apikey`)
- `BOT_TOKEN_TRADEMRBIT` & `SIGNAL_CHAT_ID` (hoặc `TELEGRAM_BOT_TOKEN` & `TELEGRAM_CHAT_ID`)
- `MONITOR_SECRET` (**bắt buộc** — bảo vệ `POST /api/monitor/run` và `GET /api/monitor/cron`, đặt cùng giá trị trên GitHub Actions Secret)
- `VPS_HEARTBEAT_URL` (tùy chọn — nguồn xác minh độc lập thứ 2)
- `CRON_SECRET` (tùy chọn bổ sung cho Vercel Cron hằng ngày)

> Khi chưa gắn `SUPABASE_API_KEY`, web tự chạy ở chế độ **DEMO SANDBOX** (kèm sẵn kịch bản kiểm thử chấp nhận `10/11/2026 UTC · LINK-short-1794327319494` và `Ngày sạch`).

## P0: Biên nhận bền (Supabase + VPS)

- SQL tạo bảng `delivery_receipts` & `monitor_alerts`: `supabase/migrations/001_delivery_receipts.sql`
- Hướng dẫn bản vá tối thiểu cho VPS `tools/telegram-sender.js`: `docs/vps-sender-patch.md`

## Chạy cục bộ & Kiểm thử

```bash
npm install
npm run test:acceptance
npm run build
npm run dev
```
