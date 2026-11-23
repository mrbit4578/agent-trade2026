# Chuẩn bị cho Antigravity — Agent giám sát Trade.2026 (đã làm xong phần kiểm chứng)

Ngày làm: 23/11/2026 ~10:55 giờ VN. Mục đích: chuẩn bị xong mọi thứ để Antigravity chỉ còn code "xương sống" (service giám sát + bảng receipts + timer + cảnh báo), không phải đi tìm thông tin.

Bản spec đầy đủ cho Antigravity: `~/workspace/your_files/brief-antigravity-agent-giam-sat-trade2026.md`.
Kế hoạch gốc (Caffeine, chỉ để tham chiếu prompt): https://agent.mrbit-kiemtien.com/plans/1

## 1. Quyết định đã chốt (23/11)

- Cảnh báo tín hiệu MẤT gửi qua **@trademrbit_bot hiện có** (không tạo bot riêng).

## 2. Đã kiểm chứng live lúc chuẩn bị (23/11 ~10:55 VN)

- **Supabase sống.** Bảng `signals` có tín hiệu mới: `DOGE-short-1795388419612` 83 điểm, `alert_ready`, 22/11 23:00Z; `ADA-short-1795307418514` 80 điểm, `alert_ready`, 22/11 00:30Z. Agent sẽ có dữ liệu thật để đối chiếu ngay.
- **Trạm sống.** Heartbeat mới nhất: `telegram-sender` 03:52Z, `collector-247` + `flow-247` 03:45Z ngày 23/11 (đều tươi trong vài phút trước lúc kiểm tra).
- **Bảng `delivery_receipts` CHƯA TỒN TẠI** (PostgREST trả 404 `PGRST205`). Antigravity phải tạo bảng này theo brief §5 — đây là việc P0.
- **Supabase URL (công khai, không phải bí mật):** `https://fagveiomuwuyuzzeepvk.supabase.co`. Auth chỉ header `apikey`, KHÔNG `Authorization`.

## 3. Biến môi trường — cái nào đã có, cái nào còn thiếu

### Đã có sẵn trong `/opt/trade2026/.env` trên VPS (monitor dùng chung file này, KHÔNG tạo file mới)

Từ `setup-env.sh` của bộ trạm (đã kiểm chứng tên biến, không phải giá trị):

| Biến | Dùng cho monitor? |
|---|---|
| `SUPABASE_URL` | Có — URL Supabase |
| `SUPABASE_SERVICE_KEY` (dạng `sb_secret_...`) | Có — key ghi/đọc, gửi ở header `apikey` |
| `SUPABASE_ANON_KEY` | Không cần cho monitor |
| `SIGNAL_KEY` | Không — chỉ sender dùng để POST relay |
| `RELAY_URL=https://bot-tele-2026.vercel.app/api/signal-relay` | Không — monitor không gửi qua relay (xem §4) |
| `NOVITA_API_KEY`, `UTIM_API_KEY` | Không — chỉ skill Auto Run dùng |

**CẤM chạy lại `setup-env.sh`** — script này ghi đè toàn bộ `.env`. Chỉ thêm biến mới bằng cách nối thêm (xem §5).

### Còn thiếu — phải thêm vào `/opt/trade2026/.env` (2 biến)

| Biến mới | Giá trị lấy ở đâu | Ghi chú |
|---|---|---|
| `BOT_TOKEN_TRADEMRBIT` | Vercel → project `bot-tele-2026` → Settings → Environment Variables → mở biến này xem giá trị | Token của @trademrbit_bot. Giá trị KHÔNG nằm trong repo/kit — chỉ có trên Vercel. |
| `SIGNAL_CHAT_ID` | Cùng chỗ trên Vercel | Nơi bot đang gửi tín hiệu — copy đúng giá trị này thì cảnh báo MẤT tới đúng chỗ hay đang đọc tín hiệu. Nếu trống thì dùng `CHAT_ID`. |

## 4. Vì sao monitor cần 2 biến trên (không gửi cảnh báo qua relay)

- Relay `/api/signal-relay` chỉ nhận **payload tín hiệu** rồi format thành tin tín hiệu (hàm `validate_signal`, `format_signal_message` trong `signal_relay.py`); **không có endpoint gửi tin nhắn tự do**. Cảnh báo "MẤT" không phải tín hiệu nên không đi qua relay được.
- Vì vậy monitor gọi **trực tiếp Telegram Bot API** (`https://api.telegram.org/bot<token>/sendMessage`) với `BOT_TOKEN_TRADEMRBIT` + `SIGNAL_CHAT_ID`. Đây là đường riêng cho cảnh báo, không đụng đường gửi tín hiệu hiện có.

