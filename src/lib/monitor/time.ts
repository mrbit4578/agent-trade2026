export function formatUtc(date: Date | string | null | undefined): string {
  if (!date) return "chưa có dữ liệu";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "chưa có dữ liệu";
  return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

export function formatVn(date: Date | string | null | undefined): string {
  if (!date) return "chưa có dữ liệu";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "chưa có dữ liệu";
  const vnMs = d.getTime() + 7 * 60 * 60 * 1000;
  const vn = new Date(vnMs);
  return vn.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " VN (UTC+7)");
}

export function diffMinutes(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): number | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round(((end - start) / 60000) * 10) / 10;
}
