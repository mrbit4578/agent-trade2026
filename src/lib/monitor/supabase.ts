import type { DeliveryReceipt, SenderHeartbeat, SignalRow } from "./types";

export interface SupabaseEnvConfig {
  url: string;
  apiKey: string;
  signalsTable: string;
  receiptsTable: string;
  heartbeatTable: string;
}

export function getSupabaseConfig(): SupabaseEnvConfig | null {
  const url = (
    process.env.SUPABASE_URL || "https://fagveiomuwuyuzzeepvk.supabase.co"
  ).replace(/\/$/, "");
  const apiKey =
    process.env.SUPABASE_API_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_KEY?.trim() ||
    "";
  if (!apiKey) return null;

  return {
    url,
    apiKey,
    signalsTable: process.env.SUPABASE_SIGNALS_TABLE?.trim() || "signals",
    receiptsTable:
      process.env.SUPABASE_RECEIPTS_TABLE?.trim() || "delivery_receipts",
    heartbeatTable: process.env.SUPABASE_HEARTBEAT_TABLE?.trim() || "heartbeats",
  };
}

/**
 * Auth rule from brief §4:
 * CHỈ dùng header `apikey`, TUYỆT ĐỐI KHÔNG gửi `Authorization: Bearer`
 * (gửi Bearer sẽ trả 401 PGRST301 trên supabase-almond-fence).
 */
function buildSupabaseHeaders(apiKey: string): Record<string, string> {
  return {
    apikey: apiKey,
    Accept: "application/json",
  };
}

export interface FetchSignalsResult {
  available: boolean;
  rows: SignalRow[];
  note: string;
  capturedAtUtc: string;
}

