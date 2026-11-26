import { getDemoDataset } from "./demo-data";
import {
  fetchAlertedSignalIds,
  fetchSenderHeartbeat,
  fetchSupabaseReceipts,
  fetchSupabaseSignals,
  getSupabaseConfig,
  recordAlertedSignalId,
} from "./supabase";
import {
  formatMissingAlertMessage,
  getTelegramConfig,
  sendTelegramAlert,
} from "./telegram";
import { diffMinutes, formatUtc, formatVn } from "./time";
import type {
  AgentStageTrace,
  AuditItem,
  DeliveryReceipt,
  DemoScenarioId,
  EvidenceRecord,
  FinalVerdict,
  MonitorMode,
  MonitorReport,
  MonitorRunOptions,
  ReconcileStatus,
  SenderHeartbeat,
  SignalRow,
  TelegramDispatchSummary,
} from "./types";

const SCORE_THRESHOLD = 70;
const LATE_THRESHOLD_MINUTES = 15;

// In-memory dedupe fallback (paired with Supabase monitor_alerts for durable dedupe)
const inMemoryAlertedIds = new Set<string>();
let lastReportCache: MonitorReport | null = null;
const reportHistory: MonitorReport[] = [];

export function getLastReport(): MonitorReport | null {
  return lastReportCache;
}

export function getReportHistory(): MonitorReport[] {
  return reportHistory;
}

export function resetInMemoryDedupeForTest(): void {
  inMemoryAlertedIds.clear();
}

/**
 * Agent 1 — SOÁT
 * Chỉ lấy tín hiệu diem >= 70 AND phase === 'alert_ready'.
 * Bỏ qua retest_in_progress và deduplicate theo id.
 */
function runSoat(rawSignals: SignalRow[]): {
  qualified: SignalRow[];
  ignoredNonAlertReady: number;
  ignoredLowScore: number;
  duplicateIdsRemoved: number;
  trace: AgentStageTrace;
} {
  const started = Date.now();
  const startedAtUtc = new Date(started).toISOString();

  let ignoredNonAlertReady = 0;
  let ignoredLowScore = 0;
  let duplicateIdsRemoved = 0;
  const seen = new Set<string>();
  const qualified: SignalRow[] = [];

  for (const s of rawSignals) {
    if (seen.has(s.id)) {
      duplicateIdsRemoved++;
      continue;
    }
    seen.add(s.id);

    if (s.phase !== "alert_ready") {
      ignoredNonAlertReady++;
      continue;
    }
    if (typeof s.diem !== "number" || s.diem < SCORE_THRESHOLD) {
      ignoredLowScore++;
      continue;
    }
    qualified.push(s);
  }

  const finished = Date.now();
  return {
    qualified,
    ignoredNonAlertReady,
    ignoredLowScore,
    duplicateIdsRemoved,
    trace: {
      agent: "SOAT",
      roleTitle: "Agent 1 · Soát",
      responsibility:
        "Truy vấn Supabase signals: lọc diem >= 70 AND phase = 'alert_ready', loại retest_in_progress & trùng id",
      startedAtUtc,
      finishedAtUtc: new Date(finished).toISOString(),
      durationMs: Math.max(1, finished - started),
      summary: `Quét ${rawSignals.length} dòng → ${qualified.length} tín hiệu kỳ vọng (bỏ qua ${ignoredNonAlertReady} non-alert_ready, ${ignoredLowScore} điểm < 70).`,
      metrics: {
        scanned: rawSignals.length,
        qualified: qualified.length,
        ignoredNonAlertReady,
        ignoredLowScore,
        duplicateIdsRemoved,
      },
    },
  };
}

/**
 * Agent 2 — DÒ
 * Đối chiếu danh sách kỳ vọng từ Soát với delivery_receipts + heartbeat sent_ids.
 */
