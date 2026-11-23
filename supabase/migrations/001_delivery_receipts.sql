-- ============================================================================
-- P0 Migration: Durable Delivery Receipts & Alert Dedupe for Trade.2026
-- CHỈ CHẠY TRONG PROJECT: supabase-almond-fence (ref: fagveiomuwuyuzzeepvk)
-- KHÔNG chạy vào citrine-candle!
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

-- 3. BẬT ROW LEVEL SECURITY (RLS) — KHÔNG TẠO POLICY PUBLIC NÀO
-- Anon key sẽ không đọc/ghi được 2 bảng này.
-- Monitor & VPS sender dùng service key (sb_secret_..., gửi qua header apikey) nên bypass RLS.
alter table public.delivery_receipts enable row level security;
alter table public.monitor_alerts enable row level security;

comment on table public.delivery_receipts is
  'Biên nhận gửi tín hiệu bền vững cho Trade.2026 (P0 audit 21/11/2026, RLS enabled, service_role only).';
comment on table public.monitor_alerts is
  'Dedupe cảnh báo MẤT theo signal_id để không gửi trùng Telegram (RLS enabled, service_role only).';

-- Kiểm chứng sau khi chạy (cả 2 dòng phải trả về rowsecurity = true):
-- select tablename, rowsecurity from pg_tables
-- where schemaname = 'public'
--   and tablename in ('delivery_receipts', 'monitor_alerts');
