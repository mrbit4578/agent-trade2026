import { NextResponse } from "next/server";
import { runMonitorPipeline } from "@/lib/monitor/engine";
import type { DemoScenarioId, MonitorRunOptions } from "@/lib/monitor/types";

export const dynamic = "force-dynamic";

const ALLOWED_SCENARIOS = new Set<DemoScenarioId>([
  "live-24h-sim",
  "acceptance-2026-11-10",
  "clean-day",
]);

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<MonitorRunOptions>;

    const scenario =
      body.scenario && ALLOWED_SCENARIOS.has(body.scenario)
        ? body.scenario
        : "live-24h-sim";

    const windowHours =
      typeof body.windowHours === "number" &&
      body.windowHours >= 1 &&
      body.windowHours <= 720
        ? body.windowHours
        : 24;

    const report = await runMonitorPipeline({
      mode:
        body.mode === "live" || body.mode === "demo" || body.mode === "auto"
          ? body.mode
          : "auto",
      scenario,
      windowHours,
      fromUtc: typeof body.fromUtc === "string" && body.fromUtc ? body.fromUtc : undefined,
      toUtc: typeof body.toUtc === "string" && body.toUtc ? body.toUtc : undefined,
      sendTelegram: Boolean(body.sendTelegram),
      includeDailyDigest: Boolean(body.includeDailyDigest),
    });

    return NextResponse.json({ ok: true, report });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Lỗi chạy pipeline giám sát",
      },
      { status: 500 },
    );
  }
}