function runDo(
  qualified: SignalRow[],
  receipts: DeliveryReceipt[],
  receiptsAvailable: boolean,
  heartbeat: SenderHeartbeat,
): {
  preliminary: Array<{
    signal: SignalRow;
    receipt: DeliveryReceipt | null;
    inHeartbeat: boolean | null;
    reconcileStatus: ReconcileStatus;
    latencyMinutes: number | null;
  }>;
  duCount: number;
  muonCount: number;
  thieuCount: number;
  trace: AgentStageTrace;
} {
  const started = Date.now();
  const startedAtUtc = new Date(started).toISOString();

  const receiptMap = new Map<string, DeliveryReceipt>();
  for (const r of receipts) {
    receiptMap.set(r.signal_id, r);
  }
  const heartbeatSet = new Set(heartbeat.sentIds);

  let duCount = 0;
  let muonCount = 0;
  let thieuCount = 0;

  const preliminary = qualified.map((signal) => {
    const receipt = receiptsAvailable ? (receiptMap.get(signal.id) ?? null) : null;
    const inHeartbeat = heartbeat.available ? heartbeatSet.has(signal.id) : null;

    const receiptDelivered =
      receipt !== null &&
      (receipt.status === "sent" || receipt.status === "duplicate");

    let reconcileStatus: ReconcileStatus;
    let latencyMinutes: number | null = null;

    if (receiptDelivered) {
      latencyMinutes = diffMinutes(
        signal.ts_vao || signal.created_at,
        receipt.sent_at || receipt.checked_at,
      );
      if (latencyMinutes !== null && latencyMinutes > LATE_THRESHOLD_MINUTES) {
        reconcileStatus = "MUON";
        muonCount++;
      } else {
        reconcileStatus = "DU";
        duCount++;
      }
    } else {
      reconcileStatus = "THIEU";
      thieuCount++;
    }

    return {
      signal,
      receipt,
      inHeartbeat,
      reconcileStatus,
      latencyMinutes,
    };
  });

  const finished = Date.now();
  return {
    preliminary,
    duCount,
    muonCount,
    thieuCount,
    trace: {
      agent: "DO",
      roleTitle: "Agent 2 · Dò",
      responsibility:
        "Join danh sách kỳ vọng với bảng delivery_receipts bền và heartbeat telegram-sender (sent_ids)",
      startedAtUtc,
      finishedAtUtc: new Date(finished).toISOString(),
      durationMs: Math.max(1, finished - started),
      summary: `Đối chiếu ${qualified.length} tín hiệu → ${duCount} ĐỦ, ${muonCount} MUỘN (>${LATE_THRESHOLD_MINUTES}p), ${thieuCount} ca THIẾU chuyển sang Chốt.`,
      metrics: {
        total: qualified.length,
        du: duCount,
        muon: muonCount,
        thieu: thieuCount,
      },
    },
  };
}

/**
 * Agent 3 — CHỐT
 * Kiểm 2 nguồn độc lập cho mỗi ca THIẾU:
 * - Có bằng chứng đã gửi từ nguồn độc lập -> CẢNH BÁO GIẢ (loại)
 * - Đủ 2 nguồn độc lập cùng xác nhận chưa gửi -> MẤT
 * - Chỉ có 0 hoặc 1 nguồn khả dụng -> CẦN KIỂM TRA (không bao giờ kết luận MẤT từ 1 nguồn)
 */
