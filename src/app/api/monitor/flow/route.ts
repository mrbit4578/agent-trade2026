import { NextResponse } from "next/server";
import { evaluateLiveFlow } from "@/lib/flow/evaluator";
import type { MonitorAlertRow } from "@/lib/flow/types";
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
 * Does NOT require MONITOR_SECRET to view; never sends Telegram or mutates data.
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
  let heartbeatAvailable = report.sources.heartbeat.available;
  let heartbeatLastRunAtUtc: string | null = null;
  let heartbeatSentCount: number | null = report.sources.heartbeat.recordCount;
  let heartbeatNote = report.sources.heartbeat.note;

  if (cfg && report.mode === "live") {
    const windowTo = nowIso;
    const windowFrom = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const [sigRes, latest5Fallback, hbRes, alertsRes] = await Promise.all([
      fetchSupabaseSignals(cfg, windowFrom, windowTo),
      fetchLatestSignalsFallback(cfg.url, cfg.apiKey),
      fetchSenderHeartbeat(cfg),
      fetchRecentMonitorAlerts(cfg.url, cfg.apiKey),
    ]);

    recentSignals =
      sigRes.rows.length > 0 ? sigRes.rows : latest5Fallback;

    const candidateIds = recentSignals.map((s) => s.id);
    const recRes = await fetchSupabaseReceipts(cfg, candidateIds);
    receiptsAvailable = recRes.available;
    recentReceipts = recRes.receipts;

    heartbeatAvailable = hbRes.available;
    heartbeatLastRunAtUtc = hbRes.lastRunAtUtc;
    heartbeatSentCount = hbRes.available ? hbRes.sentIds.length : null;
    heartbeatNote = hbRes.note;

    alertsAvailable = alertsRes.available;
    recentAlerts = alertsRes.rows;
  } else {
    // Demo mode: extract heartbeat last run timestamp from report stages / source
    heartbeatLastRunAtUtc = report.sources.heartbeat.available
      ? report.stages[0]?.finishedAtUtc ?? nowIso
      : null;
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
    heartbeatAvailable,
    heartbeatLastRunAtUtc,
    heartbeatSentCount,
    heartbeatNote,
    recentRuns,
  });

  return NextResponse.json(payload);
}
