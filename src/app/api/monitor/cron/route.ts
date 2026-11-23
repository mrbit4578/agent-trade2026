import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { runMonitorPipeline } from "@/lib/monitor/engine";

export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function isCronAuthorized(request: Request): boolean {
  const allowedSecrets = [
    process.env.MONITOR_SECRET?.trim(),
    process.env.CRON_SECRET?.trim(),
  ].filter((s): s is string => Boolean(s));

  if (allowedSecrets.length === 0) return false;

  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const headerSecret = request.headers.get("x-monitor-secret")?.trim();
  const got = bearer || headerSecret;

  if (!got) return false;
  return allowedSecrets.some((secret) => safeEqual(got, secret));
}

// Vercel Cron endpoint — chạy hằng ngày trên Hobby (00:00 UTC = 07:00 VN)
// hoặc được kích hoạt mỗi 15 phút từ GitHub Actions kèm Authorization: Bearer $MONITOR_SECRET.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
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
    triggeredBy: "cron",
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