function runChot(
  preliminary: ReturnType<typeof runDo>["preliminary"],
  receiptsAvailable: boolean,
  receiptsCapturedAtUtc: string,
  heartbeat: SenderHeartbeat,
): {
  items: AuditItem[];
  matConfirmed: number;
  canKiemTra: number;
  canhBaoGia: number;
  trace: AgentStageTrace;
} {
  const started = Date.now();
  const startedAtUtc = new Date(started).toISOString();

  let matConfirmed = 0;
  let canKiemTra = 0;
  let canhBaoGia = 0;

  const items: AuditItem[] = preliminary.map((entry) => {
    const receiptDelivered =
      entry.receipt !== null &&
      (entry.receipt.status === "sent" || entry.receipt.status === "duplicate");

    const receiptEvidence: EvidenceRecord = {
      source: "delivery_receipts",
      available: receiptsAvailable,
      delivered: receiptsAvailable ? receiptDelivered : null,
      detail: !receiptsAvailable
        ? "Bảng delivery_receipts chưa sẵn sàng (chưa có dữ liệu)"
        : entry.receipt === null
          ? "Không có biên nhận trong delivery_receipts"
          : entry.receipt.status === "failed"
            ? `Có biên nhận trạng thái FAILED lúc ${formatVn(entry.receipt.checked_at)}`
            : `Biên nhận ${entry.receipt.status.toUpperCase()} lúc ${formatVn(entry.receipt.sent_at || entry.receipt.checked_at)}${entry.receipt.telegram_message_id ? ` (msg ${entry.receipt.telegram_message_id})` : ""}`,
      capturedAtUtc: receiptsCapturedAtUtc,
    };

    const heartbeatEvidence: EvidenceRecord = {
      source: "telegram_sender_heartbeat",
      available: heartbeat.available,
      delivered: heartbeat.available ? Boolean(entry.inHeartbeat) : null,
      detail: !heartbeat.available
        ? heartbeat.note
        : entry.inHeartbeat
          ? `Có signal_id trong sent_ids của heartbeat (chạy gần nhất ${formatVn(heartbeat.lastRunAtUtc)})`
          : `Vắng mặt trong sent_ids của heartbeat (chạy gần nhất ${formatVn(heartbeat.lastRunAtUtc)})`,
      capturedAtUtc: heartbeat.checkedAtUtc,
    };

    const evidence = [receiptEvidence, heartbeatEvidence];

    let verdict: FinalVerdict;
    let explanation: string;

    if (entry.reconcileStatus === "DU") {
      verdict = "DU";
      explanation = `Đã xác nhận gửi đúng hạn qua delivery_receipts${entry.latencyMinutes !== null ? ` (độ trễ ${entry.latencyMinutes} phút)` : ""}.`;
    } else if (entry.reconcileStatus === "MUON") {
      verdict = "MUON";
      explanation = `Đã gửi tới Telegram nhưng vượt ngưỡng ${LATE_THRESHOLD_MINUTES} phút (độ trễ ${entry.latencyMinutes} phút).`;
    } else {
      // Ca THIẾU: kiểm 2 nguồn độc lập
      const anySourceConfirmsDelivered =
        receiptEvidence.delivered === true ||
        heartbeatEvidence.delivered === true;

      const availableSourcesCount =
        (receiptEvidence.available ? 1 : 0) +
        (heartbeatEvidence.available ? 1 : 0);

      if (anySourceConfirmsDelivered) {
        verdict = "CANH_BAO_GIA";
        canhBaoGia++;
        explanation =
          "Loại cảnh báo giả: nguồn độc lập (heartbeat telegram-sender) xác nhận đã gửi dù delivery_receipts thiếu/lỗi.";
      } else if (availableSourcesCount >= 2) {
        verdict = "MAT";
        matConfirmed++;
        explanation =
          "Xác nhận MẤT (2/2 nguồn độc lập): không có biên nhận gửi thành công trong delivery_receipts VÀ vắng mặt trong sent_ids của telegram-sender.";
      } else {
        verdict = "CAN_KIEM_TRA";
        canKiemTra++;
        explanation = `Chỉ có ${availableSourcesCount}/2 nguồn độc lập khả dụng — chưa đủ điều kiện kết luận MẤT theo quy tắc an toàn.`;
      }
    }

    return {
      signal: entry.signal,
      receipt: entry.receipt,
      inHeartbeat: entry.inHeartbeat,
      reconcileStatus: entry.reconcileStatus,
      verdict,
      latencyMinutes: entry.latencyMinutes,
      evidence,
      explanation,
      alerted: false,
      alertDedupeSkipped: false,
    };
  });

  const finished = Date.now();
  return {
    items,
    matConfirmed,
    canKiemTra,
    canhBaoGia,
    trace: {
      agent: "CHOT",
      roleTitle: "Agent 3 · Chốt",
      responsibility:
        "Xác minh 2 nguồn độc lập cho mỗi ca THIẾU: 2 nguồn trống → MẤT; 1 nguồn → CẦN KIỂM TRA; có bằng chứng gửi → CẢNH BÁO GIẢ",
      startedAtUtc,
      finishedAtUtc: new Date(finished).toISOString(),
      durationMs: Math.max(1, finished - started),
      summary: `Thẩm định xong: ${matConfirmed} MẤT (2 nguồn), ${canKiemTra} CẦN KIỂM TRA, ${canhBaoGia} CẢNH BÁO GIẢ đã loại.`,
      metrics: {
        matConfirmed,
        canKiemTra,
        canhBaoGia,
      },
    },
  };
}

