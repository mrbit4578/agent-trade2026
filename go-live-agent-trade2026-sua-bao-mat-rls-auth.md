# Go-live agent-trade2026 — Gói sửa 2 lỗ hổng bảo mật + dọn bảng chạy nhầm project

Ngày soạn: 23/11/2026 ~11:35 giờ VN. Dành cho Antigravity (code) + hay (chạy SQL, gắn secret).
Bối cảnh: hay nhờ "chạy live ngay" sáng 23/11; Muse kiểm tra repo `mrbit4578/agent-trade2026` lúc 11:23 và thấy code khung đã xong nhưng **chưa live được** (đang DEMO, chưa gắn key Supabase) + **2 lỗ hổng cần sửa trước khi live**. File này đưa cách sửa copy-paste được, để không tốn thêm một vòng hỏi–đáp nữa.

Bản brief gốc: `~/workspace/your_files/brief-antigravity-agent-giam-sat-trade2026.md`.
File chuẩn bị env/SSH: `~/workspace/your_files/chuan-bi-antigravity-agent-giam-sat-trade2026.md`.

## 0. Việc đang kẹt (không thuộc gói này — hay phải làm trước)

Tài khoản Supabase đang đăng nhập trên Chrome của hay (`mrbit4578`) **không có quyền vào project `almond-fence`** (ref `fagveiomuwuyuzzeepvk`, nơi chứa tín hiệu). Nó chỉ thấy project `citrine-candle` + 1 project Paused. Cần hay **đăng nhập Supabase bằng tài khoản sở hữu `almond-fence`** (tạo 06/11, org `hayhahen-3252`) **hoặc mời `mrbit4578` làm thành viên** project đó. Xong bước này mới chạy tiếp các mục dưới — vì cần cả SQL lẫn service key từ dashboard `almond-fence`.

## 1. Lỗ hổng 1 — Endpoint `POST /api/monitor/run` không có xác thực

Hiện trạng: ai biết link cũng kích hoạt được, kể cả gửi tin Telegram cảnh báo cho hay.

### Cách sửa (Antigravity)

Thêm kiểm tra secret ở đầu handler (Next.js App Router, file route của `/api/monitor/run`):

```ts
const secret = process.env.MONITOR_SECRET;
const got =
  req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
  req.headers.get('x-monitor-secret');
if (!secret || got !== secret) {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}
```

- Nếu route GET cũng kích hoạt chạy monitor thì bảo vệ GET y như vậy.
- Không log giá trị secret ra log/console.
- Sau khi sửa: chạy lại **bài kiểm thử chấp nhận số 1** (soát khung 10/11 phải kết luận MẤT ca `LINK-short-1794327319494`, 88 điểm) — vì hành vi endpoint đã đổi.

### Secret `MONITOR_SECRET` đặt ở 2 chỗ, cùng 1 giá trị (hay tự tạo, đừng dán vào chat/code)

1. **Vercel** → project `agent-trade2026` → Settings → Environment Variables → thêm `MONITOR_SECRET` (chuỗi ngẫu nhiên dài, tự nghĩ).
2. **GitHub** → repo `mrbit4578/agent-trade2026` → Settings → Secrets → thêm secret `MONITOR_SECRET` (cùng giá trị trên).

### Workflow GitHub 15 phút gửi kèm header

Thêm header vào lệnh gọi monitor hiện có trong workflow (giữ nguyên URL, chỉ thêm header):

```yaml
- run: curl -sS -X POST "$MONITOR_URL" -H "Authorization: Bearer $MONITOR_SECRET"
  env:
    MONITOR_URL: ${{ secrets.MONITOR_URL }}
    MONITOR_SECRET: ${{ secrets.MONITOR_SECRET }}
```

- Secret `MONITOR_URL` trên GitHub vẫn còn thiếu (workflow hiện 0 lượt chạy) — đặt cùng lúc với `MONITOR_SECRET`.
- Lưu ý đã biết: Vercel gói Hobby cron chỉ cho chạy hằng ngày, nên nhịp 15 phút dựa vào GitHub Actions (best-effort, đã từng chạy thưa như vụ Auto Run 5 phút) — chấp nhận trong v1, không đổi kiến trúc lúc này.

