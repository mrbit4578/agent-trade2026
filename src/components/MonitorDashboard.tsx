"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  Play,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Terminal,
  XCircle,
} from "lucide-react";
import type {
  AuditItem,
  DemoScenarioId,
  FinalVerdict,
  MonitorReport,
} from "@/lib/monitor/types";
import type { AcceptanceSuiteResult } from "@/lib/monitor/acceptance";

interface EnvStatus {
  supabaseConfigured: boolean;
  telegramConfigured: boolean;
  vpsHeartbeatConfigured: boolean;
  cronSecretConfigured: boolean;
  monitorSecretConfigured: boolean;
  mode: "live" | "demo";
  supabaseHost: string;
}

interface HistoryEntry {
  runId: string;
  mode: "live" | "demo";
  scenario: string | null;
  windowLabel: string;
  capturedAtUtc: string;
  capturedAtVn: string;
  counts: MonitorReport["counts"];
  telegramSent: boolean;
}

const VERDICT_META: Record<
  FinalVerdict,
  { label: string; badgeClass: string; rowAccent: string }
> = {
  MAT: {
    label: "MẤT (2 NGUỒN)",
    badgeClass:
      "bg-rose-500/15 text-rose-300 border border-rose-500/40 font-semibold",
    rowAccent: "border-l-2 border-l-rose-500 bg-rose-950/15",
  },
  CAN_KIEM_TRA: {
    label: "CẦN KIỂM TRA",
    badgeClass:
      "bg-amber-500/15 text-amber-300 border border-amber-500/40 font-semibold",
    rowAccent: "border-l-2 border-l-amber-500 bg-amber-950/10",
  },
  MUON: {
    label: "MUỘN (>15P)",
    badgeClass: "bg-orange-500/15 text-orange-300 border border-orange-500/35",
    rowAccent: "border-l-2 border-l-orange-500/70",
  },
  DU: {
    label: "ĐỦ",
    badgeClass:
      "bg-emerald-500/15 text-emerald-300 border border-emerald-500/35",
    rowAccent: "border-l-2 border-l-emerald-500/50",
  },
  CANH_BAO_GIA: {
    label: "CẢNH BÁO GIẢ",
    badgeClass: "bg-slate-700/60 text-slate-300 border border-slate-600/60",
    rowAccent: "border-l-2 border-l-slate-500/50 opacity-80",
  },
};

const P0_SQL_SNIPPET = `-- CHỈ chạy trong project almond-fence (fagveiomuwuyuzzeepvk)
create table if not exists public.delivery_receipts (
  signal_id text primary key,
  sent_at timestamptz,
  relay_response jsonb,
  telegram_message_id text,
  checked_at timestamptz not null default now(),
  status text not null check (status in ('sent', 'duplicate', 'failed'))
);

create table if not exists public.monitor_alerts (
  signal_id text primary key,
  verdict text not null,
  alerted_at timestamptz not null default now(),
  telegram_message_id text,
  evidence jsonb
);

-- Bật RLS (KHÔNG tạo policy public nào — chỉ service_role bypass RLS)
alter table public.delivery_receipts enable row level security;
alter table public.monitor_alerts enable row level security;`;

