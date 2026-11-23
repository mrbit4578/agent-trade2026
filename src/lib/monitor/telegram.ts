import { formatUtc, formatVn } from "./time";
import type { AuditItem, MonitorReport } from "./types";

export function formatMissingAlertMessage(
  report: Pick<
    MonitorReport,
    "mode" | "windowLabel" | "capturedAtUtc" | "capturedAtVn" | "counts"
  >,
  confirmedMissing: AuditItem[],
): string {
  const header =
    confirmedMissing.length > 0
      ? `🚨 [TRADE.2026 MONITOR] PHÁT HIỆN ${confirmedMissing.length} TÍN HIỆU MẤT (ĐÃ XÁC MINH 2 NGUỒN)`
      : `✅ [TRADE.2026 MONITOR] BÁO CÁO GIÁM SÁT — 0 TÍN HIỆU MẤT`;

  const lines: string[] = [
    header,
    `• Chế độ: ${report.mode.toUpperCase()}`,
    `• Cửa sổ: ${report.windowLabel}`,
    `• Chụp lúc: ${report.capturedAtUtc} | ${report.capturedAtVn}`,
    `• Tổng kết: Kỳ vọng ${report.counts.qualifiedExpected} | ĐỦ ${report.counts.du} | MUỘN ${report.counts.muon} | MẤT ${report.counts.matConfirmed} | CẦN KIỂM TRA ${report.counts.canKiemTra} | CẢNH BÁO GIẢ ${report.counts.canhBaoGia}`,
  ];

  if (confirmedMissing.length > 0) {
    lines.push("", "Danh sách MẤT (xác minh 2 nguồn độc lập):");
    for (const item of confirmedMissing) {
      const s = item.signal;
      lines.push(
        `— ${s.id} | ${s.coin} ${s.side.toUpperCase()} | Điểm: ${s.diem} | Phase: ${s.phase} | Loại: ${s.loai ?? "chưa có dữ liệu"}`,
        `  ts_vao: ${formatUtc(s.ts_vao)} (${formatVn(s.ts_vao)})`,
        `  Bằng chứng: ${item.explanation}`,
      );
    }
  }

  lines.push(
    "",
    "🛡️ Quy tắc v1: Chỉ giám sát & báo cáo. Không gửi lại tín hiệu, không đặt lệnh, không sửa bảng signals.",
  );

  return lines.join("\n");
}

export function getTelegramConfig(): { token: string; chatId: string } | null {
  const token =
    process.env.TELEGRAM_BOT_TOKEN?.trim() ||
    process.env.BOT_TOKEN_TRADEMRBIT?.trim() ||
    "";
  const chatId =
    process.env.TELEGRAM_CHAT_ID?.trim() ||
    process.env.SIGNAL_CHAT_ID?.trim() ||
    process.env.CHAT_ID?.trim() ||
    "";
  if (!token || !chatId) return null;
  return { token, chatId };
}

export async function sendTelegramAlert(text: string): Promise<{
  ok: boolean;
  messageId: string | null;
  error?: string;
}> {
  const tg = getTelegramConfig();
  if (!tg) {
    return {
      ok: false,
      messageId: null,
      error:
        "Thiếu BOT_TOKEN_TRADEMRBIT/TELEGRAM_BOT_TOKEN hoặc SIGNAL_CHAT_ID/TELEGRAM_CHAT_ID trong biến môi trường",
    };
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${tg.token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: tg.chatId,
          text,
          disable_web_page_preview: true,
        }),
      },
    );

    const data = (await res.json()) as {
      ok?: boolean;
      result?: { message_id?: number };
      description?: string;
    };

    if (!res.ok || !data.ok) {
      return {
        ok: false,
        messageId: null,
        error: data.description || `Telegram HTTP ${res.status}`,
      };
    }

    return {
      ok: true,
      messageId: data.result?.message_id ? String(data.result.message_id) : null,
    };
  } catch (err) {
    return {
      ok: false,
      messageId: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
