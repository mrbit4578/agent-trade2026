import { NextResponse } from "next/server";
import {
  getLastReport,
  getReportHistory,
  runMonitorPipeline,
} from "@/lib/monitor/engine";
import { getSupabaseConfig } from "@/lib/monitor/supabase";
import { getTelegramConfig } from "@/lib/monitor/telegram";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseConfigured = Boolean(getSupabaseConfig());
  const telegramConfigured = Boolean(getTelegramConfig());
  const vpsHeartbeatConfigured = Boolean(process.env.VPS_HEARTBEAT_URL?.trim());
  const cronSecretConfigured = Boolean(process.env.CRON_SECRET?.trim());
  const monitorSecretConfigured = Boolean(process.env.MONITOR_SECRET?.trim());

  let report = getLastReport();
  if (!report) {
    report = await runMonitorPipeline({
      mode: "auto",
      scenario: "live-24h-sim",
      windowHours: 24,
      sendTelegram: false,
    });
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