export function MonitorDashboard() {
  const [envStatus, setEnvStatus] = useState<EnvStatus | null>(null);
  const [report, setReport] = useState<MonitorReport | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [acceptance, setAcceptance] = useState<AcceptanceSuiteResult | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runningAcceptance, setRunningAcceptance] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedScenario, setSelectedScenario] =
    useState<DemoScenarioId>("live-24h-sim");
  const [selectedMode, setSelectedMode] = useState<"auto" | "live" | "demo">(
    "auto",
  );
  const [windowHours, setWindowHours] = useState<number>(24);
  const [sendTelegram, setSendTelegram] = useState<boolean>(false);
  const [monitorSecret, setMonitorSecret] = useState<string>("");
  const [verdictFilter, setVerdictFilter] = useState<FinalVerdict | "ALL">(
    "ALL",
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "audit" | "telegram" | "acceptance" | "setup"
  >("audit");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/monitor/status", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setEnvStatus(data.envStatus);
      setReport(data.report);
      setHistory(data.history || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được trạng thái");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("trade2026_monitor_secret");
      if (saved) setMonitorSecret(saved);
    } catch {
      // ignore storage errors
    }
    void loadStatus();
  }, [loadStatus]);

  const handleSecretChange = (val: string) => {
    setMonitorSecret(val);
    try {
      if (val) sessionStorage.setItem("trade2026_monitor_secret", val);
      else sessionStorage.removeItem("trade2026_monitor_secret");
    } catch {
      // ignore storage errors
    }
  };

  const triggerRun = async (overrides?: {
    mode?: "auto" | "live" | "demo";
    scenario?: DemoScenarioId;
    sendTelegram?: boolean;
  }) => {
    setRunning(true);
    setError(null);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (monitorSecret.trim()) {
        headers["x-monitor-secret"] = monitorSecret.trim();
      }
      const res = await fetch("/api/monitor/run", {
        method: "POST",
        headers,
        body: JSON.stringify({
          mode: overrides?.mode ?? selectedMode,
          scenario: overrides?.scenario ?? selectedScenario,
          windowHours,
          sendTelegram: overrides?.sendTelegram ?? sendTelegram,
        }),
      });
      const data = await res.json();
      if (res.status === 401) {
        throw new Error(
          "401 Unauthorized — Nhập đúng MONITOR_SECRET vào ô khóa bên dưới (khớp biến MONITOR_SECRET trên Vercel) để chạy quét.",
        );
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setReport(data.report);
      // Refresh history lightly
      const statusRes = await fetch("/api/monitor/status", {
        cache: "no-store",
      });
      if (statusRes.ok) {
        const sData = await statusRes.json();
        setHistory(sData.history || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi chạy pipeline");
    } finally {
      setRunning(false);
    }
  };

  const runAcceptance = async () => {
    setRunningAcceptance(true);
    setActiveTab("acceptance");
    try {
      const res = await fetch("/api/monitor/acceptance", { cache: "no-store" });
      const data = await res.json();
      if (res.ok && data.ok) {
        setAcceptance({
          allPassed: data.allPassed,
          ranAtUtc: data.ranAtUtc,
          checks: data.checks,
        });
      }
    } finally {
      setRunningAcceptance(false);
    }
  };

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const filteredItems: AuditItem[] = useMemo(() => {
    if (!report) return [];
    if (verdictFilter === "ALL") return report.items;
    return report.items.filter((i) => i.verdict === verdictFilter);
  }, [report, verdictFilter]);

  return (
    <div className="min-h-screen bg-[#060a13] text-slate-200">
      {/* Top Ops Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#080d19]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
              <Radio className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-wide text-slate-100 uppercase">
                  Trade.2026 · Signal Monitor Agent
                </h1>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-mono font-semibold ${
                    report?.mode === "live"
                      ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/35"
                      : "bg-amber-500/15 text-amber-300 border border-amber-500/35"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      report?.mode === "live"
                        ? "bg-emerald-400 animate-pulse"
                        : "bg-amber-400"
                    }`}
                  />
                  {report?.mode === "live" ? "LIVE SUPABASE" : "DEMO SANDBOX"}
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-mono text-slate-400">
                  <Clock className="h-3 w-3 text-cyan-400" />
                  CRON */15m
                </span>
              </div>
              <p className="text-xs text-slate-400">
                4-Agent Deterministic Core (Soát → Dò → Chốt → Điều phối) · Chỉ
                đọc & báo cáo · Xác minh 2 nguồn độc lập
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void runAcceptance()}
              disabled={runningAcceptance}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-cyan-500/50 hover:text-cyan-200 disabled:opacity-50"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />
              {runningAcceptance ? "Đang kiểm thử..." : "Kiểm thử §9"}
            </button>
            <button
              onClick={() => void triggerRun()}
              disabled={running}
              className="inline-flex items-center gap-1.5 rounded-md bg-cyan-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
            >
              {running ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current" />
              )}
              {running ? "Đang quét..." : "Chạy quét ngay"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] space-y-4 px-4 py-4">
        {error && (
          <div className="flex items-center justify-between rounded-lg border border-rose-500/40 bg-rose-950/30 px-4 py-2.5 text-xs text-rose-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-400" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => void loadStatus()}
              className="underline hover:text-white"
            >
              Thử lại
            </button>
          </div>
        )}

        {/* Control Strip */}
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#0b1120] px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-slate-400 uppercase">
                Nguồn:
              </span>
              <select
                value={selectedMode}
                onChange={(e) =>
                  setSelectedMode(e.target.value as "auto" | "live" | "demo")
                }
                className="rounded border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="auto">
                  Auto ({envStatus?.supabaseConfigured ? "Live" : "Demo"})
                </option>
                <option value="live" disabled={!envStatus?.supabaseConfigured}>
                  Live Supabase{" "}
                  {!envStatus?.supabaseConfigured ? "(chưa gắn key)" : ""}
                </option>
                <option value="demo">Demo / Fixture</option>
              </select>
            </label>

            {(selectedMode === "demo" ||
              (selectedMode === "auto" && !envStatus?.supabaseConfigured)) && (
              <label className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-slate-400 uppercase">
                  Kịch bản:
                </span>
                <select
                  value={selectedScenario}
                  onChange={(e) => {
                    const next = e.target.value as DemoScenarioId;
                    setSelectedScenario(next);
                    void triggerRun({ mode: "demo", scenario: next });
                  }}
                  className="rounded border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                >
                  <option value="live-24h-sim">
                    Mô phỏng 24h (Đủ / Muộn / Mất / Cảnh báo giả)
                  </option>
                  <option value="acceptance-2026-11-10">
                    §9.1 Khung 10/11/2026 UTC (LINK-short-1794327319494)
                  </option>
                  <option value="clean-day">
                    §9.2 Ngày sạch (0 tín hiệu đạt ngưỡng)
                  </option>
                </select>
              </label>
            )}

            {envStatus?.supabaseConfigured && selectedMode !== "demo" && (
              <label className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-slate-400 uppercase">
                  Cửa sổ:
                </span>
                <select
                  value={windowHours}
                  onChange={(e) => setWindowHours(Number(e.target.value))}
                  className="rounded border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                >
                  <option value={6}>6 giờ gần nhất</option>
                  <option value={24}>24 giờ gần nhất</option>
                  <option value={72}>72 giờ gần nhất</option>
                  <option value={168}>7 ngày gần nhất</option>
                </select>
              </label>
            )}

            <label className="flex cursor-pointer items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={sendTelegram}
                onChange={(e) => setSendTelegram(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 accent-cyan-500"
              />
              <span className="text-slate-300">
                Gửi Telegram thật nếu có MẤT mới
              </span>
            </label>

            <label className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-slate-400 uppercase">
                Secret:
              </span>
              <input
                type="password"
                value={monitorSecret}
                onChange={(e) => handleSecretChange(e.target.value)}
                placeholder="MONITOR_SECRET..."
                autoComplete="off"
                className="w-36 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none"
              />
            </label>
          </div>

          {report && (
            <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-slate-400">
              <span>RUN: {report.runId}</span>
              <span className="text-slate-600">|</span>
              <span>{report.capturedAtUtc}</span>
              <span className="text-slate-600">|</span>
              <span className="text-cyan-300">{report.capturedAtVn}</span>
            </div>
          )}
        </section>

        {loading && !report ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-lg border border-slate-800 bg-[#0b1120]"
              />
            ))}
          </div>
        ) : (
          report && (
            <>
              {/* KPI Strip */}
              <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <KpiCard
                  label="KỲ VỌNG (SOÁT)"
                  value={report.counts.qualifiedExpected}
                  sub={`Quét ${report.counts.rawSignalsScanned} · Bỏ ${report.counts.ignoredNonAlertReady + report.counts.ignoredLowScore}`}
                  accent="text-cyan-300"
                />
                <KpiCard
                  label="ĐỦ (ĐÚNG HẠN)"
                  value={report.counts.du}
                  sub="Có receipt ≤ 15p"
                  accent="text-emerald-400"
                />
                <KpiCard
                  label="MUỘN (>15P)"
                  value={report.counts.muon}
                  sub="Đã gửi nhưng trễ"
                  accent="text-orange-400"
                />
                <KpiCard
                  label="MẤT (2 NGUỒN)"
                  value={report.counts.matConfirmed}
                  sub="Cần cảnh báo ngay"
                  accent={
                    report.counts.matConfirmed > 0
                      ? "text-rose-400"
                      : "text-slate-300"
                  }
                  highlight={report.counts.matConfirmed > 0}
                />
                <KpiCard
                  label="CẦN KIỂM TRA"
                  value={report.counts.canKiemTra}
                  sub="Chỉ có 1/2 nguồn"
                  accent="text-amber-400"
                />
                <KpiCard
                  label="CẢNH BÁO GIẢ"
                  value={report.counts.canhBaoGia}
                  sub="Đã loại bởi Chốt"
                  accent="text-slate-400"
                />
              </section>

              {/* 4-Agent Pipeline Strip */}
              <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {report.stages.map((stage, idx) => (
                  <div
                    key={stage.agent}
                    className="flex flex-col justify-between rounded-lg border border-slate-800 bg-[#0b1120] p-3.5"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] font-semibold tracking-wider text-cyan-400 uppercase">
                          0{idx + 1} · {stage.roleTitle}
                        </span>
                        <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 tabular-nums">
                          {stage.durationMs}ms
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-200">
                        {stage.summary}
                      </p>
                    </div>
                    <p className="mt-2 border-t border-slate-800/80 pt-2 text-[11px] text-slate-500">
                      {stage.responsibility}
                    </p>
                  </div>
                ))}
              </section>

              {/* Data Sources Health Bar */}
              <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <SourceBadge
                  icon={<Database className="h-4 w-4" />}
                  title={report.sources.signals.name}
                  available={report.sources.signals.available}
                  note={report.sources.signals.note}
                  capturedAt={report.sources.signals.capturedAtUtc}
                />
                <SourceBadge
                  icon={<ShieldCheck className="h-4 w-4" />}
                  title={report.sources.receipts.name}
                  available={report.sources.receipts.available}
                  note={report.sources.receipts.note}
                  capturedAt={report.sources.receipts.capturedAtUtc}
                />
                <SourceBadge
                  icon={<Activity className="h-4 w-4" />}
                  title={report.sources.heartbeat.name}
                  available={report.sources.heartbeat.available}
                  note={report.sources.heartbeat.note}
                  capturedAt={report.sources.heartbeat.capturedAtUtc}
                />
              </section>

              {/* Main Tabs */}
              <section className="rounded-lg border border-slate-800 bg-[#0b1120]">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-1">
                    <TabButton
                      active={activeTab === "audit"}
                      onClick={() => setActiveTab("audit")}
                      label={`Bảng đối chiếu (${report.items.length})`}
                    />
                    <TabButton
                      active={activeTab === "telegram"}
                      onClick={() => setActiveTab("telegram")}
                      label="Báo cáo Telegram"
                    />
                    <TabButton
                      active={activeTab === "acceptance"}
                      onClick={() => {
                        setActiveTab("acceptance");
                        if (!acceptance) void runAcceptance();
                      }}
                      label="Kiểm thử chấp nhận §9"
                    />
                    <TabButton
                      active={activeTab === "setup"}
                      onClick={() => setActiveTab("setup")}
                      label="Cấu hình Live & P0 SQL"
                    />
                  </div>

                  {activeTab === "audit" && (
                    <div className="flex flex-wrap items-center gap-1 text-[11px]">
                      {(
                        [
                          "ALL",
                          "MAT",
                          "CAN_KIEM_TRA",
                          "MUON",
                          "DU",
                          "CANH_BAO_GIA",
                        ] as const
                      ).map((f) => (
                        <button
                          key={f}
                          onClick={() => setVerdictFilter(f)}
                          className={`rounded px-2 py-1 font-mono transition ${
                            verdictFilter === f
                              ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/40"
                              : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                          }`}
                        >
                          {f === "ALL" ? "TẤT CẢ" : VERDICT_META[f].label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* TAB 1: AUDIT TABLE */}
                {activeTab === "audit" && (
                  <div className="overflow-x-auto">
                    {filteredItems.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                        <p className="mt-2 text-sm font-medium text-slate-200">
                          Không có tín hiệu nào trong bộ lọc này
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          Cửa sổ hiện tại: {report.windowLabel} — 0 tín hiệu MẤT.
                        </p>
                      </div>
                    ) : (
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-slate-800 bg-slate-950/60 font-mono text-[11px] text-slate-400 uppercase">
                          <tr>
                            <th className="px-4 py-2.5">Signal ID</th>
                            <th className="px-3 py-2.5">Coin / Side</th>
                            <th className="px-3 py-2.5">Điểm</th>
                            <th className="px-3 py-2.5">Phase / Loại</th>
                            <th className="px-3 py-2.5">ts_vao (UTC)</th>
                            <th className="px-3 py-2.5">Receipt</th>
                            <th className="px-3 py-2.5">Heartbeat</th>
                            <th className="px-3 py-2.5">Độ trễ</th>
                            <th className="px-4 py-2.5 text-right">Kết luận</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70">
                          {filteredItems.map((item) => {
                            const meta = VERDICT_META[item.verdict];
                            const isOpen = expandedId === item.signal.id;
                            return (
                              <Fragment key={item.signal.id}>
                                <tr
                                  onClick={() =>
                                    setExpandedId(
                                      isOpen ? null : item.signal.id,
                                    )
                                  }
                                  className={`cursor-pointer transition hover:bg-slate-800/40 ${meta.rowAccent}`}
                                >
                                  <td className="px-4 py-2.5 font-mono text-[11px] font-medium text-slate-100">
                                    {item.signal.id}
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <span className="font-semibold text-slate-100">
                                      {item.signal.coin}
                                    </span>{" "}
                                    <span
                                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                                        item.signal.side?.toLowerCase() ===
                                        "long"
                                          ? "bg-emerald-500/15 text-emerald-300"
                                          : "bg-rose-500/15 text-rose-300"
                                      }`}
                                    >
                                      {item.signal.side}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2.5 font-mono font-semibold text-cyan-300 tabular-nums">
                                    {item.signal.diem}
                                  </td>
                                  <td className="px-3 py-2.5 font-mono text-[11px] text-slate-300">
                                    {item.signal.phase}
                                    <span className="text-slate-500">
                                      {" "}
                                      · {item.signal.loai ?? "—"}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2.5 font-mono text-[11px] text-slate-300 tabular-nums">
                                    {item.signal.ts_vao
                                      ? item.signal.ts_vao
                                          .replace("T", " ")
                                          .replace(".000Z", "Z")
                                      : "chưa có dữ liệu"}
                                  </td>
                                  <td className="px-3 py-2.5 font-mono text-[11px]">
                                    {item.receipt ? (
                                      <span
                                        className={
                                          item.receipt.status === "failed"
                                            ? "text-rose-300"
                                            : "text-emerald-300"
                                        }
                                      >
                                        {item.receipt.status.toUpperCase()}
                                      </span>
                                    ) : (
                                      <span className="text-slate-500">
                                        KHÔNG CÓ
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2.5 font-mono text-[11px]">
                                    {item.inHeartbeat === null ? (
                                      <span className="text-slate-500">N/A</span>
                                    ) : item.inHeartbeat ? (
                                      <span className="text-emerald-300">
                                        CÓ
                                      </span>
                                    ) : (
                                      <span className="text-rose-300">
                                        VẮNG
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2.5 font-mono text-[11px] text-slate-300 tabular-nums">
                                    {item.latencyMinutes !== null
                                      ? `${item.latencyMinutes}p`
                                      : "—"}
                                  </td>
                                  <td className="px-4 py-2.5 text-right">
                                    <span
                                      className={`inline-block rounded-full px-2.5 py-0.5 font-mono text-[10px] ${meta.badgeClass}`}
                                    >
                                      {meta.label}
                                    </span>
                                  </td>
                                </tr>
                                {isOpen && (
                                  <tr
                                    key={`${item.signal.id}-detail`}
                                    className="bg-slate-950/80"
                                  >
                                    <td colSpan={9} className="px-4 py-3">
                                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                        <div className="rounded border border-slate-800 bg-[#0b1120] p-3">
                                          <p className="font-mono text-[11px] font-semibold text-cyan-400 uppercase">
                                            Kết luận Agent Chốt
                                          </p>
                                          <p className="mt-1 text-xs text-slate-200">
                                            {item.explanation}
                                          </p>
                                          <div className="mt-2 flex flex-wrap gap-3 font-mono text-[11px] text-slate-400">
                                            <span>
                                              Entry: {item.signal.gia_vao ?? "—"}
                                            </span>
                                            <span>
                                              SL: {item.signal.sl ?? "—"}
                                            </span>
                                            <span>
                                              TP1: {item.signal.tp1 ?? "—"}
                                            </span>
                                            <span>
                                              R:R: {item.signal.rr ?? "—"}
                                            </span>
                                            <span>
                                              Phiên: {item.signal.phien ?? "—"}
                                            </span>
                                          </div>
                                        </div>
                                        <div className="rounded border border-slate-800 bg-[#0b1120] p-3">
                                          <p className="font-mono text-[11px] font-semibold text-cyan-400 uppercase">
                                            Bằng chứng 2 nguồn độc lập
                                          </p>
                                          <ul className="mt-1.5 space-y-1.5 text-xs">
                                            {item.evidence.map((ev) => (
                                              <li
                                                key={ev.source}
                                                className="flex items-start gap-2"
                                              >
                                                <span
                                                  className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                                                    !ev.available
                                                      ? "bg-amber-400"
                                                      : ev.delivered
                                                        ? "bg-emerald-400"
                                                        : "bg-rose-400"
                                                  }`}
                                                />
                                                <div>
                                                  <span className="font-mono text-[11px] text-slate-300">
                                                    {ev.source}:
                                                  </span>{" "}
                                                  <span className="text-slate-400">
                                                    {ev.detail}
                                                  </span>
                                                </div>
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {/* TAB 2: TELEGRAM PREVIEW */}
                {activeTab === "telegram" && (
                  <div className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs">
                        <Send className="h-4 w-4 text-cyan-400" />
                        <span className="font-medium text-slate-200">
                          Bản tin gom bởi Agent 4 (Điều phối)
                        </span>
                        <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-300">
                          mode: {report.telegram.mode}
                        </span>
                      </div>
                      <button
                        onClick={() =>
                          void copyText(
                            "tg-msg",
                            report.telegram.messagePreview,
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-200 hover:border-cyan-500/50"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {copiedKey === "tg-msg" ? "Đã chép" : "Chép tin nhắn"}
                      </button>
                    </div>
                    <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-200">
                      {report.telegram.messagePreview}
                    </pre>
                    {report.telegram.error && (
                      <p className="text-xs text-amber-300">
                        Ghi chú Telegram: {report.telegram.error}
                      </p>
                    )}
                  </div>
                )}

                {/* TAB 3: ACCEPTANCE SUITE §9 */}
                {activeTab === "acceptance" && (
                  <div className="space-y-3 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-sm font-semibold text-slate-100">
                          Bộ kiểm thử chấp nhận tự động (theo Brief §9)
                        </h2>
                        <p className="text-xs text-slate-400">
                          Kiểm chứng deterministic core trên fixture 10/11/2026
                          UTC (LINK-short-1794327319494), ngày sạch, lọc cảnh
                          báo giả và quy tắc an toàn v1.
                        </p>
                      </div>
                      <button
                        onClick={() => void runAcceptance()}
                        disabled={runningAcceptance}
                        className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20"
                      >
                        Chạy lại kiểm thử
                      </button>
                    </div>

                    {acceptance ? (
                      <div className="space-y-2">
                        {acceptance.checks.map((c) => (
                          <div
                            key={c.id}
                            className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${
                              c.passed
                                ? "border-emerald-500/30 bg-emerald-950/15"
                                : "border-rose-500/40 bg-rose-950/20"
                            }`}
                          >
                            <div className="flex items-start gap-2.5">
                              {c.passed ? (
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                              ) : (
                                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                              )}
                              <div>
                                <p className="text-xs font-semibold text-slate-100">
                                  {c.title}
                                </p>
                                <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                                  {c.detail}
                                </p>
                              </div>
                            </div>
                            <span
                              className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold ${
                                c.passed
                                  ? "bg-emerald-500/20 text-emerald-300"
                                  : "bg-rose-500/20 text-rose-300"
                              }`}
                            >
                              {c.passed ? "PASS" : "FAIL"}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">
                        Đang tải kết quả kiểm thử...
                      </p>
                    )}
                  </div>
                )}

                {/* TAB 4: LIVE SETUP & P0 SQL */}
                {activeTab === "setup" && (
                  <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
                    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                      <div className="flex items-center gap-2 text-xs font-semibold text-cyan-300">
                        <Terminal className="h-4 w-4" />
                        <span>
                          1. Biến môi trường trên Vercel (KHÔNG dán key vào code)
                        </span>
                      </div>
                      <ul className="space-y-2 text-xs">
                        <EnvRow
                          name="SUPABASE_URL"
                          ok={Boolean(envStatus?.supabaseHost)}
                          detail={envStatus?.supabaseHost || "fagveiomuwuyuzzeepvk.supabase.co"}
                        />
                        <EnvRow
                          name="SUPABASE_API_KEY"
                          ok={Boolean(envStatus?.supabaseConfigured)}
                          detail="Auth chỉ dùng header apikey (không gửi Bearer)"
                        />
                        <EnvRow
                          name="TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID"
                          ok={Boolean(envStatus?.telegramConfigured)}
                          detail="Gửi cảnh báo MẤT & báo cáo sáng 07:00 VN"
                        />
                        <EnvRow
                          name="VPS_HEARTBEAT_URL"
                          ok={Boolean(envStatus?.vpsHeartbeatConfigured)}
                          detail="Nguồn xác minh thứ 2 độc lập (telegram-sender sent_ids)"
                        />
                        <EnvRow
                          name="MONITOR_SECRET"
                          ok={Boolean(envStatus?.monitorSecretConfigured)}
                          detail="Bắt buộc cho POST /api/monitor/run & GitHub Actions cron (Bearer / x-monitor-secret)"
                        />
                        <EnvRow
                          name="CRON_SECRET"
                          ok={Boolean(envStatus?.cronSecretConfigured)}
                          detail="Tùy chọn bổ sung cho Vercel Cron hằng ngày /api/monitor/cron"
                        />
                      </ul>
                    </div>

                    <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-cyan-300">
                          2. P0 SQL — Bảng delivery_receipts trên Supabase
                        </span>
                        <button
                          onClick={() => void copyText("p0-sql", P0_SQL_SNIPPET)}
                          className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-500/50"
                        >
                          <Copy className="h-3 w-3" />
                          {copiedKey === "p0-sql" ? "Đã chép" : "Chép SQL"}
                        </button>
                      </div>
                      <pre className="overflow-x-auto rounded border border-slate-800 bg-[#060a13] p-3 font-mono text-[11px] text-slate-300">
                        {P0_SQL_SNIPPET}
                      </pre>
                      <p className="text-[11px] text-slate-400">
                        Xem thêm bản vá tối thiểu cho{" "}
                        <code className="text-cyan-300">
                          tools/telegram-sender.js
                        </code>{" "}
                        tại <code className="text-slate-300">docs/vps-sender-patch.md</code>{" "}
                        trong repo GitHub.
                      </p>
                    </div>
                  </div>
                )}
              </section>

              {/* Run History & Safety Footer */}
              <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div className="rounded-lg border border-slate-800 bg-[#0b1120] p-3.5 lg:col-span-2">
                  <h3 className="font-mono text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                    Lịch sử phiên chạy gần đây ({history.length})
                  </h3>
                  <div className="mt-2 max-h-40 overflow-y-auto divide-y divide-slate-800/70 text-xs">
                    {history.map((h) => (
                      <div
                        key={h.runId}
                        className="flex flex-wrap items-center justify-between gap-2 py-1.5 font-mono text-[11px]"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-cyan-400">{h.runId}</span>
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 uppercase">
                            {h.mode}
                          </span>
                          <span className="text-slate-400">
                            {h.capturedAtVn}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 tabular-nums">
                          <span className="text-slate-300">
                            KV:{h.counts.qualifiedExpected}
                          </span>
                          <span className="text-emerald-400">
                            ĐỦ:{h.counts.du}
                          </span>
                          <span className="text-rose-400">
                            MẤT:{h.counts.matConfirmed}
                          </span>
                          <span className="text-amber-400">
                            KT:{h.counts.canKiemTra}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-emerald-500/25 bg-emerald-950/10 p-3.5">
                  <div className="flex items-center gap-2 font-mono text-[11px] font-semibold tracking-wider text-emerald-300 uppercase">
                    <ShieldCheck className="h-4 w-4" />
                    Cam kết an toàn v1 (Brief §8)
                  </div>
                  <ul className="mt-2 space-y-1 text-xs text-slate-300">
                    <li>• Chỉ đọc bảng signals (GET-only, apikey header)</li>
                    <li>• Không đặt lệnh, không gửi lại tín hiệu</li>
                    <li>• Xác minh 2 nguồn độc lập trước khi chốt MẤT</li>
                    <li>• Chống gửi trùng cảnh báo theo signal_id</li>
                    <li>• 0 secret trong code / chat (100% Env Vars)</li>
                  </ul>
                </div>
              </section>
            </>
          )
        )}
      </main>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  accent,
  highlight = false,
}: {
  label: string;
  value: number;
  sub: string;
  accent: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3.5 ${
        highlight
          ? "border-rose-500/50 bg-rose-950/20"
          : "border-slate-800 bg-[#0b1120]"
      }`}
    >
      <p className="font-mono text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
        {label}
      </p>
      <p className={`mt-1 font-mono text-2xl font-bold tabular-nums ${accent}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>
    </div>
  );
}

function SourceBadge({
  icon,
  title,
  available,
  note,
  capturedAt,
}: {
  icon: React.ReactNode;
  title: string;
  available: boolean;
  note: string;
  capturedAt: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-[#0b1120] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
          <span className={available ? "text-emerald-400" : "text-amber-400"}>
            {icon}
          </span>
          <span className="truncate">{title}</span>
        </div>
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
            available
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-amber-500/15 text-amber-300"
          }`}
        >
          {available ? "ONLINE" : "CHƯA CÓ DỮ LIỆU"}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">{note}</p>
      <p className="mt-1 font-mono text-[10px] text-slate-600">{capturedAt}</p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "bg-slate-800 text-cyan-300"
          : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

function EnvRow({
  name,
  ok,
  detail,
}: {
  name: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <li className="flex items-start justify-between gap-2 rounded border border-slate-800/80 bg-[#0b1120] px-3 py-2">
      <div>
        <code className="font-mono text-[11px] text-slate-200">{name}</code>
        <p className="mt-0.5 text-[11px] text-slate-400">{detail}</p>
      </div>
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
          ok
            ? "bg-emerald-500/15 text-emerald-300"
            : "bg-slate-800 text-slate-400"
        }`}
      >
        {ok ? "SET" : "UNSET"}
      </span>
    </li>
  );
}
