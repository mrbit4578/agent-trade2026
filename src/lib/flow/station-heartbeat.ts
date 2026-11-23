import { formatDateTimeVn } from "@/lib/flow/evaluator";
import type {
  CollectorHeartbeatInfo,
  FlowStationHeartbeatInfo,
  SenderHeartbeatInfo,
} from "@/lib/flow/types";
import { fetchSenderHeartbeat, type SupabaseEnvConfig } from "@/lib/monitor/supabase";

export interface StationHeartbeatRow {
  tram?: string;
  cap_nhat?: string;
  meta?: Record<string, unknown> | null;
}

export interface UnifiedStationHeartbeats {
  stationTableAvailable: boolean;
  stationTableNote: string;
  collector: CollectorHeartbeatInfo;
  sender: SenderHeartbeatInfo;
  flow?: FlowStationHeartbeatInfo;
}

function asNumber(val: unknown): number | null {
  return typeof val === "number" && Number.isFinite(val) ? val : null;
}

function asArrayLength(val: unknown): number | null {
  return Array.isArray(val) ? val.length : null;
}

/**
 * Shared read-only reader for Supabase `station_heartbeat` table.
 * Used by BOTH the old Dashboard (`/api/monitor/status`) and Live Flow (`/api/monitor/flow`)
 * so both screens always display identical heartbeat timestamps and counts.
 *
 * Auth rule: ONLY `apikey` header, NEVER `Authorization: Bearer`.
 */
export async function readUnifiedStationHeartbeats(
  cfg: SupabaseEnvConfig | null,
): Promise<UnifiedStationHeartbeats> {
  const collector: CollectorHeartbeatInfo = {
    available: false,
    updatedAtUtc: null,
    banGhi: null,
    source: "Supabase station_heartbeat (collector-247)",
    note: "chưa có dữ liệu heartbeat collector-247",
  };

  let sender: SenderHeartbeatInfo = {
    available: false,
    updatedAtUtc: null,
    lastRunAtUtc: null,
    guiDuoc: null,
    sentIdsCount: null,
    failedCount: null,
    source: "Supabase station_heartbeat (telegram-sender)",
    note: "chưa có dữ liệu heartbeat telegram-sender",
  };

  let flow: FlowStationHeartbeatInfo | undefined;
  let stationTableAvailable = false;
  let stationTableNote = "chưa cấu hình Supabase";

  if (cfg) {
    try {
      const res = await fetch(
        `${cfg.url}/rest/v1/station_heartbeat?select=tram,cap_nhat,meta&limit=20`,
        {
          method: "GET",
          headers: {
            apikey: cfg.apiKey,
            Accept: "application/json",
          },
          cache: "no-store",
        },
      );

      if (res.ok) {
        const rows = (await res.json()) as StationHeartbeatRow[];
        stationTableAvailable = true;
        stationTableNote = `Đọc thành công ${rows.length} dòng từ station_heartbeat`;

        const findTram = (name: string) =>
          rows.find(
            (r) => String(r.tram ?? "").toLowerCase() === name.toLowerCase(),
          );

        const colRow = findTram("collector-247");
        if (colRow && colRow.cap_nhat) {
          const meta = (colRow.meta ?? {}) as Record<string, unknown>;
          collector.available = true;
          collector.updatedAtUtc = colRow.cap_nhat;
          collector.banGhi = asNumber(meta.ban_ghi);
          collector.note = `Heartbeat collector-247 cập nhật ${formatDateTimeVn(colRow.cap_nhat)}`;
        }

        const senderRow = findTram("telegram-sender");
        if (senderRow && senderRow.cap_nhat) {
          const meta = (senderRow.meta ?? {}) as Record<string, unknown>;
          const lastRun =
            typeof meta.last_run === "string"
              ? meta.last_run
              : senderRow.cap_nhat;
          const guiDuoc = asNumber(meta.gui_duoc) ?? 0;
          const sentIdsCount = asArrayLength(meta.sent_ids) ?? 0;
          const failedCount = asArrayLength(meta.that_bai) ?? 0;

          sender = {
            available: true,
            updatedAtUtc: senderRow.cap_nhat,
            lastRunAtUtc: lastRun,
            guiDuoc,
            sentIdsCount,
            failedCount,
            source: "Supabase station_heartbeat (telegram-sender)",
            note: formatSenderHeartbeatNote({
              updatedAtUtc: senderRow.cap_nhat,
              guiDuoc,
              sentIdsCount,
              failedCount,
            }),
          };
        }

        const flowRow = findTram("flow-247");
        if (flowRow && flowRow.cap_nhat) {
          flow = {
            available: true,
            updatedAtUtc: flowRow.cap_nhat,
            note: `Heartbeat flow-247 cập nhật ${formatDateTimeVn(flowRow.cap_nhat)}`,
          };
        }
      } else {
        stationTableNote = `station_heartbeat HTTP ${res.status}`;
      }
    } catch (err) {
      stationTableNote = `Lỗi đọc station_heartbeat: ${err instanceof Error ? err.message : String(err)}`;
    }

    // VPS_HEARTBEAT_URL is ONLY an optional fallback when station_heartbeat doesn't have telegram-sender
    if (!sender.available && process.env.VPS_HEARTBEAT_URL?.trim()) {
      const fallbackHb = await fetchSenderHeartbeat(cfg);
      if (fallbackHb.available) {
        sender = {
          available: true,
          updatedAtUtc: fallbackHb.lastRunAtUtc || fallbackHb.checkedAtUtc,
          lastRunAtUtc: fallbackHb.lastRunAtUtc,
          guiDuoc: fallbackHb.sentIds.length,
          sentIdsCount: fallbackHb.sentIds.length,
          failedCount: 0,
          source: fallbackHb.source,
          note: formatSenderHeartbeatNote({
            updatedAtUtc: fallbackHb.lastRunAtUtc || fallbackHb.checkedAtUtc,
            guiDuoc: fallbackHb.sentIds.length,
            sentIdsCount: fallbackHb.sentIds.length,
            failedCount: 0,
          }),
        };
      }
    }

    if (!sender.available) {
      sender.note = stationTableAvailable
        ? "Không thấy tram='telegram-sender' trong bảng station_heartbeat"
        : stationTableNote;
    }
  }

  return {
    stationTableAvailable,
    stationTableNote,
    collector,
    sender,
    flow,
  };
}

export function formatSenderHeartbeatNote(params: {
  updatedAtUtc: string | null;
  guiDuoc: number;
  sentIdsCount: number;
  failedCount: number;
}): string {
  const timeStr = formatDateTimeVn(params.updatedAtUtc);
  const idleSuffix =
    params.guiDuoc === 0 && params.sentIdsCount === 0
      ? " — đang chạy, không có gì để gửi"
      : "";
  return `Chạy cuối: ${timeStr} · Đã gửi: ${params.guiDuoc} tin · Lỗi: ${params.failedCount}${idleSuffix}`;
}
