import { NextResponse } from "next/server";
import { runAcceptanceSuite } from "@/lib/monitor/acceptance";

export const dynamic = "force-dynamic";

export async function GET() {
  const suite = await runAcceptanceSuite();
  return NextResponse.json({ ok: true, ...suite });
}