export async function fetchSupabaseSignals(
  cfg: SupabaseEnvConfig,
  fromUtc: string,
  toUtc: string,
): Promise<FetchSignalsResult> {
  const capturedAtUtc = new Date().toISOString();
  const params = new URLSearchParams({
    select:
      "id,coin,side,loai,diem,gia_vao,sl,tp1,tp2,rr,phase,trang_thai,ket_qua,ts_vao,ts_dong,phien,bias_4h,cau_truc,nguon,created_at",
    order: "ts_vao.desc.nullslast",
    limit: "500",
  });

  // Read-only GET query on signals table
  const url = `${cfg.url}/rest/v1/${encodeURIComponent(cfg.signalsTable)}?${params.toString()}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: buildSupabaseHeaders(cfg.apiKey),
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        available: false,
        rows: [],
        note: `Supabase HTTP ${res.status}: ${body.slice(0, 160)}`,
        capturedAtUtc,
      };
    }

    const allRows = (await res.json()) as SignalRow[];
    const fromMs = new Date(fromUtc).getTime();
    const toMs = new Date(toUtc).getTime();

    const filtered = allRows.filter((row) => {
      const ts = row.ts_vao || row.created_at;
      if (!ts) return false;
      const ms = new Date(ts).getTime();
      if (Number.isNaN(ms)) return false;
      return ms >= fromMs && ms <= toMs;
    });

    return {
      available: true,
      rows: filtered,
      note: `Supabase ${cfg.signalsTable} (read-only GET, apikey-only auth, tổng ${allRows.length} dòng quét, ${filtered.length} dòng trong cửa sổ)`,
      capturedAtUtc,
    };
  } catch (err) {
    return {
      available: false,
      rows: [],
      note: `Lỗi kết nối Supabase: ${err instanceof Error ? err.message : String(err)}`,
      capturedAtUtc,
    };
  }
}

export interface FetchReceiptsResult {
  available: boolean;
  receipts: DeliveryReceipt[];
  note: string;
  capturedAtUtc: string;
}

export async function fetchSupabaseReceipts(
  cfg: SupabaseEnvConfig,
  signalIds: string[],
): Promise<FetchReceiptsResult> {
  const capturedAtUtc = new Date().toISOString();
  if (signalIds.length === 0) {
    return {
      available: true,
      receipts: [],
      note: "Không có tín hiệu kỳ vọng cần tra biên nhận",
      capturedAtUtc,
    };
  }

  const url = `${cfg.url}/rest/v1/${encodeURIComponent(cfg.receiptsTable)}?select=signal_id,sent_at,relay_response,telegram_message_id,checked_at,status&order=checked_at.desc&limit=500`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: buildSupabaseHeaders(cfg.apiKey),
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        available: false,
        receipts: [],
        note:
          res.status === 404
            ? `Bảng ${cfg.receiptsTable} chưa tồn tại trên Supabase (cần chạy supabase/migrations/001_delivery_receipts.sql)`
            : `Lỗi đọc ${cfg.receiptsTable} HTTP ${res.status}: ${body.slice(0, 140)}`,
        capturedAtUtc,
      };
    }

    const rows = (await res.json()) as DeliveryReceipt[];
    const idSet = new Set(signalIds);
    const matched = rows.filter((r) => idSet.has(r.signal_id));

    return {
      available: true,
      receipts: matched,
      note: `Bảng ${cfg.receiptsTable} sẵn sàng (${matched.length}/${signalIds.length} biên nhận khớp)`,
      capturedAtUtc,
    };
  } catch (err) {
    return {
      available: false,
      receipts: [],
      note: `Lỗi kết nối bảng ${cfg.receiptsTable}: ${err instanceof Error ? err.message : String(err)}`,
      capturedAtUtc,
    };
  }
}

export async function fetchSenderHeartbeat(
  cfg: SupabaseEnvConfig | null,
): Promise<SenderHeartbeat> {
  const checkedAtUtc = new Date().toISOString();
  const vpsUrl = process.env.VPS_HEARTBEAT_URL?.trim();

  if (vpsUrl) {
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (process.env.VPS_HEARTBEAT_TOKEN?.trim()) {
        headers["X-Monitor-Token"] = process.env.VPS_HEARTBEAT_TOKEN.trim();
      }
      const res = await fetch(vpsUrl, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as {
          sent_ids?: unknown[];
          last_run_at?: string;
          updated_at?: string;
        };
        const sentIds = Array.isArray(data.sent_ids)
          ? data.sent_ids.map((x) => String(x))
          : [];
        return {
          source: "VPS Linode telegram-sender heartbeat",
          available: true,
          checkedAtUtc,
          lastRunAtUtc: data.last_run_at || data.updated_at || null,
          sentIds,
          note: `Đọc thành công ${sentIds.length} sent_ids từ VPS heartbeat`,
        };
      }
      return {
        source: "VPS Linode telegram-sender heartbeat",
        available: false,
        checkedAtUtc,
        lastRunAtUtc: null,
        sentIds: [],
        note: `VPS heartbeat HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        source: "VPS Linode telegram-sender heartbeat",
        available: false,
        checkedAtUtc,
        lastRunAtUtc: null,
        sentIds: [],
        note: `Không kết nối được VPS heartbeat: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Fallback: try reading telegram-sender heartbeat from Supabase if configured
  if (cfg) {
    const url = `${cfg.url}/rest/v1/${encodeURIComponent(cfg.heartbeatTable)}?select=*&limit=20`;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: buildSupabaseHeaders(cfg.apiKey),
        cache: "no-store",
      });
      if (res.ok) {
        const rows = (await res.json()) as Array<Record<string, unknown>>;
        const senderRow = rows.find((r) => {
          const name = String(r.name ?? r.service ?? r.id ?? "").toLowerCase();
          return name.includes("telegram-sender") || name.includes("sender");
        });
        if (senderRow) {
          const rawMeta =
            (senderRow.meta as Record<string, unknown> | undefined) ??
            (senderRow.payload as Record<string, unknown> | undefined) ??
            senderRow;
          const sentIds = Array.isArray(rawMeta.sent_ids)
            ? rawMeta.sent_ids.map((x) => String(x))
            : [];
          return {
            source: `Supabase ${cfg.heartbeatTable} (telegram-sender)`,
            available: true,
            checkedAtUtc,
            lastRunAtUtc:
              typeof senderRow.updated_at === "string"
                ? senderRow.updated_at
                : typeof senderRow.last_seen === "string"
                  ? senderRow.last_seen
                  : null,
            sentIds,
            note: `Đọc ${sentIds.length} sent_ids từ heartbeat telegram-sender`,
          };
        }
      }
    } catch {
      // Ignore and fall through to unavailable
    }
  }

  return {
    source: "telegram-sender heartbeat",
    available: false,
    checkedAtUtc,
    lastRunAtUtc: null,
    sentIds: [],
    note: "chưa có dữ liệu (chưa cấu hình VPS_HEARTBEAT_URL hoặc bảng heartbeats)",
  };
}

export async function fetchAlertedSignalIds(
  cfg: SupabaseEnvConfig | null,
): Promise<Set<string>> {
  if (!cfg) return new Set();
  const url = `${cfg.url}/rest/v1/monitor_alerts?select=signal_id&limit=500`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: buildSupabaseHeaders(cfg.apiKey),
      cache: "no-store",
    });
    if (!res.ok) return new Set();
    const rows = (await res.json()) as Array<{ signal_id: string }>;
    return new Set(rows.map((r) => r.signal_id));
  } catch {
    return new Set();
  }
}

export async function recordAlertedSignalId(
  cfg: SupabaseEnvConfig | null,
  signalId: string,
  verdict: string,
  evidence: unknown,
  telegramMessageId: string | null,
): Promise<void> {
  if (!cfg) return;
  const url = `${cfg.url}/rest/v1/monitor_alerts`;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        ...buildSupabaseHeaders(cfg.apiKey),
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        signal_id: signalId,
        verdict,
        alerted_at: new Date().toISOString(),
        telegram_message_id: telegramMessageId,
        evidence,
      }),
    });
  } catch {
    // Non-fatal: in-memory dedupe still protects current instance
  }
}