## 5. Việc còn lại cho hay / Antigravity trên máy Windows (Muse không làm được từ sandbox)

Muse không SSH được vào VPS từ sandbox (không có key VPS ở đây + SSH bị chặn), và không bao giờ cầm giá trị key/token thô. Hai bước dưới làm trên máy Windows của hay, nơi Antigravity đang chạy.

### 5.1. Kiểm tra SSH vào VPS (1 lệnh)

```powershell
ssh trade@104.64.220.43 "echo OK; ls /opt/trade2026"
```

- Key là key không passphrase tạo ngày 10/11 trên máy Windows (user `huongcv`). Nếu SSH hỏi mật khẩu hoặc báo lỗi key: kiểm tra key còn trong `C:\Users\huongcv\.ssh` không, rồi mới tính tiếp.
- Kiểm tra xong thì xác nhận `.env` đã có đủ biến cũ: `ssh trade@104.64.220.43 "grep -c '^SUPABASE_URL=\|^SUPABASE_SERVICE_KEY=\|^SIGNAL_KEY=' /opt/trade2026/.env"` — phải trả về `3` (chỉ đếm dòng, không in giá trị).

### 5.2. Thêm 2 biến mới vào `.env` trên VPS (không ghi đè)

Mở trang Environment Variables của project `bot-tele-2026` trên Vercel, xem giá trị `BOT_TOKEN_TRADEMRBIT` và `SIGNAL_CHAT_ID`. Rồi SSH vào VPS và chạy từng dòng (gõ giá trị khi được hỏi, màn hình không hiện giá trị — **xóa màn hình trước khi chụp ảnh nếu có chụp**):

```bash
read -s -p "BOT_TOKEN_TRADEMRBIT: " T && echo "BOT_TOKEN_TRADEMRBIT=$T" >> /opt/trade2026/.env && unset T
read -p "SIGNAL_CHAT_ID: " C && echo "SIGNAL_CHAT_ID=$C" >> /opt/trade2026/.env && unset C
grep -c "BOT_TOKEN_TRADEMRBIT\|SIGNAL_CHAT_ID" /opt/trade2026/.env
```

- Dòng cuối phải trả về `2`. Lệnh `read -s` đọc không hiện ký tự nên giá trị không lọt vào lịch sử lệnh hay ảnh chụp.
- **Không dán giá trị key/token vào chat, vào code, hay vào file nào khác.**

## 6. Xương sống Antigravity cần code (sau khi §5 xong)

1. `tools/signal-monitor.js` (mới, trong repo `hayhahen-ui/Trade.2026`, chạy dưới user `trade`): đọc `.env` chung của trạm; truy vấn `signals` (`diem >= 70` AND `phase = 'alert_ready'`); đối chiếu với `delivery_receipts` + heartbeat `telegram-sender`; Chốt ca THIẾU bằng 2 nguồn (log trạm + biên nhận); gửi cảnh báo qua Telegram Bot API trực tiếp; ghi log ra file trong `/opt/trade2026`.
2. SQL tạo bảng `delivery_receipts` (brief §5) + sửa tối thiểu `telegram-sender.js` để ghi biên nhận mỗi khi relay trả kết quả.
3. Systemd timer/cron riêng mỗi 15 phút (theo mẫu timer trạm đã có).
4. Kiểm thử chấp nhận theo brief §9 — bài 1 bắt buộc: soát khung 10/11 phải kết luận MẤT ca `LINK-short-1794327319494` (88 điểm, `alert_ready`, `ts_vao` 16:15:19Z).

## 7. Việc Muse đã làm / chưa làm

- Đã làm: kiểm chứng Supabase + trạm live; xác nhận bảng receipts chưa có; đối chiếu tên biến môi trường từ bộ trạm và kit relay; ghi quyết định dùng @trademrbit_bot; viết brief + file chuẩn bị này.
- Chưa làm (không làm được từ sandbox, chờ hay/Antigravity): kiểm tra SSH từ Windows; copy 2 giá trị `BOT_TOKEN_TRADEMRBIT` + `SIGNAL_CHAT_ID` từ Vercel sang `.env` trên VPS.
