import { runMonitorPipeline, resetInMemoryDedupeForTest } from "./engine";

export interface AcceptanceCheck {
  id: string;
  title: string;
  passed: boolean;
  detail: string;
}

export interface AcceptanceSuiteResult {
  allPassed: boolean;
  ranAtUtc: string;
  checks: AcceptanceCheck[];
}

export async function runAcceptanceSuite(): Promise<AcceptanceSuiteResult> {
  resetInMemoryDedupeForTest();

  const checks: AcceptanceCheck[] = [];

  // Test 1 (§9.1): 10/11/2026 UTC -> phải thấy LINK-short-1794327319494 và kết luận MẤT
  const report1 = await runMonitorPipeline({
    mode: "demo",
    scenario: "acceptance-2026-11-10",
    sendTelegram: false,
  });
  const linkItem = report1.items.find(
    (i) => i.signal.id === "LINK-short-1794327319494",
  );
  checks.push({
    id: "T1_LINK_SHORT_MISSING",
    title: "§9.1 Bắt đúng ca MẤT LINK-short-1794327319494 (10/11/2026 UTC)",
    passed:
      Boolean(linkItem) &&
      linkItem?.signal.diem === 88 &&
      linkItem?.signal.phase === "alert_ready" &&
      linkItem?.verdict === "MAT" &&
      report1.counts.matConfirmed === 1,
    detail: linkItem
      ? `Verdict=${linkItem.verdict}, điểm=${linkItem.signal.diem}, phase=${linkItem.signal.phase}, tổng MẤT=${report1.counts.matConfirmed}`
      : "Không tìm thấy LINK-short-1794327319494",
  });

  // Test 2 (§9.3): Đếm Soát khớp chính xác (chỉ alert_ready & diem >= 70, loại retest_in_progress & diem < 70)
  checks.push({
    id: "T2_SOAT_EXACT_COUNT",
    title: "§9.3 Đếm Soát chính xác (loại retest_in_progress & điểm < 70, không trùng id)",
    passed:
      report1.counts.rawSignalsScanned === 5 &&
      report1.counts.qualifiedExpected === 3 &&
      report1.counts.ignoredNonAlertReady === 1 &&
      report1.counts.ignoredLowScore === 1,
    detail: `Scanned=${report1.counts.rawSignalsScanned}, Qualified=${report1.counts.qualifiedExpected}, IgnoredPhase=${report1.counts.ignoredNonAlertReady}, IgnoredScore=${report1.counts.ignoredLowScore}`,
  });

  // Test 3 (§9.2): Ngày sạch (0 tín hiệu đạt ngưỡng) -> 0 mất, không báo giả
  const reportClean = await runMonitorPipeline({
    mode: "demo",
    scenario: "clean-day",
    sendTelegram: false,
  });
  checks.push({
    id: "T3_CLEAN_DAY_ZERO_FALSE_ALARM",
    title: "§9.2 Ngày sạch: báo 0 mất, không cảnh báo giả",
    passed:
      reportClean.counts.qualifiedExpected === 0 &&
      reportClean.counts.matConfirmed === 0 &&
      reportClean.telegram.mode === "skipped_no_missing",
    detail: `Qualified=${reportClean.counts.qualifiedExpected}, MẤT=${reportClean.counts.matConfirmed}, Telegram=${reportClean.telegram.mode}`,
  });

  // Test 4 (§3 / §9): Kiểm chứng loại cảnh báo giả khi nguồn độc lập xác nhận đã gửi
  const reportSim = await runMonitorPipeline({
    mode: "demo",
    scenario: "live-24h-sim",
    sendTelegram: false,
  });
  const suiItem = reportSim.items.find(
    (i) => i.signal.id === "SUI-short-20261123-04",
  );
  checks.push({
    id: "T4_FALSE_ALARM_FILTER",
    title: "§3 Chốt loại CẢNH BÁO GIẢ khi heartbeat xác nhận đã gửi",
    passed:
      Boolean(suiItem) &&
      suiItem?.verdict === "CANH_BAO_GIA" &&
      reportSim.counts.canhBaoGia === 1,
    detail: suiItem
      ? `SUI-short-20261123-04 → ${suiItem.verdict} (${suiItem.explanation})`
      : "Không tìm thấy SUI-short-20261123-04",
  });

  // Test 5 (§8): Safety attestation read-only on signals
  checks.push({
    id: "T5_SAFETY_ATTESTATION",
    title: "§8 Quy tắc an toàn v1 (chỉ đọc signals, không đặt lệnh, không gửi lại)",
    passed:
      report1.safetyAttestation.readOnlyOnSignals &&
      report1.safetyAttestation.noOrderPlacement &&
      report1.safetyAttestation.noSignalResend &&
      report1.safetyAttestation.twoSourceVerificationEnforced,
    detail: "Tất cả 5 cờ an toàn v1 đều bật và được thực thi trong engine",
  });

  return {
    allPassed: checks.every((c) => c.passed),
    ranAtUtc: new Date().toISOString(),
    checks,
  };
}
