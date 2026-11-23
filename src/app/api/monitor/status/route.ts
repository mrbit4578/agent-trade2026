import { NextResponse } from "next/server";
import { readUnifiedStationHeartbeats } from "@/lib/flow/station-heartbeat";
import {
  getLastReport,
  getReportHistory,
  runMonitorPipeline,
} from "@/lib/monitor/engine";
import { getSupabaseConfig } from "@/lib/monitor/supabase";
import { getTelegramConfig } from "@/lib/monitor/telegram";
import { formatUtc } from "@/lib/monitor/time";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = getSupabaseConfig();
  const supabaseConfigured = Boolean(cfg);
  const telegramConfigured = Boolean(getTelegramConfig());
  const vpsHeartbeatConfigured = Boolean(process.env.VPS_HEARTBEAT_URL?.trim());
  const cronSecretConfigured = Boolean(process.env.CRON_SECRET?.trim());
  const monitorSecretConfigured = Boolean(process.env.MONITOR_SECRET?.trim());

  let baseReport = getLastReport();
  if (!baseReport) {
    baseReport = await runMonitorPipeline({
      mode: "auto",
      scenario: "live-24h-sim",
      windowHours: 24,
      sendTelegram: false,
    });
  }

  // Unify telegram-sender heartbeat display with Live Flow (read from Supabase station_heartbeat)
  let report = baseReport;
  if (cfg && baseReport.mode === "live") {
    const unifiedHb = await readUnifiedStationHeartbeats(cfg);
    const sender = unifiedHb.sender;
    report = {
      ...baseReport,
      sources: {
        ...baseReport.sources,
        heartbeat: {
          name: sender.source,
          available: sender.available,
          recordCount: sender.guiDuoc ?? sender.sentIdsCount,
          capturedAtUtc: formatUtc(sender.updatedAtUtc || new Date()),
          note: sender.note,
        },
      },
    };
  }

  return NextResponse.json({
    ok: true,
    envStatus: {
      supabaseConfigured,
      telegramConfigured,
      vpsHeartbeatConfigured,
      cronSecretConfigured,
      monitorSecretConfigured,
      mode: supabaseConfigured ? "live" : "demo",
      supabaseHost: process.env.SUPABASE_URL
        ? new URL(process.env.SUPABASE_URL).host
        : "fagveiomuwuyuzzeepvk.supabase.co",
    },
    report,
    historyCount: getReportHistory().length,
    history: getReportHistory().map((r) => ({
      runId: r.runId,
      mode: r.mode,
      scenario: r.scenario ?? null,
      windowLabel: r.windowLabel,
      capturedAtUtc: r.capturedAtUtc,
      capturedAtVn: r.capturedAtVn,
      counts: r.counts,
      telegramSent: r.telegram.sent,
    })),
  });
}
