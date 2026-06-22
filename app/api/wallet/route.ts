import { NextRequest, NextResponse } from "next/server";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { privateKeyToAccount } from "viem/accounts";
import { jsonSafe, normalizePrivateKey, safeError } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { privateKey } = await request.json();
    const key = normalizePrivateKey(String(privateKey ?? ""));
    const account = privateKeyToAccount(key);
    const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: key });
    const balances = jsonSafe(await gateway.getBalances());
    return NextResponse.json({ address: account.address, balances });
  } catch (error) {
    return NextResponse.json({ error: safeError(error) }, { status: 400 });
  }
}
