import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trade.2026 · Signal Monitor Live Agent",
  description:
    "Agent giám sát luồng tín hiệu Trade.2026 đầu-cuối (Soát · Dò · Chốt · Điều phối) — chỉ đọc, xác minh 2 nguồn độc lập, chạy live trên Vercel.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className="dark">
      <body className="min-h-screen bg-[#060a13] text-slate-200 antialiased selection:bg-cyan-500/30 selection:text-cyan-100">
        {children}
      </body>
    </html>
  );
}
