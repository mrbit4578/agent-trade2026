import { NextResponse } from "next/server";
import { evaluateLiveFlow } from "@/lib/flow/evaluator";
import type {
  CollectorHeartbeatInfo,
  FlowStationHeartbeatInfo,
  MonitorAlertRow,
  SenderHeartbeatInfo,
} from "@/lib/flow/types";
import {
  getLastReport,
  getReportHistory,
  runMonitorPipeline,
} from "@/lib/monitor/engine";
import {
  fetchSenderHeartbeat,
  fetchSupabaseReceipts,
  fetchSupabaseSignals,
  getSupabaseConfig,
} from "@/lib/monitor/supabase";
import type { DeliveryReceipt, SignalRow } from "@/lib/monitor/types";

export const dynamic = "force-dynamic";

interface StationHeartbeatRow {
  tram?: string;
  cap_nhat?: string;
  meta?: Record<string, unknown> | null;
}

async function fetchStationHeartbeats(
  url: string,
  apiKey: string,
): Promise<{ available: boolean; rows: StationHeartbeatRow[]; note: string }> {
  try {
    // Auth: CHỈ header `apikey`, KHÔNG gửi `Authorization` (tránh 401 PGRST301)
    const res = await fetch(
      `${url}/rest/v1/station_heartbeat?select=tram,cap_nhat,meta&limit=20`,
      {
        method: "GET",
        headers: {
          apikey: apiKey,
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );
    if (!res.ok) {
      return {
        available: false,
        rows: [],
        note: `station_heartbeat HTTP ${res.status}`,
      };
    }
    const rows = (await res.json()) as StationHeartbeatRow[];
    return {
      available: true,
      rows,
      note: `Đọc thành công ${rows.length} dòng từ station_heartbeat`,
    };
  } catch (err) {
    return {
      available: false,
      rows: [],
      note: `Lỗi đọc station_heartbeat: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function fetchRecentMonitorAlerts(
  url: string,
  apiKey: string,
): Promise<{ available: boolean; rows: MonitorAlertRow[] }> {
  try {
    const res = await fetch(
      `${url}/rest/v1/monitor_alerts?select=signal_id,verdict,alerted_at,telegram_message_id&order=alerted_at.desc&limit=5`,
      {
        method: "GET",
        headers: {
          apikey: apiKey,
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );
    if (!res.ok) return { available: false, rows: [] };
    const rows = (await res.json()) as MonitorAlertRow[];
    return { available: true, rows };
  } catch {
    return { available: false, rows: [] };
  }
}

async function fetchLatestSignalsFallback(
  url: string,
  apiKey: string,
): Promise<SignalRow[]> {
  try {
    const res = await fetch(
      `${url}/rest/v1/signals?select=id,coin,side,loai,diem,gia_vao,sl,tp1,tp2,rr,phase,trang_thai,ket_qua,ts_vao,ts_dong,phien,bias_4h,cau_truc,nguon,created_at&order=created_at.desc.nullslast&limit=5`,
      {
        method: "GET",
        headers: {
          apikey: apiKey,
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );
    if (!res.ok) return [];
    return (await res.json()) as SignalRow[];
  } catch {
    return [];
  }
}

function asNumber(val: unknown): number | null {
  return typeof val === "number" && Number.isFinite(val) ? val : null;
}

function asArrayLength(val: unknown): number | null {
  return Array.isArray(val) ? val.length : null;
}

/**
 * GET /api/monitor/flow
 * Strictly read-only endpoint powering the "Dòng chảy live" screen.
 * Reads Supabase `station_heartbeat` (`collector-247`, `telegram-sender`, `flow-247`)
 * with apikey-only auth; falls back to VPS_HEARTBEAT_URL only when needed.
 */
export async function GET() {
  const nowIso = new Date().toISOString();
  const cfg = getSupabaseConfig();

  let report = getLastReport();
  if (!report) {
    report = await runMonitorPipeline({
      mode: "auto",
      scenario: "live-24h-sim",
      windowHours: 24,
      sendTelegram: false,
    });
  }

  let recentSignals: SignalRow[] = report.items.map((i) => i.signal);
  let recentReceipts: DeliveryReceipt[] = report.items
    .map((i) => i.receipt)
    .filter((r): r is DeliveryReceipt => r !== null);
  let recentAlerts: MonitorAlertRow[] = [];
  let receiptsAvailable = report.sources.receipts.available;
  let alertsAvailable = false;

  let collectorHeartbeat: CollectorHeartbeatInfo = {
    available: false,
    updatedAtUtc: null,
    banGhi: null,
    source: "Supabase station_heartbeat (collector-247)",
    note: "chưa có dữ liệu heartbeat collector-247",
  };

  let senderHeartbeat: SenderHeartbeatInfo = {
    available: false,
    updatedAtUtc: null,
    lastRunAtUtc: null,
    guiDuoc: null,
    sentIdsCount: null,
    failedCount: null,
    source: "Supabase station_heartbeat (telegram-sender)",
    note: "chưa có dữ liệu heartbeat telegram-sender",
  };

  let flowHeartbeat: FlowStationHeartbeatInfo | undefined;

  if (cfg && report.mode === "live") {
    const windowTo = nowIso;
    const windowFrom = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const [sigRes, latest5Fallback, stationRes, alertsRes] = await Promise.all([
      fetchSupabaseSignals(cfg, windowFrom, windowTo),
      fetchLatestSignalsFallback(cfg.url, cfg.apiKey),
      fetchStationHeartbeats(cfg.url, cfg.apiKey),
      fetchRecentMonitorAlerts(cfg.url, cfg.apiKey),
    ]);

    recentSignals = sigRes.rows.length > 0 ? sigRes.rows : latest5Fallback;

    const candidateIds = recentSignals.map((s) => s.id);
    const recRes = await fetchSupabaseReceipts(cfg, candidateIds);
    receiptsAvailable = recRes.available;
    recentReceipts = recRes.receipts;

    alertsAvailable = alertsRes.available;
    recentAlerts = alertsRes.rows;

    if (stationRes.available) {
      const findTram = (name: string) =>
        stationRes.rows.find(
          (r) => String(r.tram ?? "").toLowerCase() === name.toLowerCase(),
        );

      const colRow = findTram("collector-247");
      if (colRow && colRow.cap_nhat) {
        const meta = (colRow.meta ?? {}) as Record<string, unknown>;
        collectorHeartbeat = {
          available: true,
          updatedAtUtc: colRow.cap_nhat,
          banGhi: asNumber(meta.ban_ghi),
          source: "Supabase station_heartbeat (collector-247)",
          note: `Heartbeat collector-247 cập nhật ${colRow.cap_nhat}`,
        };
      }

      const senderRow = findTram("telegram-sender");
      if (senderRow && senderRow.cap_nhat) {
        const meta = (senderRow.meta ?? {}) as Record<string, unknown>;
        const lastRun =
          typeof meta.last_run === "string" ? meta.last_run : senderRow.cap_nhat;
        senderHeartbeat = {
          available: true,
          updatedAtUtc: senderRow.cap_nhat,
          lastRunAtUtc: lastRun,
          guiDuoc: asNumber(meta.gui_duoc) ?? 0,
          sentIdsCount: asArrayLength(meta.sent_ids) ?? 0,
          failedCount: asArrayLength(meta.that_bai) ?? 0,
          source: "Supabase station_heartbeat (telegram-sender)",
          note: `Heartbeat telegram-sender từ Supabase station_heartbeat`,
        };
      }

      const flowRow = findTram("flow-247");
      if (flowRow && flowRow.cap_nhat) {
        flowHeartbeat = {
          available: true,
          updatedAtUtc: flowRow.cap_nhat,
          note: `Heartbeat flow-247 cập nhật ${flowRow.cap_nhat}`,
        };
      }
    }

    // Fallback to VPS_HEARTBEAT_URL ONLY if station_heartbeat didn't have telegram-sender
    if (!senderHeartbeat.available) {
      const fallbackHb = await fetchSenderHeartbeat(cfg);
      if (fallbackHb.available) {
        senderHeartbeat = {
          available: true,
          updatedAtUtc: fallbackHb.lastRunAtUtc || fallbackHb.checkedAtUtc,
          lastRunAtUtc: fallbackHb.lastRunAtUtc,
          guiDuoc: fallbackHb.sentIds.length,
          sentIdsCount: fallbackHb.sentIds.length,
          failedCount: 0,
          source: fallbackHb.source,
          note: fallbackHb.note,
        };
      } else {
        senderHeartbeat.note = stationRes.available
          ? "Không thấy tram='telegram-sender' trong station_heartbeat và chưa cấu hình VPS_HEARTBEAT_URL"
          : `${stationRes.note} · ${fallbackHb.note}`;
      }
    }
  } else {
    // Demo sandbox mode (no SUPABASE_API_KEY configured)
    const nowMs = new Date(nowIso).getTime();
    const minAgo = (m: number) => new Date(nowMs - m * 60000).toISOString();
    collectorHeartbeat = {
      available: true,
      updatedAtUtc: minAgo(5),
      banGhi: report.counts.rawSignalsScanned,
      source: "Demo sandbox (collector-247)",
      note: "Demo heartbeat collector-247 (gắn SUPABASE_SERVICE_KEY để đọc station_heartbeat thật)",
    };
    senderHeartbeat = {
      available: report.sources.heartbeat.available,
      updatedAtUtc: report.sources.heartbeat.available ? minAgo(2) : null,
      lastRunAtUtc: report.sources.heartbeat.available ? minAgo(2) : null,
      guiDuoc: report.sources.heartbeat.recordCount ?? 0,
      sentIdsCount: report.sources.heartbeat.recordCount ?? 0,
      failedCount: 0,
      source: "Demo sandbox (telegram-sender)",
      note: report.sources.heartbeat.note,
    };
  }

  const history = getReportHistory();
  const recentRuns = history.slice(0, 5).map((r) => ({
    runId: r.runId,
    mode: r.mode,
    capturedAtIso: r.stages[r.stages.length - 1]?.finishedAtUtc ?? nowIso,
    capturedAtVn: r.capturedAtVn,
    triggerKind: (r.telegram.mode === "live" ? "scheduled" : "manual") as
      | "manual"
      | "scheduled"
      | "auto_init",
    qualifiedExpected: r.counts.qualifiedExpected,
    du: r.counts.du,
    muon: r.counts.muon,
    matConfirmed: r.counts.matConfirmed,
    canKiemTra: r.counts.canKiemTra,
    canhBaoGia: r.counts.canhBaoGia,
    telegramSent: r.telegram.sent,
  }));

  const payload = evaluateLiveFlow({
    nowIso,
    mode: report.mode,
    report,
    recentSignals,
    recentReceipts,
    recentAlerts,
    receiptsAvailable,
    alertsAvailable,
    collectorHeartbeat,
    senderHeartbeat,
    flowHeartbeat,
    recentRuns,
  });

  return NextResponse.json(payload);
}
