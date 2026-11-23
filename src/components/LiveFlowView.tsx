"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  Clock,
  HelpCircle,
  PauseCircle,
  Radio,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type {
  FlowNodeId,
  FlowNodeState,
  FlowNodeStatus,
  FlowPayload,
} from "@/lib/flow/types";

const POLL_INTERVAL_MS = 30_000;

const NODE_STYLES: Record<
  FlowNodeStatus,
  {
    card: string;
    badge: string;
    dot: string;
    arrow: string;
    icon: "green" | "yellow" | "red" | "grey";
  }
> = {
  green: {
    card: "border-emerald-500/40 bg-emerald-950/15 hover:border-emerald-400/70",
    badge:
      "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40",
    dot: "bg-emerald-400 animate-pulse",
    arrow: "text-emerald-400",
    icon: "green",
  },
  yellow: {
    card: "border-amber-500/45 bg-amber-950/15 hover:border-amber-400/75",
    badge: "bg-amber-500/15 text-amber-300 border border-amber-500/40",
    dot: "bg-amber-400",
    arrow: "text-amber-400",
    icon: "yellow",
  },
  red: {
    card: "border-rose-500/60 bg-rose-950/25 ring-1 ring-rose-500/30 hover:border-rose-400",
    badge: "bg-rose-500/20 text-rose-200 border border-rose-500/50",
    dot: "bg-rose-500 animate-ping",
    arrow: "text-rose-400",
    icon: "red",
  },
  grey_waiting: {
    card: "border-slate-700/80 bg-slate-900/50 hover:border-slate-600",
    badge: "bg-slate-800 text-slate-300 border border-slate-700",
    dot: "bg-slate-500",
    arrow: "text-slate-600",
    icon: "grey",
  },
  grey_no_data: {
    card: "border-slate-700/80 bg-slate-900/40 hover:border-slate-600",
    badge: "bg-slate-800 text-slate-400 border border-slate-700",
    dot: "bg-slate-500",
    arrow: "text-slate-600",
    icon: "grey",
  },
};

const BANNER_STYLES: Record<
  FlowPayload["banner"]["level"],
  { wrap: string; title: string; iconColor: string }
> = {
  green: {
    wrap: "border-emerald-500/40 bg-emerald-950/25",
    title: "text-emerald-200",
    iconColor: "text-emerald-400",
  },
  yellow: {
    wrap: "border-amber-500/45 bg-amber-950/20",
    title: "text-amber-200",
    iconColor: "text-amber-400",
  },
  red: {
    wrap: "border-rose-500/60 bg-rose-950/30",
    title: "text-rose-200",
    iconColor: "text-rose-400",
  },
  grey: {
    wrap: "border-slate-700 bg-slate-900/70",
    title: "text-slate-200",
    iconColor: "text-slate-400",
  },
};

const DETAIL_BADGE: Record<string, string> = {
  emerald: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/35",
  amber: "bg-amber-500/15 text-amber-300 border border-amber-500/35",
  rose: "bg-rose-500/15 text-rose-300 border border-rose-500/40",
  cyan: "bg-cyan-500/15 text-cyan-300 border border-cyan-500/35",
  slate: "bg-slate-800 text-slate-300 border border-slate-700",
};

