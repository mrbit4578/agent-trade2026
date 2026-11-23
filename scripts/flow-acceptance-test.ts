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
    scenario: "clean-day",
    sendTelegram: false,
  });

  const nowMs = new Date(nowIso).getTime();
  const minAgo = (m: number) => new Date(nowMs - m * 60000).toISOString();

  const freshReport = {
    ...report,
    counts: {
      ...report.counts,
      rawSignalsScanned: 31,
      matConfirmed: 0,
    },
    stages: report.stages.map((s) => ({
      ...s,
      startedAtUtc: minAgo(5),
      finishedAtUtc: minAgo(5),
    })),
  };

  return {
    nowIso,
    mode: "live",
    report: freshReport,
    recentSignals: [
      {
        id: "DOGE-short-test-01",
        coin: "DOGE",
        side: "short",
        loai: "that",
        diem: 83,
        gia_vao: 0.38,
        sl: 0.4,
        tp1: 0.34,
        tp2: 0.31,
        rr: 2.0,
        phase: "alert_ready",
        trang_thai: "open",
        ket_qua: null,
        ts_vao: minAgo(15),
        ts_dong: null,
        phien: "ASIA",
        bias_4h: "bearish",
        cau_truc: "BOS",
        nguon: "collector-247",
        created_at: minAgo(15),
      },
    ],
    recentReceipts: [],
    recentAlerts: [],
    receiptsAvailable: true,
    alertsAvailable: true,
    collectorHeartbeat: {
      available: true,
      updatedAtUtc: minAgo(6),
      banGhi: 31,
      source: "Supabase station_heartbeat (collector-247)",
      note: "Heartbeat collector-247 tươi",
    },
    senderHeartbeat: {
      available: true,
      updatedAtUtc: minAgo(4),
      lastRunAtUtc: minAgo(4),
      guiDuoc: 0,
      sentIdsCount: 0,
      failedCount: 0,
      source: "Supabase station_heartbeat (telegram-sender)",
      note: "Heartbeat telegram-sender từ Supabase station_heartbeat",
    },
    flowHeartbeat: {
      available: true,
      updatedAtUtc: minAgo(6),
      note: "Heartbeat flow-247 tươi",
    },
    recentRuns: [
      {
        runId: freshReport.runId,
        mode: "live",
        capturedAtIso: minAgo(5),
        capturedAtVn: freshReport.capturedAtVn,
        triggerKind: "manual",
        qualifiedExpected: 0,
        du: 0,
        muon: 0,
        matConfirmed: 0,
        canKiemTra: 0,
        canhBaoGia: 0,
        telegramSent: false,
      },
    ],
  };
}

