import { evaluateLiveFlow } from "../src/lib/flow/evaluator";
import type { FlowRawSnapshot } from "../src/lib/flow/types";
import { runMonitorPipeline } from "../src/lib/monitor/engine";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

async function buildBaseSnapshot(nowIso: string): Promise<FlowRawSnapshot> {
  const report = await runMonitorPipeline({
    mode: "demo",
    scenario: "live-24h-sim",
    sendTelegram: false,
  });

  const nowMs = new Date(nowIso).getTime();
  const minAgo = (m: number) => new Date(nowMs - m * 60000).toISOString();

  // Make all 4 agent stages fresh (5 minutes ago)
  const freshReport = {
    ...report,
    stages: report.stages.map((s) => ({
      ...s,
      startedAtUtc: minAgo(5),
      finishedAtUtc: minAgo(5),
    })),
  };

  // Fresh signal 10 minutes ago
  const freshSignals = report.items.map((i, idx) => ({
    ...i.signal,
    created_at: minAgo(10 + idx * 15),
    ts_vao: minAgo(10 + idx * 15),
  }));

  return {
    nowIso,
    mode: "live",
    report: freshReport,
    recentSignals: freshSignals,
    recentReceipts: report.items
      .map((i) => i.receipt)
      .filter((r): r is NonNullable<typeof r> => r !== null),
    recentAlerts: [],
    receiptsAvailable: true,
    alertsAvailable: true,
    heartbeatAvailable: true,
    heartbeatLastRunAtUtc: minAgo(3),
    heartbeatSentCount: 3,
    heartbeatNote: "Heartbeat OK",
    recentRuns: [
      {
        runId: freshReport.runId,
        mode: "live",
        capturedAtIso: minAgo(5),
        capturedAtVn: freshReport.capturedAtVn,
        triggerKind: "manual",
        qualifiedExpected: freshReport.counts.qualifiedExpected,
        du: freshReport.counts.du,
        muon: freshReport.counts.muon,
        matConfirmed: freshReport.counts.matConfirmed,
        canKiemTra: freshReport.counts.canKiemTra,
        canhBaoGia: freshReport.counts.canhBaoGia,
        telegramSent: false,
      },
    ],
  };
}