## 2. Lỗ hổng 2 — Migration SQL không định nghĩa RLS

Hiện trạng: file `001_delivery_receipts.sql` tạo bảng `delivery_receipts` + `monitor_alerts` nhưng **không bật Row Level Security**. Vì project `almond-fence` vốn đặt RLS đọc công khai cho 5 bảng tín hiệu, 2 bảng mới mà không có RLS thì ai có anon key cũng đọc/ghi được biên nhận.

### Cách sửa (Antigravity — sửa trong file migration, rồi chạy lại)

Chạy trong **project `almond-fence` (`fagveiomuwuyuzzeepvk`) — KHÔNG chạy ở `citrine-candle`**:

```sql
alter table public.delivery_receipts enable row level security;
alter table public.monitor_alerts enable row level security;
```

- **Không tạo policy public nào.** Anon key sẽ không đọc/ghi được 2 bảng này. Monitor dùng service key (`sb_secret_...`, gửi ở header `apikey`) — service_role bypass RLS nên monitor vẫn đọc/ghi bình thường.
- Kiểm tra sau khi chạy (cả 2 dòng phải trả về `rowsecurity = true`):

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public'
  and tablename in ('delivery_receipts', 'monitor_alerts');
```

- Đưa 2 lệnh `alter table` vào luôn file `001_delivery_receipts.sql` (sau lệnh tạo bảng) để lần chạy sau không sót.

## 3. Dọn bảng chạy nhầm vào project `citrine-candle` (làm sau khi mục 2 xong)

Sáng nay file SQL đã chạy "Success" nhưng **nhầm project**: bảng `delivery_receipts` + `monitor_alerts` hiện nằm ở `citrine-candle` (ref `fdtbybbdxfqsbyqtricc`), không phải `almond-fence`. Đây là 2 bảng mồ côi — dọn để lần sau không nhầm nữa.

Chỉ chạy trong **project `citrine-candle`**, sau khi `almond-fence` đã có bảng (mục 2):

```sql
-- 1. Kiểm tra rỗng trước (cả 2 phải trả về 0):
select count(*) from public.delivery_receipts;
select count(*) from public.monitor_alerts;

-- 2. Nếu cả 2 đều 0 dòng thì xóa:
drop table if exists public.delivery_receipts;
drop table if exists public.monitor_alerts;
```

- Nếu bảng nào có dòng dữ liệu thì **dừng lại, báo hay trước khi xóa** — đừng xóa mù.

## 4. Thứ tự go-live (sau khi hay mở được quyền Supabase, mục 0)

1. [ ] Chạy SQL đã sửa (tạo bảng + RLS, mục 2) vào **`almond-fence`**.
2. [ ] Dọn 2 bảng mồ côi ở `citrine-candle` (mục 3).
3. [ ] Gắn biến môi trường trên Vercel (`SUPABASE_URL`, key Supabase, `BOT_TOKEN_TRADEMRBIT`, `SIGNAL_CHAT_ID`, `MONITOR_SECRET`) → redeploy → kiểm tra dashboard hết chế độ DEMO.
4. [ ] Áp bản vá ghi biên nhận vào sender trên VPS (`docs/vps-sender-patch.md` trong repo).
5. [ ] Đặt 2 secret GitHub (`MONITOR_URL`, `MONITOR_SECRET`) → chạy tay workflow 1 lần → kiểm tra monitor chạy được và không báo giả.
6. [ ] Chạy lại 5 bài kiểm thử chấp nhận trong brief §9 (bài 1 bắt buộc: bắt đúng ca LINK-short 10/11).

## 5. Quy tắc không đổi

- Không dán key/token/secret vào chat, vào code, hay vào file nào khác — chỉ qua biến môi trường.
- Không sửa engine tín hiệu, collector, sender ngoài việc ghi biên nhận (brief §10).
- V1 chỉ đọc + báo cáo; không tự gửi lại tín hiệu, không đặt lệnh.
