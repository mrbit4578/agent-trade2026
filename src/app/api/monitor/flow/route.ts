import { NextResponse } from "next/server";
import { evaluateLiveFlow } from "@/lib/flow/evaluator";
import { readUnifiedStationHeartbeats } from "@/lib/flow/station-heartbeat";
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
  fetchSupabaseReceipts,
  fetchSupabaseSignals,
  getSupabaseConfig,
} from "@/lib/monitor/supabase";
import type { DeliveryReceipt, SignalRow } from "@/lib/monitor/types";

export const dynamic = "force-dynamic";

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

/**
 * GET /api/monitor/flow
 * Strictly read-only endpoint powering the "Dòng chảy live" screen.
 * Uses the shared `readUnifiedStationHeartbeats` helper so Dashboard & Flow stay 100% in sync.
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

  let collectorHeartbeat: CollectorHeartbeatInfo;
  let senderHeartbeat: SenderHeartbeatInfo;
  let flowHeartbeat: FlowStationHeartbeatInfo | undefined;

  if (cfg && report.mode === "live") {
    const windowTo = nowIso;
    const windowFrom = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const [sigRes, latest5Fallback, unifiedHb, alertsRes] = await Promise.all([
      fetchSupabaseSignals(cfg, windowFrom, windowTo),
      fetchLatestSignalsFallback(cfg.url, cfg.apiKey),
      readUnifiedStationHeartbeats(cfg),
      fetchRecentMonitorAlerts(cfg.url, cfg.apiKey),
    ]);

    recentSignals = sigRes.rows.length > 0 ? sigRes.rows : latest5Fallback;

    const candidateIds = recentSignals.map((s) => s.id);
    const recRes = await fetchSupabaseReceipts(cfg, candidateIds);
    receiptsAvailable = recRes.available;
    recentReceipts = recRes.receipts;

    alertsAvailable = alertsRes.available;
    recentAlerts = alertsRes.rows;

    collectorHeartbeat = unifiedHb.collector;
    senderHeartbeat = unifiedHb.sender;
    flowHeartbeat = unifiedHb.flow;
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
