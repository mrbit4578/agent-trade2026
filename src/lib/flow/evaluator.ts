import type {
  FlowBannerState,
  FlowDetailRow,
  FlowNodeState,
  FlowNodeStatus,
  FlowPayload,
  FlowRawSnapshot,
} from "./types";

// Collector (15m cycle): green < 20m, yellow 20-45m, red > 45m
const COLLECTOR_GREEN_MAX_MIN = 20;
const COLLECTOR_YELLOW_MAX_MIN = 45;

// Quiet market informational threshold: latest signal > 6 hours (360m) while collector heartbeat is fresh
const QUIET_MARKET_SIGNAL_AGE_MIN = 360;

// Sender (5m cycle): green < 10m, yellow 10-30m, red > 30m
const SENDER_GREEN_MAX_MIN = 10;
const SENDER_YELLOW_MAX_MIN = 30;

// Agent scan (15m cycle): green < 20m, yellow 20-45m, red > 45m
const SCAN_GREEN_MAX_MIN = 20;
const SCAN_YELLOW_MAX_MIN = 45;

// flow-247 auxiliary station (15m cycle)
const FLOW_STATION_RED_MIN = 45;

function toVnDate(iso: string): Date {
  return new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000);
}

export function formatHmVn(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const vn = toVnDate(iso);
  const hh = String(vn.getUTCHours()).padStart(2, "0");
  const mm = String(vn.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function formatHmsVn(iso: string | null | undefined): string {
  if (!iso) return "--:--:--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  const vn = toVnDate(iso);
  const hh = String(vn.getUTCHours()).padStart(2, "0");
  const mm = String(vn.getUTCMinutes()).padStart(2, "0");
  const ss = String(vn.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function formatDateTimeVn(iso: string | null | undefined): string {
  if (!iso) return "chưa có dữ liệu";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "chưa có dữ liệu";
  const vn = toVnDate(iso);
  const dd = String(vn.getUTCDate()).padStart(2, "0");
  const mo = String(vn.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(vn.getUTCHours()).padStart(2, "0");
  const mm = String(vn.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mo} ${hh}:${mm} VN`;
}

function formatDurationCompact(minutes: number): string {
  if (minutes < 60) return `${minutes} phút`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}g${m > 0 ? `${String(m).padStart(2, "0")}p` : ""}`;
}

function calcAgeMinutes(
  nowIso: string,
  targetIso: string | null | undefined,
): number | null {
  if (!targetIso) return null;
  const nowMs = new Date(nowIso).getTime();
  const targetMs = new Date(targetIso).getTime();
  if (Number.isNaN(nowMs) || Number.isNaN(targetMs)) return null;
  return Math.max(0, Math.round((nowMs - targetMs) / 60000));
}

function classifyByThreshold(
  ageMin: number | null,
  greenMax: number,
  yellowMax: number,
): FlowNodeStatus {
  if (ageMin === null) return "grey_no_data";
  if (ageMin < greenMax) return "green";
  if (ageMin <= yellowMax) return "yellow";
  return "red";
}

function statusLabelOf(status: FlowNodeStatus): string {
  switch (status) {
    case "green":
      return "SỐNG";
    case "quiet":
      return "SỐNG · YÊN ẮNG";
    case "yellow":
      return "CHẬM";
    case "red":
      return "CHẾT / KẸT";
    case "grey_waiting":
      return "CHỜ DỮ LIỆU";
    case "grey_no_data":
    default:
      return "CHƯA CÓ DỮ LIỆU";
  }
}

function buildActivityText(
  hmVn: string | null,
  ageMin: number | null,
  neverLabel = "chưa từng chạy",
): string {
  if (!hmVn || ageMin === null) return neverLabel;
  if (ageMin === 0) return `${hmVn} VN (vừa xong)`;
  if (ageMin < 60) return `${hmVn} VN (cách đây ${ageMin} phút)`;
  return `${hmVn} VN (cách đây ${ageMin} phút · ${formatDurationCompact(ageMin)})`;
}

export function evaluateLiveFlow(snapshot: FlowRawSnapshot): FlowPayload {
  const { nowIso, report, collectorHeartbeat, senderHeartbeat, flowHeartbeat } =
    snapshot;
  const fetchedAtHmsVn = formatHmsVn(nowIso);

  const stageByCode = new Map(report.stages.map((s) => [s.agent, s]));
  const soatStage = stageByCode.get("SOAT");
  const doStage = stageByCode.get("DO");
  const chotStage = stageByCode.get("CHOT");
  const dpStage = stageByCode.get("DIEU_PHOI");

  // Distinguish manual vs scheduled runs
  const lastManualRun = snapshot.recentRuns.find(
    (r) => r.triggerKind === "manual" || r.triggerKind === "auto_init",
  );
  const lastScheduledRun = snapshot.recentRuns.find(
    (r) => r.triggerKind === "scheduled",
  );

  const scheduleSummary = {
    lastManualRunVn: lastManualRun
      ? formatDateTimeVn(lastManualRun.capturedAtIso)
      : null,
    lastScheduledRunVn: lastScheduledRun
      ? formatDateTimeVn(lastScheduledRun.capturedAtIso)
      : null,
    note: lastScheduledRun
      ? `Lần quét theo lịch gần nhất: ${formatDateTimeVn(lastScheduledRun.capturedAtIso)}`
      : "Lịch tự động (GitHub Actions 15m / Vercel Cron) chưa ghi nhận lượt chạy trong phiên hiện tại — dữ liệu hiện có từ lần quét tay/khởi tạo.",
  };

  // ---------------------------------------------------------------------------
  // NODE 1: Trạm VPS — Collector
  // Liveness = station_heartbeat (tram = 'collector-247', cap_nhat)
  // Latest signal age = informational only (NEVER causes RED / stuck!)
  // ---------------------------------------------------------------------------
  const sortedSignals = [...snapshot.recentSignals].sort((a, b) => {
    const tA = new Date(a.created_at || a.ts_vao || 0).getTime();
    const tB = new Date(b.created_at || b.ts_vao || 0).getTime();
    return tB - tA;
  });
  const latestSignal = sortedSignals[0] ?? null;
  const latestSignalIso = latestSignal
    ? latestSignal.created_at || latestSignal.ts_vao
    : null;
  const signalAgeMin = calcAgeMinutes(nowIso, latestSignalIso);
  const signalHmVn = formatHmVn(latestSignalIso);

  const collectorIso = collectorHeartbeat.available
    ? collectorHeartbeat.updatedAtUtc
    : null;
  const collectorAgeMin = calcAgeMinutes(nowIso, collectorIso);
  const collectorHmVn = formatHmVn(collectorIso);

  let node1Status: FlowNodeStatus;
  let isQuietMarket = false;

  if (!collectorHeartbeat.available || !collectorIso) {
    node1Status = "grey_no_data";
  } else {
    const hbStatus = classifyByThreshold(
      collectorAgeMin,
      COLLECTOR_GREEN_MAX_MIN,
      COLLECTOR_YELLOW_MAX_MIN,
    );
    if (
      hbStatus === "green" &&
      signalAgeMin !== null &&
      signalAgeMin > QUIET_MARKET_SIGNAL_AGE_MIN
    ) {
      node1Status = "quiet";
      isQuietMarket = true;
    } else {
      node1Status = hbStatus;
    }
  }

  const collectorStuck = node1Status === "red";
  const latestSignalSummary = latestSignal
    ? `Kèo mới nhất: ${latestSignal.coin}-${latestSignal.side} ${latestSignal.diem}đ lúc ${signalHmVn ?? "--:--"}${
        signalAgeMin !== null ? ` (cách đây ${formatDurationCompact(signalAgeMin)})` : ""
      }`
    : "Chưa có kèo mới trong signals";

  const node1: FlowNodeState = {
    id: "collector",
    order: 1,
    name: "Trạm VPS — Collector",
    shortRole: "Heartbeat collector-247 (nhịp 15p) · đẩy kèo vào signals",
    status: node1Status,
    statusLabel: statusLabelOf(node1Status),
    lastActivityAtUtc: collectorIso,
    lastActivityHmVn: collectorHmVn,
    ageMinutes: collectorAgeMin,
    activityText: collectorHeartbeat.available
      ? `Heartbeat: ${buildActivityText(collectorHmVn, collectorAgeMin)}`
      : "Heartbeat collector-247: chưa có dữ liệu",
    metrics: [
      {
        label: "Bản ghi signals",
        value:
          collectorHeartbeat.banGhi !== null
            ? `${collectorHeartbeat.banGhi} dòng`
            : `${report.counts.rawSignalsScanned} dòng`,
      },
      {
        label: "Kèo mới nhất",
        value: latestSignal
          ? `${latestSignal.coin}-${latestSignal.side} (${latestSignal.diem}đ)`
          : "CHƯA CÓ DỮ LIỆU",
      },
    ],
    infoNote: isQuietMarket
      ? `Thị trường yên ắng — không có kèo mới đạt ngưỡng · ${latestSignalSummary}`
      : latestSignalSummary,
    errorOrHint: !collectorHeartbeat.available ? collectorHeartbeat.note : null,
    stuckMessage:
      collectorStuck && collectorHmVn && collectorAgeMin !== null
        ? `KẸT TẠI ĐÂY từ ${collectorHmVn} (cách đây ${collectorAgeMin} phút)`
        : null,
    possibleCause: collectorStuck
      ? "heartbeat collector-247 quá hạn > 45 phút — trạm VPS có thể ngừng chạy hoặc mất kết nối Supabase"
      : null,
    detailsTitle: "5 tín hiệu mới nhất trong Supabase signals",
    details: sortedSignals.slice(0, 5).map((s) => ({
      id: s.id,
      title: `${s.coin} ${s.side.toUpperCase()} · ${s.diem} điểm`,
      subtitle: `${s.id} · phase=${s.phase} · loại=${s.loai ?? "—"}`,
      timestampVn: formatDateTimeVn(s.created_at || s.ts_vao),
      badge: s.phase === "alert_ready" && s.diem >= 70 ? "ĐẠT NGƯỠNG" : s.phase,
      badgeTone: s.phase === "alert_ready" && s.diem >= 70 ? "cyan" : "slate",
    })),
  };

  // Helper for agent nodes (Nodes 2..5)
  const buildScanStatus = (
    finishedIso: string | null | undefined,
  ): {
    status: FlowNodeStatus;
    hmVn: string | null;
    ageMin: number | null;
  } => {
    if (collectorStuck) {
      return {
        status: "grey_waiting",
        hmVn: formatHmVn(finishedIso),
        ageMin: calcAgeMinutes(nowIso, finishedIso),
      };
    }
    if (!finishedIso) {
      return { status: "grey_no_data", hmVn: null, ageMin: null };
    }
    const ageMin = calcAgeMinutes(nowIso, finishedIso);
    const status = classifyByThreshold(
      ageMin,
      SCAN_GREEN_MAX_MIN,
      SCAN_YELLOW_MAX_MIN,
    );
    return { status, hmVn: formatHmVn(finishedIso), ageMin };
  };

  const recentRunDetails: FlowDetailRow[] = snapshot.recentRuns
    .slice(0, 5)
    .map((r) => ({
      id: r.runId,
      title: `${r.runId} · ${r.triggerKind === "scheduled" ? "Theo lịch" : "Quét tay"}`,
      subtitle: `KV:${r.qualifiedExpected} · ĐỦ:${r.du} · MUỘN:${r.muon} · MẤT:${r.matConfirmed} · KT:${r.canKiemTra}`,
      timestampVn: r.capturedAtVn,
      badge: r.matConfirmed > 0 ? `MẤT ${r.matConfirmed}` : "0 MẤT",
      badgeTone: r.matConfirmed > 0 ? "rose" : "emerald",
    }));

  // ---------------------------------------------------------------------------
  // NODE 2: Agent 1 — Soát
  // ---------------------------------------------------------------------------
  const soatEval = buildScanStatus(soatStage?.finishedAtUtc);
  const runKindLabel = lastScheduledRun
    ? "Có quét theo lịch"
    : "Chỉ có quét tay (lịch 15m chưa chạy)";

  const node2: FlowNodeState = {
    id: "soat",
    order: 2,
    name: "Agent 1 — Soát",
    shortRole: "Lọc ≥70đ & alert_ready từ signals",
    status: soatEval.status,
    statusLabel: statusLabelOf(soatEval.status),
    lastActivityAtUtc: soatStage?.finishedAtUtc ?? null,
    lastActivityHmVn: soatEval.hmVn,
    ageMinutes: soatEval.ageMin,
    activityText: collectorStuck
      ? "Chờ heartbeat collector-247 phục hồi"
      : buildActivityText(soatEval.hmVn, soatEval.ageMin),
    metrics: [
      { label: "Dòng quét", value: report.counts.rawSignalsScanned },
      { label: "Kỳ vọng (≥70đ)", value: report.counts.qualifiedExpected },
    ],
    errorOrHint: collectorStuck ? "Chờ heartbeat từ Trạm VPS" : null,
    stuckMessage:
      soatEval.status === "red" && soatEval.hmVn && soatEval.ageMin !== null
        ? `KẸT TẠI ĐÂY từ ${soatEval.hmVn} (cách đây ${soatEval.ageMin} phút)`
        : null,
    possibleCause:
      soatEval.status === "red"
        ? "lịch GitHub Actions 15 phút chưa chạy hoặc endpoint quét chưa được kích hoạt"
        : null,
    runKindNote: runKindLabel,
    detailsTitle: "5 lần quét gần nhất (Agent Soát)",
    details: recentRunDetails,
  };

  // ---------------------------------------------------------------------------
  // NODE 3: Agent 2 — Dò
  // ---------------------------------------------------------------------------
  const doEval = buildScanStatus(doStage?.finishedAtUtc);
  const node3: FlowNodeState = {
    id: "do",
    order: 3,
    name: "Agent 2 — Dò",
    shortRole: "Join kỳ vọng với receipts & heartbeat",
    status: doEval.status,
    statusLabel: statusLabelOf(doEval.status),
    lastActivityAtUtc: doStage?.finishedAtUtc ?? null,
    lastActivityHmVn: doEval.hmVn,
    ageMinutes: doEval.ageMin,
    activityText: collectorStuck
      ? "Chờ heartbeat collector-247 phục hồi"
      : buildActivityText(doEval.hmVn, doEval.ageMin),
    metrics: [
      {
        label: "ĐỦ / MUỘN",
        value: `${report.counts.du} / ${report.counts.muon}`,
      },
      { label: "THIẾU", value: report.counts.thieuRaw },
    ],
    errorOrHint: !snapshot.receiptsAvailable
      ? "Bảng delivery_receipts chưa sẵn sàng"
      : collectorStuck
        ? "Chờ heartbeat từ Trạm VPS"
        : null,
    stuckMessage:
      doEval.status === "red" && doEval.hmVn && doEval.ageMin !== null
        ? `KẸT TẠI ĐÂY từ ${doEval.hmVn} (cách đây ${doEval.ageMin} phút)`
        : null,
    possibleCause:
      doEval.status === "red"
        ? "phiên đối chiếu bị trễ > 45 phút (lịch quét ngừng chạy)"
        : null,
    detailsTitle: "5 tín hiệu đối chiếu gần nhất (Agent Dò)",
    details: report.items.slice(0, 5).map((item) => ({
      id: item.signal.id,
      title: `${item.signal.coin} ${item.signal.side.toUpperCase()} (${item.signal.diem}đ)`,
      subtitle: `Receipt: ${item.receipt ? item.receipt.status.toUpperCase() : "KHÔNG CÓ"} · Heartbeat: ${item.inHeartbeat === null ? "N/A" : item.inHeartbeat ? "CÓ" : "VẮNG"}`,
      timestampVn: formatDateTimeVn(item.signal.ts_vao || item.signal.created_at),
      badge: item.reconcileStatus,
      badgeTone:
        item.reconcileStatus === "DU"
          ? "emerald"
          : item.reconcileStatus === "MUON"
            ? "amber"
            : "rose",
    })),
  };

  // ---------------------------------------------------------------------------
  // NODE 4: Agent 3 — Chốt
  // ---------------------------------------------------------------------------
  const chotEval = buildScanStatus(chotStage?.finishedAtUtc);
  const node4: FlowNodeState = {
    id: "chot",
    order: 4,
    name: "Agent 3 — Chốt",
    shortRole: "Thẩm định 2 nguồn độc lập ca THIẾU",
    status: chotEval.status,
    statusLabel: statusLabelOf(chotEval.status),
    lastActivityAtUtc: chotStage?.finishedAtUtc ?? null,
    lastActivityHmVn: chotEval.hmVn,
    ageMinutes: chotEval.ageMin,
    activityText: collectorStuck
      ? "Chờ heartbeat collector-247 phục hồi"
      : buildActivityText(chotEval.hmVn, chotEval.ageMin),
    metrics: [
      { label: "MẤT (2 nguồn)", value: report.counts.matConfirmed },
      {
        label: "KT / Giả",
        value: `${report.counts.canKiemTra} / ${report.counts.canhBaoGia}`,
      },
    ],
    errorOrHint:
      !senderHeartbeat.available && !collectorStuck
        ? "Thiếu nguồn heartbeat sender → ca thiếu chỉ dừng ở CẦN KIỂM TRA"
        : collectorStuck
          ? "Chờ heartbeat từ Trạm VPS"
          : null,
    stuckMessage:
      chotEval.status === "red" && chotEval.hmVn && chotEval.ageMin !== null
        ? `KẸT TẠI ĐÂY từ ${chotEval.hmVn} (cách đây ${chotEval.ageMin} phút)`
        : null,
    possibleCause:
      chotEval.status === "red"
        ? "phiên thẩm định bị gián đoạn > 45 phút"
        : null,
    detailsTitle: "5 ca thẩm định gần nhất (Agent Chốt)",
    details: report.items.slice(0, 5).map((item) => ({
      id: item.signal.id,
      title: `${item.signal.id}`,
      subtitle: item.explanation,
      timestampVn: formatDateTimeVn(item.signal.ts_vao || item.signal.created_at),
      badge: item.verdict,
      badgeTone:
        item.verdict === "MAT"
          ? "rose"
          : item.verdict === "CAN_KIEM_TRA"
            ? "amber"
            : item.verdict === "DU"
              ? "emerald"
              : "slate",
    })),
  };

  // ---------------------------------------------------------------------------
  // NODE 5: Agent 4 — Điều phối
  // ---------------------------------------------------------------------------
  const dpEval = buildScanStatus(dpStage?.finishedAtUtc);
  const node5: FlowNodeState = {
    id: "dieu_phoi",
    order: 5,
    name: "Agent 4 — Điều phối",
    shortRole: "Gom báo cáo UTC+VN & dedupe cảnh báo",
    status: dpEval.status,
    statusLabel: statusLabelOf(dpEval.status),
    lastActivityAtUtc: dpStage?.finishedAtUtc ?? null,
    lastActivityHmVn: dpEval.hmVn,
    ageMinutes: dpEval.ageMin,
    activityText: collectorStuck
      ? "Chờ heartbeat collector-247 phục hồi"
      : buildActivityText(dpEval.hmVn, dpEval.ageMin),
    metrics: [
      { label: "Cảnh báo đã gửi", value: snapshot.recentAlerts.length },
      { label: "Chế độ gửi", value: report.telegram.mode },
    ],
    errorOrHint: report.telegram.error
      ? report.telegram.error
      : collectorStuck
        ? "Chờ heartbeat từ Trạm VPS"
        : null,
    stuckMessage:
      dpEval.status === "red" && dpEval.hmVn && dpEval.ageMin !== null
        ? `KẸT TẠI ĐÂY từ ${dpEval.hmVn} (cách đây ${dpEval.ageMin} phút)`
        : null,
    possibleCause:
      dpEval.status === "red"
        ? "Agent Điều phối không chạy báo cáo > 45 phút"
        : null,
    detailsTitle: "5 báo cáo / cảnh báo gần nhất (Agent Điều phối)",
    details:
      snapshot.recentAlerts.length > 0
        ? snapshot.recentAlerts.slice(0, 5).map((a) => ({
            id: a.signal_id,
            title: `Cảnh báo ${a.verdict} · ${a.signal_id}`,
            subtitle: a.telegram_message_id
              ? `Telegram msg_id=${a.telegram_message_id}`
              : "Đã ghi nhận trong monitor_alerts",
            timestampVn: formatDateTimeVn(a.alerted_at),
            badge: "ĐÃ BÁO",
            badgeTone: "rose",
          }))
        : recentRunDetails,
  };

  // ---------------------------------------------------------------------------
  // NODE 6: Đầu ra — Telegram (@trademrbit_bot + station_heartbeat telegram-sender)
  // ---------------------------------------------------------------------------
  const sortedReceipts = [...snapshot.recentReceipts].sort((a, b) => {
    const tA = new Date(a.sent_at || a.checked_at || 0).getTime();
    const tB = new Date(b.sent_at || b.checked_at || 0).getTime();
    return tB - tA;
  });
  const latestReceipt = sortedReceipts[0] ?? null;
  const latestReceiptIso = latestReceipt
    ? latestReceipt.sent_at || latestReceipt.checked_at
    : null;

  const senderIso = senderHeartbeat.available
    ? senderHeartbeat.updatedAtUtc || senderHeartbeat.lastRunAtUtc
    : null;
  const senderAgeMin = calcAgeMinutes(nowIso, senderIso);
  const senderHmVn = formatHmVn(senderIso);

  let node6Status: FlowNodeStatus;
  if (collectorStuck) {
    node6Status = "grey_waiting";
  } else if (!senderHeartbeat.available || !senderIso) {
    node6Status = "grey_no_data";
  } else {
    node6Status = classifyByThreshold(
      senderAgeMin,
      SENDER_GREEN_MAX_MIN,
      SENDER_YELLOW_MAX_MIN,
    );
  }

  const matchedReceiptsCount = report.items.filter(
    (i) =>
      i.receipt &&
      (i.receipt.status === "sent" || i.receipt.status === "duplicate"),
  ).length;

  const isSenderIdleHealthy =
    senderHeartbeat.available &&
    node6Status !== "red" &&
    (senderHeartbeat.guiDuoc ?? 0) === 0 &&
    (senderHeartbeat.sentIdsCount ?? 0) === 0;

  const senderMetricValue = senderHeartbeat.available
    ? `${senderHeartbeat.guiDuoc ?? senderHeartbeat.sentIdsCount ?? 0} tin${
        senderHeartbeat.failedCount ? ` · ${senderHeartbeat.failedCount} lỗi` : ""
      }`
    : "CHƯA CÓ DỮ LIỆU";

  const node6: FlowNodeState = {
    id: "telegram",
    order: 6,
    name: "Đầu ra — Telegram",
    shortRole: "@trademrbit_bot · station_heartbeat (5p) · delivery_receipts",
    status: node6Status,
    statusLabel: statusLabelOf(node6Status),
    lastActivityAtUtc: senderIso || latestReceiptIso,
    lastActivityHmVn: senderHmVn || formatHmVn(latestReceiptIso),
    ageMinutes: senderIso ? senderAgeMin : calcAgeMinutes(nowIso, latestReceiptIso),
    activityText:
      node6Status === "grey_waiting"
        ? "Chờ heartbeat collector-247 phục hồi"
        : !senderHeartbeat.available
          ? latestReceiptIso
            ? `Receipt cuối: ${formatDateTimeVn(latestReceiptIso)} · Heartbeat: chưa có dữ liệu`
            : "chưa có dữ liệu heartbeat / receipt"
          : `Sender: ${buildActivityText(senderHmVn, senderAgeMin, "chưa từng chạy")}`,
    metrics: [
      {
        label: "Sender đã gửi",
        value: senderMetricValue,
      },
      {
        label: "Receipts khớp",
        value: snapshot.receiptsAvailable
          ? `${matchedReceiptsCount} / ${report.counts.qualifiedExpected}`
          : "CHƯA CÓ DỮ LIỆU",
      },
    ],
    infoNote: isSenderIdleHealthy
      ? "đang chạy, không có gì để gửi"
      : senderHeartbeat.available
        ? `Nguồn heartbeat: ${senderHeartbeat.source}`
        : null,
    errorOrHint: !senderHeartbeat.available
      ? senderHeartbeat.note
      : node6Status === "grey_waiting"
        ? "Chờ heartbeat từ Trạm VPS"
        : null,
    stuckMessage:
      node6Status === "red" && senderHmVn && senderAgeMin !== null
        ? `KẸT TẠI ĐÂY từ ${senderHmVn} (cách đây ${senderAgeMin} phút)`
        : null,
    possibleCause:
      node6Status === "red"
        ? "heartbeat telegram-sender quá hạn > 30 phút — sender trên VPS có thể ngừng chạy hoặc mất kết nối"
        : null,
    detailsTitle: "5 biên nhận mới nhất (delivery_receipts) & trạng thái sender",
    details:
      sortedReceipts.length > 0
        ? sortedReceipts.slice(0, 5).map((r) => ({
            id: r.signal_id,
            title: `${r.signal_id}`,
            subtitle: r.telegram_message_id
              ? `status=${r.status.toUpperCase()} · msg_id=${r.telegram_message_id}`
              : `status=${r.status.toUpperCase()}`,
            timestampVn: formatDateTimeVn(r.sent_at || r.checked_at),
            badge: r.status.toUpperCase(),
            badgeTone:
              r.status === "sent" || r.status === "duplicate"
                ? "emerald"
                : "rose",
          }))
        : [
            {
              id: "sender-hb-status",
              title: senderHeartbeat.available
                ? isSenderIdleHealthy
                  ? "telegram-sender đang chạy, không có gì để gửi"
                  : `telegram-sender đã gửi ${senderHeartbeat.guiDuoc ?? 0} tin`
                : "Chưa có dữ liệu heartbeat telegram-sender",
              subtitle: senderHeartbeat.note,
              timestampVn: formatDateTimeVn(senderIso || nowIso),
              badge: senderHeartbeat.available ? "HEARTBEAT OK" : "CHƯA CÓ DỮ LIỆU",
              badgeTone: senderHeartbeat.available ? "emerald" : "slate",
            },
          ],
  };

  const nodes: FlowNodeState[] = [node1, node2, node3, node4, node5, node6];

  // ---------------------------------------------------------------------------
  // OVERALL BANNER (§3 & §4)
  // Chỉ ĐỎ khi: heartbeat quá hạn (collector/sender/flow) HOẶC có ca MẤT đã chốt
  // KHÔNG đỏ chỉ vì thị trường yên ắng (không có kèo mới)!
  // ---------------------------------------------------------------------------
  const firstRed = nodes.find((n) => n.status === "red");
  const flowStationAgeMin = flowHeartbeat?.available
    ? calcAgeMinutes(nowIso, flowHeartbeat.updatedAtUtc)
    : null;
  const flowStationOverdue =
    flowStationAgeMin !== null && flowStationAgeMin > FLOW_STATION_RED_MIN;
  const hasConfirmedMissing = report.counts.matConfirmed > 0;

  const allHealthyOrQuiet = nodes.every(
    (n) => n.status === "green" || n.status === "quiet",
  );
  const firstYellow = nodes.find((n) => n.status === "yellow");
  const greyNodes = nodes.filter(
    (n) => n.status === "grey_no_data" || n.status === "grey_waiting",
  );

  let banner: FlowBannerState;
  if (firstRed) {
    const since = firstRed.lastActivityHmVn ?? "--:--";
    banner = {
      level: "red",
      headline: `ĐANG KẸT TẠI ${firstRed.name} từ ${since} — nguyên nhân có thể: ${firstRed.possibleCause ?? "heartbeat quá ngưỡng đỏ"}`,
      subline: `Cập nhật lần cuối ${fetchedAtHmsVn} VN · ${scheduleSummary.note}`,
      stuckNodeId: firstRed.id,
    };
  } else if (flowStationOverdue && flowHeartbeat?.updatedAtUtc) {
    const since = formatHmVn(flowHeartbeat.updatedAtUtc) ?? "--:--";
    banner = {
      level: "red",
      headline: `ĐANG KẸT TẠI Trạm flow-247 từ ${since} — nguyên nhân có thể: heartbeat flow-247 quá hạn ${flowStationAgeMin} phút (> 45 phút)`,
      subline: `Cập nhật lần cuối ${fetchedAtHmsVn} VN · ${scheduleSummary.note}`,
      stuckNodeId: "collector",
    };
  } else if (hasConfirmedMissing) {
    banner = {
      level: "red",
      headline: `PHÁT HIỆN ${report.counts.matConfirmed} CA MẤT ĐÃ CHỐT (2 nguồn) — cập nhật lần cuối ${fetchedAtHmsVn}`,
      subline: `Trạm đang sống nhưng có tín hiệu đạt ngưỡng không tới Telegram · ${scheduleSummary.note}`,
      stuckNodeId: "chot",
    };
  } else if (allHealthyOrQuiet) {
    banner = {
      level: "green",
      headline: `DÒNG CHẢY ĐANG SỐNG — cập nhật lần cuối ${fetchedAtHmsVn}`,
      subline: isQuietMarket
        ? `Heartbeat trạm tươi · Thị trường yên ắng (chưa có kèo mới > 6 giờ) · ${scheduleSummary.note}`
        : `Toàn bộ 6/6 khâu trong ngưỡng xanh · ${scheduleSummary.note}`,
      stuckNodeId: null,
    };
  } else if (firstYellow) {
    banner = {
      level: "yellow",
      headline: `DÒNG CHẢY ĐANG CHẬM TẠI ${firstYellow.name} — cập nhật lần cuối ${fetchedAtHmsVn}`,
      subline:
        greyNodes.length > 0
          ? `Có ${greyNodes.length} khâu chưa có dữ liệu (${greyNodes.map((n) => n.name).join(", ")}) · ${scheduleSummary.note}`
          : scheduleSummary.note,
      stuckNodeId: null,
    };
  } else {
    banner = {
      level: "grey",
      headline: `CHƯA ĐỦ DỮ LIỆU ĐỂ XÁC NHẬN TOÀN TUYẾN (${greyNodes.map((n) => n.name).join(", ")}) — cập nhật ${fetchedAtHmsVn}`,
      subline: scheduleSummary.note,
      stuckNodeId: null,
    };
  }

  return {
    ok: true,
    mode: snapshot.mode,
    fetchedAtUtc: nowIso,
    fetchedAtHmsVn,
    banner,
    scheduleSummary,
    nodes,
  };
}