/**
 * Orchestrator: runs Soát -> Dò -> Chốt -> Điều phối
 */
export async function runMonitorPipeline(
  options: MonitorRunOptions = {},
): Promise<MonitorReport> {
  const now = new Date();
  const capturedAtUtcIso = now.toISOString();
  const supabaseCfg = getSupabaseConfig();

  const envMode = (process.env.MONITOR_MODE || "auto").toLowerCase();
  let mode: MonitorMode;
  if (options.mode === "demo" || envMode === "demo") {
    mode = "demo";
  } else if (options.mode === "live" || envMode === "live") {
    mode = supabaseCfg ? "live" : "demo";
  } else {
    mode = supabaseCfg ? "live" : "demo";
  }

  const scenario: DemoScenarioId | undefined =
    mode === "demo" ? (options.scenario ?? "live-24h-sim") : undefined;

  let windowLabel: string;
  let windowFromUtc: string;
  let windowToUtc: string;
  let rawSignals: SignalRow[] = [];
  let signalsAvailable = false;
  let signalsNote = "";
  let signalsCapturedAtUtc = capturedAtUtcIso;

  let receipts: DeliveryReceipt[] = [];
  let receiptsAvailable = false;
  let receiptsNote = "";
  let receiptsCapturedAtUtc = capturedAtUtcIso;

  let heartbeat: SenderHeartbeat;

  if (mode === "demo") {
    const demo = getDemoDataset(scenario!);
    windowLabel = demo.windowLabel;
    windowFromUtc = demo.windowFromUtc;
    windowToUtc = demo.windowToUtc;
    rawSignals = demo.signals;
    signalsAvailable = true;
    signalsNote = `Demo fixture (${scenario}) — ${rawSignals.length} dòng tín hiệu mẫu`;
    receipts = demo.receipts;
    receiptsAvailable = demo.receiptsAvailable;
    receiptsNote = `Demo delivery_receipts — ${receipts.length} biên nhận mẫu`;
    heartbeat = demo.heartbeat;
  } else {
    const windowHours = options.windowHours ?? 24;
    windowToUtc = options.toUtc || capturedAtUtcIso;
    windowFromUtc =
      options.fromUtc ||
      new Date(new Date(windowToUtc).getTime() - windowHours * 3600 * 1000).toISOString();
    windowLabel = options.fromUtc
      ? `Khung tùy chỉnh ${formatVn(windowFromUtc)} → ${formatVn(windowToUtc)}`
      : `Cửa sổ ${windowHours}h gần nhất (Live Supabase)`;

    const sigRes = await fetchSupabaseSignals(
      supabaseCfg!,
      windowFromUtc,
      windowToUtc,
    );
    rawSignals = sigRes.rows;
    signalsAvailable = sigRes.available;
    signalsNote = sigRes.note;
    signalsCapturedAtUtc = sigRes.capturedAtUtc;

    const candidateIds = rawSignals
      .filter((s) => s.phase === "alert_ready" && s.diem >= SCORE_THRESHOLD)
      .map((s) => s.id);

    const [recRes, hbRes] = await Promise.all([
      fetchSupabaseReceipts(supabaseCfg!, candidateIds),
      fetchSenderHeartbeat(supabaseCfg),
    ]);

    receipts = recRes.receipts;
    receiptsAvailable = recRes.available;
    receiptsNote = recRes.note;
    receiptsCapturedAtUtc = recRes.capturedAtUtc;
    heartbeat = hbRes;
  }

  // Stage 1: SOÁT
  const soat = runSoat(rawSignals);

  // Stage 2: DÒ
  const doStage = runDo(soat.qualified, receipts, receiptsAvailable, heartbeat);

  // Stage 3: CHỐT
  const chot = runChot(
    doStage.preliminary,
    receiptsAvailable,
    receiptsCapturedAtUtc,
    heartbeat,
  );

  // Stage 4: ĐIỀU PHỐI
  const dpStarted = Date.now();
  const dpStartedAtUtc = new Date(dpStarted).toISOString();

  const confirmedMissing = chot.items.filter((i) => i.verdict === "MAT");
  const durableAlerted =
    mode === "live" ? await fetchAlertedSignalIds(supabaseCfg) : new Set<string>();

  const newlyMissing: AuditItem[] = [];
  const dedupedIds: string[] = [];

  for (const item of confirmedMissing) {
    if (
      inMemoryAlertedIds.has(item.signal.id) ||
      durableAlerted.has(item.signal.id)
    ) {
      item.alertDedupeSkipped = true;
      dedupedIds.push(item.signal.id);
    } else {
      newlyMissing.push(item);
    }
  }

  const partialReportForMsg = {
    mode,
    windowLabel,
    capturedAtUtc: formatUtc(now),
    capturedAtVn: formatVn(now),
    counts: {
      rawSignalsScanned: rawSignals.length,
      qualifiedExpected: soat.qualified.length,
      ignoredNonAlertReady: soat.ignoredNonAlertReady,
      ignoredLowScore: soat.ignoredLowScore,
      du: doStage.duCount,
      muon: doStage.muonCount,
      thieuRaw: doStage.thieuCount,
      matConfirmed: chot.matConfirmed,
      canKiemTra: chot.canKiemTra,
      canhBaoGia: chot.canhBaoGia,
    },
  };

  const messagePreview = formatMissingAlertMessage(
    partialReportForMsg,
    newlyMissing.length > 0 ? newlyMissing : confirmedMissing,
  );

  let telegram: TelegramDispatchSummary;

  const shouldNotify =
    Boolean(options.sendTelegram) &&
    (newlyMissing.length > 0 || Boolean(options.includeDailyDigest));

  if (confirmedMissing.length === 0 && !options.includeDailyDigest) {
    telegram = {
      attempted: false,
      sent: false,
      mode: "skipped_no_missing",
      newlyAlertedIds: [],
      dedupedIds: [],
      messagePreview,
    };
  } else if (newlyMissing.length === 0 && !options.includeDailyDigest) {
    telegram = {
      attempted: false,
      sent: false,
      mode: "skipped_dedupe",
      newlyAlertedIds: [],
      dedupedIds,
      messagePreview,
    };
  } else if (!shouldNotify) {
    telegram = {
      attempted: false,
      sent: false,
      mode: "dry_run",
      newlyAlertedIds: newlyMissing.map((i) => i.signal.id),
      dedupedIds,
      messagePreview,
    };
  } else if (!getTelegramConfig()) {
    telegram = {
      attempted: false,
      sent: false,
      mode: "skipped_no_config",
      newlyAlertedIds: newlyMissing.map((i) => i.signal.id),
      dedupedIds,
      messagePreview,
      error:
        "Chưa cấu hình BOT_TOKEN_TRADEMRBIT / SIGNAL_CHAT_ID (hoặc TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) trên Vercel",
    };
  } else {
    const res = await sendTelegramAlert(messagePreview);
    if (res.ok) {
      for (const item of newlyMissing) {
        item.alerted = true;
        inMemoryAlertedIds.add(item.signal.id);
        if (mode === "live") {
          await recordAlertedSignalId(
            supabaseCfg,
            item.signal.id,
            item.verdict,
            item.evidence,
            res.messageId,
          );
        }
      }
    }
    telegram = {
      attempted: true,
      sent: res.ok,
      mode: "live",
      newlyAlertedIds: res.ok ? newlyMissing.map((i) => i.signal.id) : [],
      dedupedIds,
      messagePreview,
      error: res.error,
    };
  }

  const dpFinished = Date.now();
  const dieuPhoiTrace: AgentStageTrace = {
    agent: "DIEU_PHOI",
    roleTitle: "Agent 4 · Điều phối",
    responsibility:
      "Gom MỘT báo cáo chuẩn UTC+VN, chống gửi trùng theo signal_id, gửi Telegram khi có MẤT đã chốt",
    startedAtUtc: dpStartedAtUtc,
    finishedAtUtc: new Date(dpFinished).toISOString(),
    durationMs: Math.max(1, dpFinished - dpStarted),
    summary:
      telegram.sent
        ? `Đã gửi 1 báo cáo Telegram cho ${telegram.newlyAlertedIds.length} ca MẤT mới (bỏ qua ${dedupedIds.length} ca đã báo).`
        : confirmedMissing.length === 0
          ? "Báo cáo sạch: 0 tín hiệu MẤT, không gửi cảnh báo giả."
          : `Đã gom báo cáo (${confirmedMissing.length} ca MẤT; trạng thái gửi Telegram: ${telegram.mode}).`,
    metrics: {
      confirmedMissing: confirmedMissing.length,
      newlyAlerted: telegram.newlyAlertedIds.length,
      deduped: dedupedIds.length,
      telegramMode: telegram.mode,
    },
  };

  const report: MonitorReport = {
    runId: `run_${now.getTime().toString(36)}`,
    mode,
    scenario,
    windowLabel,
    windowFromUtc,
    windowToUtc,
    capturedAtUtc: formatUtc(now),
    capturedAtVn: formatVn(now),
    sources: {
      signals: {
        name: "Supabase signals",
        available: signalsAvailable,
        recordCount: rawSignals.length,
        capturedAtUtc: formatUtc(signalsCapturedAtUtc),
        note: signalsNote,
      },
      receipts: {
        name: "Supabase delivery_receipts",
        available: receiptsAvailable,
        recordCount: receiptsAvailable ? receipts.length : null,
        capturedAtUtc: formatUtc(receiptsCapturedAtUtc),
        note: receiptsNote,
      },
      heartbeat: {
        name: heartbeat.source,
        available: heartbeat.available,
        recordCount: heartbeat.available ? heartbeat.sentIds.length : null,
        capturedAtUtc: formatUtc(heartbeat.checkedAtUtc),
        note: heartbeat.note,
      },
    },
    counts: partialReportForMsg.counts,
    items: chot.items,
    stages: [soat.trace, doStage.trace, chot.trace, dieuPhoiTrace],
    telegram,
    safetyAttestation: {
      readOnlyOnSignals: true,
      noOrderPlacement: true,
      noSignalResend: true,
      noSecretsInCode: true,
      twoSourceVerificationEnforced: true,
    },
  };

  lastReportCache = report;
  reportHistory.unshift(report);
  if (reportHistory.length > 25) {
    reportHistory.pop();
  }

  return report;
}