async function main() {
  const nowIso = "2026-11-23T09:36:00.000Z"; // 16:36 VN
  const nowMs = new Date(nowIso).getTime();
  const minAgo = (m: number) => new Date(nowMs - m * 60000).toISOString();

  console.log("=== Trade.2026 Live Flow (station_heartbeat fix) — 4 Acceptance Tests ===");

  // TEST 1 (§6.1): Trạm sống khỏe (collector ~6p, sender ~4p, gui_duoc=0, sent_ids=[])
  const base = await buildBaseSnapshot(nowIso);
  const flowLiveOk = evaluateLiveFlow(base);
  assert(flowLiveOk.nodes[0].status === "green", `Expected Node 1 green, got ${flowLiveOk.nodes[0].status}`);
  assert(flowLiveOk.banner.level === "green", `Expected green banner, got ${flowLiveOk.banner.level}: ${flowLiveOk.banner.headline}`);
  assert(flowLiveOk.nodes[5].status === "green", `Expected Node 6 green, got ${flowLiveOk.nodes[5].status}`);
  assert(
    flowLiveOk.nodes[5].infoNote === "đang chạy, không có gì để gửi",
    `Expected idle sender note, got: ${flowLiveOk.nodes[5].infoNote}`,
  );
  console.log(
    `[PASS] T1_LIVE_HEALTHY_AND_IDLE_SENDER — Node 1 GREEN (~6p), Banner GREEN, Node 6 GREEN ("${flowLiveOk.nodes[5].infoNote}")`,
  );

  // TEST 2 (§6.2): Giả lập heartbeat collector cũ > 45 phút (55p) -> Node 1 ĐỎ + Banner "ĐANG KẸT TẠI Trạm VPS — Collector từ HH:MM"
  const staleCollector: FlowRawSnapshot = {
    ...base,
    collectorHeartbeat: {
      ...base.collectorHeartbeat,
      updatedAtUtc: minAgo(55), // 15:41 VN
    },
  };
  const flowStaleCol = evaluateLiveFlow(staleCollector);
  assert(flowStaleCol.nodes[0].status === "red", `Expected Node 1 red, got ${flowStaleCol.nodes[0].status}`);
  assert(
    Boolean(flowStaleCol.nodes[0].stuckMessage?.includes("KẸT TẠI ĐÂY từ 15:41 (cách đây 55 phút)")),
    `Expected stuckMessage for 15:41 (55p), got: ${flowStaleCol.nodes[0].stuckMessage}`,
  );
  assert(
    flowStaleCol.banner.level === "red" &&
      flowStaleCol.banner.headline.includes("ĐANG KẸT TẠI Trạm VPS — Collector từ 15:41"),
    `Expected red banner for Trạm VPS — Collector từ 15:41, got: ${flowStaleCol.banner.headline}`,
  );
  console.log(
    `[PASS] T2_COLLECTOR_HEARTBEAT_OVERDUE — Node 1 RED (15:41, 55p), Banner="${flowStaleCol.banner.headline}"`,
  );

  // TEST 3 (§6.3): Heartbeat collector tươi (~6p) nhưng không có kèo mới 10g36p -> Node 1 vàng nhạt "quiet" (thị trường yên ắng), KHÔNG đỏ, banner KHÔNG đỏ
  const quietMarket: FlowRawSnapshot = {
    ...base,
    recentSignals: [
      {
        ...base.recentSignals[0],
        created_at: minAgo(636), // 10h36m ago -> 06:00 VN
        ts_vao: minAgo(636),
      },
    ],
  };
  const flowQuiet = evaluateLiveFlow(quietMarket);
  assert(
    flowQuiet.nodes[0].status === "quiet",
    `Expected Node 1 quiet (not red!), got ${flowQuiet.nodes[0].status}`,
  );
  assert(
    flowQuiet.nodes[0].stuckMessage === null,
    `Quiet market must NOT show KẸT TẠI ĐÂY, got: ${flowQuiet.nodes[0].stuckMessage}`,
  );
  assert(
    Boolean(flowQuiet.nodes[0].infoNote?.includes("Thị trường yên ắng")),
    `Expected quiet market note, got: ${flowQuiet.nodes[0].infoNote}`,
  );
  assert(
    flowQuiet.banner.level === "green",
    `Banner must NOT be red when market is quiet and heartbeats are fresh, got ${flowQuiet.banner.level}: ${flowQuiet.banner.headline}`,
  );
  console.log(
    `[PASS] T3_QUIET_MARKET_10H_NOT_RED — Node 1="${flowQuiet.nodes[0].statusLabel}", infoNote="${flowQuiet.nodes[0].infoNote}", Banner=${flowQuiet.banner.level}`,
  );

  // TEST 4 (§6.4): Heartbeat sender cũ > 30p -> Node 6 ĐỎ; khi có Supabase station_heartbeat (không cần VPS_HEARTBEAT_URL) -> Node 6 XANH
  const staleSender: FlowRawSnapshot = {
    ...base,
    senderHeartbeat: {
      ...base.senderHeartbeat,
      updatedAtUtc: minAgo(42), // 15:54 VN
      lastRunAtUtc: minAgo(42),
    },
  };
  const flowStaleSender = evaluateLiveFlow(staleSender);
  assert(
    flowStaleSender.nodes[5].status === "red",
    `Expected Node 6 red when sender > 30m, got ${flowStaleSender.nodes[5].status}`,
  );
  assert(
    flowStaleSender.banner.level === "red" &&
      flowStaleSender.banner.headline.includes("ĐANG KẸT TẠI Đầu ra — Telegram từ 15:54"),
    `Expected red banner for Đầu ra — Telegram từ 15:54, got: ${flowStaleSender.banner.headline}`,
  );
  assert(
    flowLiveOk.nodes[5].status === "green" &&
      flowLiveOk.nodes[5].statusLabel === "SỐNG",
    "When Supabase station_heartbeat has fresh telegram-sender (without VPS_HEARTBEAT_URL), Node 6 must be GREEN",
  );
  console.log(
    `[PASS] T4_SENDER_HEARTBEAT_RED_AND_SUPABASE_SOURCE — Stale sender (42p) -> Node 6 RED & Banner RED; fresh Supabase station_heartbeat -> Node 6 GREEN`,
  );

  console.log("\nAll 4 station_heartbeat Live Flow acceptance tests PASSED.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
