import { NextResponse } from "next/server";
import { AURAGATE_URL, safeError } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(`${AURAGATE_URL}/api/agent`, { cache: "no-store" });
    if (!response.ok) throw new Error(`AuraGate catalog trả HTTP ${response.status}`);
    return NextResponse.json(await response.json(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: safeError(error) }, { status: 502 });
  }
}