export function LiveFlowView() {
  const [flow, setFlow] = useState<FlowPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<FlowNodeId>("collector");
  const [lastFetchedMs, setLastFetchedMs] = useState<number>(Date.now());
  const [staleSeconds, setStaleSeconds] = useState<number>(0);

  const fetchFlow = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/monitor/flow", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setFlow(data as FlowPayload);
      setLastFetchedMs(Date.now());
      setStaleSeconds(0);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Không tải được dữ liệu dòng chảy live",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load + 30s polling
  useEffect(() => {
    void fetchFlow(false);
    const poll = setInterval(() => {
      void fetchFlow(false);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(poll);
  }, [fetchFlow]);

  // 1s ticker for "dữ liệu cũ X giây"
  useEffect(() => {
    const tick = setInterval(() => {
      setStaleSeconds(Math.max(0, Math.floor((Date.now() - lastFetchedMs) / 1000)));
    }, 1000);
    return () => clearInterval(tick);
  }, [lastFetchedMs]);

  const selectedNode: FlowNodeState | null =
    flow?.nodes.find((n) => n.id === selectedNodeId) ?? flow?.nodes[0] ?? null;

  if (loading && !flow) {
    return (
      <div className="space-y-4">
        <div className="h-20 animate-pulse rounded-lg border border-slate-800 bg-[#0b1120]" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-44 animate-pulse rounded-lg border border-slate-800 bg-[#0b1120]"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/40 bg-rose-950/30 px-4 py-2.5 text-xs text-rose-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => void fetchFlow(true)}
            className="shrink-0 underline hover:text-white"
          >
            Thử lại
          </button>
        </div>
      )}

      {flow && (
        <>
          {/* Overall Status Banner (§4) */}
          <section
            className={`rounded-lg border p-4 ${BANNER_STYLES[flow.banner.level].wrap}`}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 shrink-0 ${BANNER_STYLES[flow.banner.level].iconColor}`}>
                  {flow.banner.level === "green" && (
                    <CheckCircle2 className="h-5 w-5" />
                  )}
                  {flow.banner.level === "yellow" && (
                    <AlertTriangle className="h-5 w-5" />
                  )}
                  {flow.banner.level === "red" && (
                    <AlertOctagon className="h-5 w-5" />
                  )}
                  {flow.banner.level === "grey" && (
                    <HelpCircle className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <p
                    className={`text-sm font-bold leading-snug ${BANNER_STYLES[flow.banner.level].title}`}
                  >
                    {flow.banner.headline}
                  </p>
                  <p className="mt-1 text-xs text-slate-300/90">
                    {flow.banner.subline}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                <span className="inline-flex items-center gap-1.5 rounded border border-slate-700/80 bg-slate-950/70 px-2.5 py-1 font-mono text-[11px] text-slate-300 tabular-nums">
                  <Clock className="h-3.5 w-3.5 text-cyan-400" />
                  Cập nhật lần cuối {flow.fetchedAtHmsVn} — dữ liệu cũ{" "}
                  {staleSeconds} giây
                </span>
                <button
                  onClick={() => void fetchFlow(true)}
                  disabled={refreshing}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-cyan-500/50 hover:text-cyan-200 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-cyan-400" : ""}`}
                  />
                  Làm mới
                </button>
              </div>
            </div>

            {/* Manual vs Scheduled distinction strip (§5) */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-700/50 pt-2.5 font-mono text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <Radio className="h-3 w-3 text-cyan-400" />
                Tự làm mới mỗi 30 giây · Chế độ chỉ đọc (không cần secret)
              </span>
              <span>
                Quét tay gần nhất:{" "}
                <strong className="text-slate-200">
                  {flow.scheduleSummary.lastManualRunVn ?? "chưa ghi nhận"}
                </strong>
              </span>
              <span>
                Quét theo lịch:{" "}
                <strong
                  className={
                    flow.scheduleSummary.lastScheduledRunVn
                      ? "text-emerald-300"
                      : "text-amber-300"
                  }
                >
                  {flow.scheduleSummary.lastScheduledRunVn ?? "chưa chạy theo lịch"}
                </strong>
              </span>
            </div>
          </section>

          {/* 6-Node Live Flow Diagram */}
          <section aria-label="Sơ đồ dòng chảy 6 nút">
            {/* Desktop / Tablet (md+): 2 rows x 3 cols with animated flow connectors */}
            <div className="hidden md:block space-y-3">
              {/* Row 1: Nodes 1 -> 2 -> 3 */}
              <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-2">
                {flow.nodes.slice(0, 3).map((node, idx) => (
                  <div key={node.id} className="contents">
                    <FlowNodeCard
                      node={node}
                      selected={selectedNode?.id === node.id}
                      onSelect={() => setSelectedNodeId(node.id)}
                    />
                    {idx < 2 && <FlowConnectorHorizontal status={node.status} />}
                  </div>
                ))}
              </div>

              {/* Bridge connector from Row 1 (Node 3) to Row 2 (Node 4) */}
              <div className="flex items-center justify-center py-0.5">
                <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-[#0b1120] px-3 py-1 font-mono text-[10px] text-slate-400">
                  <span>03 · Agent 2 Dò</span>
                  <ArrowDown className="h-3.5 w-3.5 text-cyan-400" />
                  <span>04 · Agent 3 Chốt</span>
                </div>
              </div>

              {/* Row 2: Nodes 4 -> 5 -> 6 */}
              <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-2">
                {flow.nodes.slice(3, 6).map((node, idx) => (
                  <div key={node.id} className="contents">
                    <FlowNodeCard
                      node={node}
                      selected={selectedNode?.id === node.id}
                      onSelect={() => setSelectedNodeId(node.id)}
                    />
                    {idx < 2 && <FlowConnectorHorizontal status={node.status} />}
                  </div>
                ))}
              </div>
            </div>

            {/* Mobile (< md, including 390px): Vertical 6-node stack with downward arrows */}
            <div className="flex flex-col gap-1.5 md:hidden">
              {flow.nodes.map((node, idx) => (
                <div key={node.id} className="flex flex-col items-stretch">
                  <FlowNodeCard
                    node={node}
                    selected={selectedNode?.id === node.id}
                    onSelect={() => setSelectedNodeId(node.id)}
                  />
                  {idx < flow.nodes.length - 1 && (
                    <div className="flex justify-center py-1">
                      <ArrowDown
                        className={`h-4 w-4 ${NODE_STYLES[node.status].arrow}`}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Selected Node Detail Panel (5 most recent rows, §6) */}
          {selectedNode && (
            <section className="rounded-lg border border-slate-800 bg-[#0b1120] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div>
                  <p className="font-mono text-[11px] font-semibold tracking-wider text-cyan-400 uppercase">
                    Chi tiết nút 0{selectedNode.order} · {selectedNode.name}
                  </p>
                  <h3 className="mt-0.5 text-sm font-semibold text-slate-100">
                    {selectedNode.detailsTitle}
                  </h3>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold ${NODE_STYLES[selectedNode.status].badge}`}
                >
                  {selectedNode.statusLabel}
                </span>
              </div>

              {selectedNode.details.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-400">
                  Chưa có dữ liệu chi tiết cho nút này.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-800/70">
                  {selectedNode.details.map((row) => (
                    <li
                      key={`${selectedNode.id}-${row.id}`}
                      className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs font-medium text-slate-100">
                          {row.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-400 break-words">
                          {row.subtitle}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                          {row.timestampVn}
                        </span>
                        {row.badge && (
                          <span
                            className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold ${
                              DETAIL_BADGE[row.badgeTone ?? "slate"]
                            }`}
                          >
                            {row.badge}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Threshold Legend + Read-Only Safety Strip */}
          <section className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800/80 bg-[#080d19] px-4 py-2.5 text-[11px] text-slate-400">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Xanh: Tín hiệu &lt;30p · Quét &lt;20p · Heartbeat &lt;10p
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                Vàng: 30–60p · 20–45p · 10–30p
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                Đỏ: &gt;60p · &gt;45p · &gt;30p
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-slate-500" />
                Xám: Chưa có dữ liệu / Chờ dữ liệu
              </span>
            </div>
            <span className="inline-flex items-center gap-1.5 text-emerald-300/90">
              <ShieldCheck className="h-3.5 w-3.5" />
              Chỉ đọc · Không đặt lệnh · Không gửi Telegram
            </span>
          </section>
        </>
      )}
    </div>
  );
}

function FlowNodeCard({
  node,
  selected,
  onSelect,
}: {
  node: FlowNodeState;
  selected: boolean;
  onSelect: () => void;
}) {
  const style = NODE_STYLES[node.status];
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group flex w-full flex-col justify-between rounded-lg border p-3.5 text-left transition ${style.card} ${
        selected ? "ring-2 ring-cyan-400/70" : ""
      }`}
    >
      <div>
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="font-mono text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              NÚT 0{node.order}
            </span>
            <h3 className="text-sm font-bold text-slate-100 leading-tight">
              {node.name}
            </h3>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${style.badge}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
            {node.statusLabel}
          </span>
        </div>

        {/* Activity timestamp */}
        <div className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-slate-300 tabular-nums">
          {node.status === "grey_waiting" ? (
            <PauseCircle className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          ) : (
            <Activity className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
          )}
          <span className="truncate">{node.activityText}</span>
        </div>

        {/* Explicit red stuck alert (§4) */}
        {node.stuckMessage && (
          <div className="mt-2 rounded border border-rose-500/50 bg-rose-950/60 px-2.5 py-1.5 font-mono text-[11px] font-semibold text-rose-200">
            {node.stuckMessage}
          </div>
        )}

        {/* 1-2 input/output metrics */}
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          {node.metrics.map((m) => (
            <div
              key={m.label}
              className="rounded border border-slate-800/80 bg-slate-950/60 px-2 py-1.5"
            >
              <p className="font-mono text-[10px] text-slate-400 truncate">
                {m.label}
              </p>
              <p className="mt-0.5 font-mono text-xs font-semibold text-slate-100 truncate tabular-nums">
                {m.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Footer hint / run kind */}
      <div className="mt-2.5 border-t border-slate-800/70 pt-2">
        {node.errorOrHint ? (
          <p className="text-[11px] leading-snug text-amber-300/90">
            {node.errorOrHint}
          </p>
        ) : node.runKindNote ? (
          <p className="text-[11px] leading-snug text-slate-400">
            {node.runKindNote}
          </p>
        ) : (
          <p className="text-[11px] leading-snug text-slate-500">
            {node.shortRole} · Bấm xem 5 dòng gần nhất
          </p>
        )}
      </div>
    </button>
  );
}

function FlowConnectorHorizontal({ status }: { status: FlowNodeStatus }) {
  const strokeColor =
    status === "green"
      ? "#34d399"
      : status === "yellow"
        ? "#fbbf24"
        : status === "red"
          ? "#fb7185"
          : "#475569";

  return (
    <div
      className="flex items-center justify-center px-0.5"
      aria-hidden="true"
    >
      <div className="flex items-center">
        <svg width="26" height="14" viewBox="0 0 26 14" fill="none">
          <line
            x1="0"
            y1="7"
            x2="20"
            y2="7"
            stroke={strokeColor}
            strokeWidth="2"
            className={status === "green" ? "animate-flow-dash" : ""}
            strokeDasharray={status === "green" ? undefined : "4 4"}
          />
        </svg>
        <ArrowRight className="-ml-1.5 h-4 w-4" style={{ color: strokeColor }} />
      </div>
    </div>
  );
}
