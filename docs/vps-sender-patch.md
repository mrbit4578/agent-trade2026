# P0 — Bản vá tối thiểu cho `tools/telegram-sender.js` trên VPS Linode

Theo mục §5 trong `brief-antigravity-agent-giam-sat-trade2026.md`, đây là **thay đổi duy nhất** chạm vào code trạm VPS trong v1:
- Lấy `main` mới nhất trước khi sửa (`git pull origin main`).
- Chỉ thêm hàm ghi biên nhận vào bảng `delivery_receipts` trên Supabase ngay sau khi relay (`POST https://bot-tele-2026.vercel.app/api/signal-relay`) trả kết quả (`sent` | `duplicate` | `failed`).
- Auth Supabase: **CHỈ gửi header `apikey`**, **KHÔNG** gửi `Authorization: Bearer` (tránh lỗi `401 PGRST301`).
- Không sửa logic lọc tín hiệu, không thêm retry trong v1, không sửa bảng `signals`.

## Helper ghi biên nhận bền (`recordDeliveryReceipt`)

```js
async function recordDeliveryReceipt({ signalId, relayResponse, status, sentAt }) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_API_KEY;
  if (!supabaseUrl || !supabaseKey) return;

  const payload = {
    signal_id: String(signalId),
    sent_at: status === "sent" || status === "duplicate" ? (sentAt || new Date().toISOString()) : null,
    relay_response: relayResponse ?? null,
    telegram_message_id:
      relayResponse?.telegram_message_id ??
      relayResponse?.message_id ??
      relayResponse?.result?.message_id ??
      null,
    checked_at: new Date().toISOString(),
    status, // 'sent' | 'duplicate' | 'failed'
  };

  try {
    const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/delivery_receipts`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("[receipt] Supabase insert failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("[receipt] Network error:", err?.message || err);
  }
}
```

## Điểm gọi trong `telegram-sender.js`

Ngay sau khi nhận phản hồi từ `signal-relay`:

```js
const status =
  relayJson?.sent === true
    ? "sent"
    : relayJson?.sent === false && relayJson?.reason === "duplicate"
      ? "duplicate"
      : "failed";

await recordDeliveryReceipt({
  signalId: signal.id,
  relayResponse: relayJson,
  status,
});
```

Sau khi deploy lên VPS `/opt/trade2026`, kiểm chứng bằng cách restart service và truy vấn lại `delivery_receipts` trên Supabase để xác nhận biên nhận vẫn còn nguyên vẹn.
