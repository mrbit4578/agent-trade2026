export interface SignalRow {
  id: string;
  coin: string;
  side: string;
  loai: string | null;
  diem: number;
  gia_vao: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  rr: number | null;
  phase: string;
  trang_thai: string | null;
  ket_qua: string | null;
  ts_vao: string | null;
  ts_dong: string | null;
  phien: string | null;
  bias_4h: string | null;
  cau_truc: string | null;
  nguon: string | null;
  created_at: string | null;
}

export type ReceiptStatus = "sent" | "duplicate" | "failed";

export interface DeliveryReceipt {
  signal_id: string;
  sent_at: string | null;
  relay_response: Record<string, unknown> | null;
  telegram_message_id: string | null;
  checked_at: string;
  status: ReceiptStatus;
}

export interface SenderHeartbeat {
  source: string;
  available: boolean;
  checkedAtUtc: string;
  lastRunAtUtc: string | null;
  sentIds: string[];
  note: string;
}

export interface DataSourceStatus {
  name: string;
  available: boolean;
  recordCount: number | null;
  capturedAtUtc: string;
  note: string;
}

export type ReconcileStatus = "DU" | "MUON" | "THIEU";
export type FinalVerdict =
  | "DU"
  | "MUON"
  | "MAT"
  | "CAN_KIEM_TRA"
  | "CANH_BAO_GIA";

export interface EvidenceRecord {
  source: "delivery_receipts" | "telegram_sender_heartbeat";
  available: boolean;
  delivered: boolean | null;
  detail: string;
  capturedAtUtc: string;
}

export interface AuditItem {
  signal: SignalRow;
  receipt: DeliveryReceipt | null;
  inHeartbeat: boolean | null;
  reconcileStatus: ReconcileStatus;
  verdict: FinalVerdict;
  latencyMinutes: number | null;
  evidence: EvidenceRecord[];
  explanation: string;
  alerted: boolean;
  alertDedupeSkipped: boolean;
}

export type AgentCode = "SOAT" | "DO" | "CHOT" | "DIEU_PHOI";

export interface AgentStageTrace {
  agent: AgentCode;
  roleTitle: string;
  responsibility: string;
  startedAtUtc: string;
  finishedAtUtc: string;
  durationMs: number;
  summary: string;
  metrics: Record<string, number | string>;
}

export interface TelegramDispatchSummary {
  attempted: boolean;
  sent: boolean;
  mode: "live" | "dry_run" | "skipped_no_missing" | "skipped_dedupe" | "skipped_no_config";
  newlyAlertedIds: string[];
  dedupedIds: string[];
  messagePreview: string;
  error?: string;
}

export type MonitorMode = "live" | "demo";
export type DemoScenarioId = "live-24h-sim" | "acceptance-2026-11-10" | "clean-day";

export interface MonitorRunOptions {
  mode?: "auto" | MonitorMode;
  scenario?: DemoScenarioId;
  windowHours?: number;
  fromUtc?: string;
  toUtc?: string;
  sendTelegram?: boolean;
  includeDailyDigest?: boolean;
}

export interface MonitorReport {
  runId: string;
  mode: MonitorMode;
  scenario?: DemoScenarioId;
  windowLabel: string;
  windowFromUtc: string;
  windowToUtc: string;
  capturedAtUtc: string;
  capturedAtVn: string;
  sources: {
    signals: DataSourceStatus;
    receipts: DataSourceStatus;
    heartbeat: DataSourceStatus;
  };
  counts: {
    rawSignalsScanned: number;
    qualifiedExpected: number;
    ignoredNonAlertReady: number;
    ignoredLowScore: number;
    du: number;
    muon: number;
    thieuRaw: number;
    matConfirmed: number;
    canKiemTra: number;
    canhBaoGia: number;
  };
  items: AuditItem[];
  stages: AgentStageTrace[];
  telegram: TelegramDispatchSummary;
  safetyAttestation: {
    readOnlyOnSignals: true;
    noOrderPlacement: true;
    noSignalResend: true;
    noSecretsInCode: true;
    twoSourceVerificationEnforced: true;
  };
}