async function main() {
  const nowIso = "2026-11-23T09:00:00.000Z"; // 16:00 VN
  const nowMs = new Date(nowIso).getTime();
  const minAgo = (m: number) => new Date(nowMs - m * 60000).toISOString();

  console.log("=== Trade.2026 Live Signal Flow — Acceptance Tests ===");

  // TEST 1 (§8.1): 6 nút đúng thứ tự + banner tổng + thời gian cập nhật + số liệu khớp dashboard
  const base = await buildBaseSnapshot(nowIso);
  const flowHealthy = evaluateLiveFlow(base);
  const expectedOrder = [
    "collector",
    "soat",
    "do",
    "chot",
    "dieu_phoi",
    "telegram",
  ];
  assert(flowHealthy.nodes.length === 6, "Must have exactly 6 nodes");
  assert(
    flowHealthy.nodes.map((n) => n.id).join(",") === expectedOrder.join(","),
    "Nodes must be in exact order collector->soat->do->chot->dieu_phoi->telegram",
  );
  assert(
    flowHealthy.banner.level === "green" &&
      flowHealthy.banner.headline.includes("DÒNG CHẢY ĐANG SỐNG"),
    `Expected green banner when all 6 nodes fresh, got: ${flowHealthy.banner.headline}`,
  );
  assert(
    flowHealthy.nodes[1].metrics[1].value === base.report.counts.qualifiedExpected,
    "Agent 1 Soát qualified count must match dashboard report",
  );
  console.log(
    `[PASS] T1_SIX_NODES_AND_BANNER — 6 nút đúng thứ tự, banner="${flowHealthy.banner.headline}"`,
  );

  // TEST 2 (§8.2): Giả lập heartbeat cũ > 30 phút -> nút Telegram chuyển ĐỎ + banner báo đúng "ĐANG KẸT TẠI Đầu ra — Telegram từ HH:MM"
  const staleHbSnap: FlowRawSnapshot = {
    ...base,
    heartbeatLastRunAtUtc: minAgo(42), // 15:18 VN
  };
  const flowStaleHb = evaluateLiveFlow(staleHbSnap);
  const tgNode = flowStaleHb.nodes[5];
  assert(tgNode.status === "red", `Expected Node 6 red, got ${tgNode.status}`);
  assert(
    Boolean(tgNode.stuckMessage?.includes("KẸT TẠI ĐÂY từ 15:18 (cách đây 42 phút)")),
    `Expected stuckMessage with 15:18 & 42 phút, got: ${tgNode.stuckMessage}`,
  );
  assert(
    flowStaleHb.banner.level === "red" &&
      flowStaleHb.banner.headline.includes("ĐANG KẸT TẠI Đầu ra — Telegram từ 15:18"),
    `Expected red banner naming Đầu ra — Telegram từ 15:18, got: ${flowStaleHb.banner.headline}`,
  );
  console.log(
    `[PASS] T2_STALE_HEARTBEAT_RED — Node 6 RED (${tgNode.stuckMessage}), banner="${flowStaleHb.banner.headline}"`,
  );

  // TEST 3 (§8.3): Giả lập không có tín hiệu mới > 60 phút -> nút Trạm ĐỎ, các nút sau chuyển XÁM "chờ dữ liệu" (không xanh giả)
  const staleSigSnap: FlowRawSnapshot = {
    ...base,
    recentSignals: base.recentSignals.map((s, idx) => ({
      ...s,
      created_at: minAgo(75 + idx * 10), // 14:45 VN
      ts_vao: minAgo(75 + idx * 10),
    })),
  };
  const flowStaleSig = evaluateLiveFlow(staleSigSnap);
  assert(
    flowStaleSig.nodes[0].status === "red",
    `Expected Node 1 red, got ${flowStaleSig.nodes[0].status}`,
  );
  assert(
    Boolean(
      flowStaleSig.nodes[0].stuckMessage?.includes("KẸT TẠI ĐÂY từ 14:45 (cách đây 75 phút)"),
    ),
    `Expected Node 1 stuckMessage, got: ${flowStaleSig.nodes[0].stuckMessage}`,
  );
  for (let i = 1; i <= 5; i++) {
    const n = flowStaleSig.nodes[i];
    assert(
      n.status === "grey_waiting" && n.statusLabel === "CHỜ DỮ LIỆU",
      `Expected downstream node ${n.name} to be grey_waiting (CHỜ DỮ LIỆU), got ${n.status} (${n.statusLabel})`,
    );
  }
  console.log(
    `[PASS] T3_STALE_SIGNAL_CASCADE_WAITING — Node 1 RED (14:45, 75p), Nodes 2..6 all GREY (CHỜ DỮ LIỆU)`,
  );

  // TEST 4 (§5): Heartbeat chưa cấu hình -> nút 6 PHẢI là XÁM CHƯA CÓ DỮ LIỆU, không tự xanh hoá
  const noHbSnap: FlowRawSnapshot = {
    ...base,
    heartbeatAvailable: false,
    heartbeatLastRunAtUtc: null,
    heartbeatSentCount: null,
    heartbeatNote: "chưa có dữ liệu (chưa cấu hình VPS_HEARTBEAT_URL)",
  };
  const flowNoHb = evaluateLiveFlow(noHbSnap);
  assert(
    flowNoHb.nodes[5].status === "grey_no_data" &&
      flowNoHb.nodes[5].statusLabel === "CHƯA CÓ DỮ LIỆU",
    `Expected Node 6 grey_no_data when heartbeat unavailable, got ${flowNoHb.nodes[5].status}`,
  );
  assert(
    flowNoHb.banner.level !== "green",
    "Banner must NOT be green when heartbeat has no data",
  );
  console.log(
    `[PASS] T4_HONEST_NO_DATA — Heartbeat missing → Node 6 GREY (CHƯA CÓ DỮ LIỆU), banner level=${flowNoHb.banner.level}`,
  );

  console.log("\nAll Live Flow acceptance tests PASSED.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
