import { privateKeyToAccount } from "viem/accounts";

export const AURAGATE_URL = (process.env.AURAGATE_URL ?? "https://auragate.app").replace(/\/$/, "");
export const ARC_RPC_URL = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
export const ARC_EXPLORER = "https://testnet.arcscan.app";
export const ARC_CHAIN_ID = 5_042_002;

export function normalizePrivateKey(input: string): `0x${string}` {
  const value = input.trim();
  const key = (value.startsWith("0x") ? value : `0x${value}`) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("Private key phải gồm đúng 64 ký tự hex.");
  // Deriving the account validates that the scalar is usable.
  privateKeyToAccount(key);
  return key;
}

export function safeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/0x[0-9a-fA-F]{64}/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/gsk_[A-Za-z0-9_-]+/g, "[REDACTED_GROQ_KEY]")
    .slice(0, 900);
}

export function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item));
}

export function sampleBody(serviceId: string): Record<string, string> {
  return {
    text:
      serviceId === "summarize"
        ? "AuraGate lets autonomous agents discover APIs, pay per request in USDC with x402, and receive verifiable on-chain receipts on Arc."
        : "Fetch a concise, useful result for this live agent run.",
  };
}
