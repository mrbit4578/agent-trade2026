import { NextResponse } from "next/server";
import { runMonitorPipeline } from "@/lib/monitor/engine";

export const dynamic = "force-dynamic";

// Vercel Cron endpoint — chạy mỗi 15 phút (vercel.json: every 15 minutes)
// Khớp nhịp collector-15m của Trade.2026, quét cửa sổ 24h gần nhất.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  const now = new Date();
  // Gửi báo cáo tổng kết ngày 1 lần vào khung 00:00–00:14 UTC (07:00–07:14 VN)
  const isMorningDigestWindow =
    now.getUTCHours() === 0 && now.getUTCMinutes() < 15;

  const report = await runMonitorPipeline({
    mode: "auto",
    windowHours: 24,
    sendTelegram: true,
    includeDailyDigest: isMorningDigestWindow,
  });

  return NextResponse.json({
    ok: true,
    triggeredBy: "vercel-cron",
    isMorningDigestWindow,
    runId: report.runId,
    mode: report.mode,
    capturedAtUtc: report.capturedAtUtc,
    counts: report.counts,
    telegram: {
      attempted: report.telegram.attempted,
      sent: report.telegram.sent,
      mode: report.telegram.mode,
      newlyAlertedIds: report.telegram.newlyAlertedIds,
      dedupedIds: report.telegram.dedupedIds,
    },
  });
}
