-- ============================================================================
-- P0 Migration: Durable Delivery Receipts & Alert Dedupe for Trade.2026
-- Target: Supabase project supabase-almond-fence (ref: fagveiomuwuyuzzeepvk)
-- ============================================================================

-- 1. Bảng biên nhận bền vững (ghi bởi tools/telegram-sender.js trên VPS)
-- Khắc phục lỗ hổng /tmp trên Vercel relay (chỉ giữ 50 bản ghi, mất khi cold start).
create table if not exists public.delivery_receipts (
  signal_id text primary key,
  sent_at timestamptz,
  relay_response jsonb,
  telegram_message_id text,
  checked_at timestamptz not null default now(),
  status text not null check (status in ('sent', 'duplicate', 'failed'))
);

create index if not exists idx_delivery_receipts_checked_at
  on public.delivery_receipts (checked_at desc);

create index if not exists idx_delivery_receipts_status
  on public.delivery_receipts (status);

-- 2. Bảng lưu lịch sử cảnh báo MẤT đã gửi (dedupe bền theo signal_id cho Agent Điều phối)
create table if not exists public.monitor_alerts (
  signal_id text primary key,
  verdict text not null,
  alerted_at timestamptz not null default now(),
  telegram_message_id text,
  evidence jsonb
);

-- Bật RLS nếu dự án đang dùng anon key chỉ đọc trên bảng signals
-- (điều chỉnh policy theo role thực tế của supabase-almond-fence)
comment on table public.delivery_receipts is
  'Biên nhận gửi tín hiệu bền vững cho Trade.2026 (P0 audit 21/11/2026).';
comment on table public.monitor_alerts is
  'Dedupe cảnh báo MẤT theo signal_id để không gửi trùng Telegram.';
