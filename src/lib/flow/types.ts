import type { DeliveryReceipt, MonitorReport, SignalRow } from "@/lib/monitor/types";

export type FlowNodeId =
  | "collector"
  | "soat"
  | "do"
  | "chot"
  | "dieu_phoi"
  | "telegram";

export type FlowNodeStatus =
  | "green"
  | "quiet"
  | "yellow"
  | "red"
  | "grey_no_data"
  | "grey_waiting";

export interface FlowMetric {
  label: string;
  value: string | number;
}

export interface FlowDetailRow {
  id: string;
  title: string;
  subtitle: string;
  timestampVn: string;
  badge?: string;
  badgeTone?: "emerald" | "amber" | "rose" | "slate" | "cyan";
}

export interface FlowNodeState {
  id: FlowNodeId;
  order: number;
  name: string;
  shortRole: string;
  status: FlowNodeStatus;
  statusLabel: string;
  lastActivityAtUtc: string | null;
  lastActivityHmVn: string | null;
  ageMinutes: number | null;
  activityText: string;
  metrics: FlowMetric[];
  infoNote?: string | null;
  errorOrHint: string | null;
  stuckMessage: string | null;
  possibleCause: string | null;
  runKindNote?: string | null;
  detailsTitle: string;
  details: FlowDetailRow[];
}

export interface FlowBannerState {
  level: "green" | "yellow" | "red" | "grey";
  headline: string;
  subline: string;
  stuckNodeId: FlowNodeId | null;
}

export interface MonitorAlertRow {
  signal_id: string;
  verdict: string;
  alerted_at: string;
  telegram_message_id: string | null;
}

export interface CollectorHeartbeatInfo {
  available: boolean;
  updatedAtUtc: string | null;
  banGhi: number | null;
  source: string;
  note: string;
}

export interface SenderHeartbeatInfo {
  available: boolean;
  updatedAtUtc: string | null;
  lastRunAtUtc: string | null;
  guiDuoc: number | null;
  sentIdsCount: number | null;
  failedCount: number | null;
  source: string;
  note: string;
}

export interface FlowStationHeartbeatInfo {
  available: boolean;
  updatedAtUtc: string | null;
  note: string;
}

export interface FlowRawSnapshot {
  nowIso: string;
  mode: "live" | "demo";
  report: MonitorReport;
  recentSignals: SignalRow[];
  recentReceipts: DeliveryReceipt[];
  recentAlerts: MonitorAlertRow[];
  receiptsAvailable: boolean;
  alertsAvailable: boolean;
  collectorHeartbeat: CollectorHeartbeatInfo;
  senderHeartbeat: SenderHeartbeatInfo;
  flowHeartbeat?: FlowStationHeartbeatInfo;
  recentRuns: Array<{
    runId: string;
    mode: "live" | "demo";
    capturedAtIso: string;
    capturedAtVn: string;
    triggerKind: "manual" | "scheduled" | "auto_init";
    qualifiedExpected: number;
    du: number;
    muon: number;
    matConfirmed: number;
    canKiemTra: number;
    canhBaoGia: number;
    telegramSent: boolean;
  }>;
}

export interface FlowPayload {
  ok: true;
  mode: "live" | "demo";
  fetchedAtUtc: string;
  fetchedAtHmsVn: string;
  banner: FlowBannerState;
  scheduleSummary: {
    lastManualRunVn: string | null;
    lastScheduledRunVn: string | null;
    note: string;
  };
  nodes: FlowNodeState[];
}
