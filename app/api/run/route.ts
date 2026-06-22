import { NextRequest } from "next/server";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import Groq from "groq-sdk";
import { privateKeyToAccount } from "viem/accounts";
import type { Catalog, Service } from "@/lib/types";
import {
  ARC_EXPLORER,
  AURAGATE_URL,
  jsonSafe,
  normalizePrivateKey,
  safeError,
  sampleBody,
} from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RunInput = {
  agentId: number;
  agentName: string;
  privateKey: string;
  groqKey?: string;
  serviceIds: string[];
  autoDeposit?: boolean;
};

type Receipt = {
  id: string;
  serviceSlug: string;
  payer: string;
  amount: string;
  resultHash: string;
  onchainTx?: string;
  createdAt: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function findReceipt(serviceId: string, payer: string, transaction: string): Promise<Receipt | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt) await sleep(650);
    try {
      const response = await fetch(`${AURAGATE_URL}/api/receipts`, { cache: "no-store" });
      const payload = await response.json();
      const receipts = (payload.receipts ?? []) as Receipt[];
      const match = receipts.find((receipt) =>
        receipt.serviceSlug === serviceId &&
        receipt.payer.toLowerCase() === payer.toLowerCase() &&
        (receipt.onchainTx === transaction || Date.now() - Date.parse(receipt.createdAt) < 120_000)
      );
      if (match) return match;
    } catch {
      // The settlement itself succeeded; receipt lookup is best-effort only.
    }
  }
  return null;
}

function requestOptions(service: Service) {
  if (service.method === "POST") {
    return {
      method: "POST" as const,
      body: sampleBody(service.id),
      headers: { "content-type": "application/json" },
    };
  }
  return { method: "GET" as const };
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`));
      };

      try {
        const input = (await request.json()) as RunInput;
        if (!Number.isInteger(input.agentId) || input.agentId < 1 || input.agentId > 9_999) {
          throw new Error("Agent không hợp lệ.");
        }
        if (!Array.isArray(input.serviceIds) || input.serviceIds.length < 1 || input.serviceIds.length > 6) {
          throw new Error("Chọn từ 1 đến 6 API cho mỗi lượt chạy.");
        }

        const key = normalizePrivateKey(input.privateKey);
        const account = privateKeyToAccount(key);
        emit({ type: "start", agentId: input.agentId, address: account.address, message: "Khoá hợp lệ; private key chỉ tồn tại trong request này." });

        const catalogResponse = await fetch(`${AURAGATE_URL}/api/agent`, { cache: "no-store" });
        if (!catalogResponse.ok) throw new Error(`Không đọc được catalog AuraGate (${catalogResponse.status}).`);
        const catalog = (await catalogResponse.json()) as Catalog;
        if (catalog.payment?.mode !== "live") {
          throw new Error(`AuraGate đang ở chế độ ${catalog.payment?.mode ?? "unknown"}; đã chặn giao dịch vì đây không phải live settlement.`);
        }
        if (catalog.network?.chainId !== 5_042_002) throw new Error("Catalog không trỏ tới Arc Testnet chain 5042002.");

        const byId = new Map(catalog.services.map((service) => [service.id, service]));
        const services = [...new Set(input.serviceIds)].map((id) => byId.get(id)).filter(Boolean) as Service[];
        if (services.length !== new Set(input.serviceIds).size) throw new Error("Có API không còn tồn tại trong catalog AuraGate.");
        const required = services.reduce((sum, service) => sum + Number(service.price.amount), 0);
        if (!Number.isFinite(required) || required <= 0 || required > 0.25) {
          throw new Error("Tổng phí phải lớn hơn 0 và không vượt safety cap 0.25 USDC/lượt.");
        }
        emit({ type: "catalog", mode: catalog.payment.mode, chainId: catalog.network.chainId, serviceCount: services.length, required: required.toFixed(6), message: `Đã khoá giá ${services.length} API · tối đa ${required.toFixed(3)} USDC.` });

        // Make the unpaid calls first so the UI can show the real 402 challenges.
        for (const service of services) {
          const opts = requestOptions(service);
          const response = await fetch(service.url, {
            method: opts.method,
            headers: "headers" in opts ? opts.headers : undefined,
            body: "body" in opts ? JSON.stringify(opts.body) : undefined,
          });
          const challenge = await response.clone().json().catch(() => null);
          if (response.status !== 402) throw new Error(`${service.name} trả ${response.status}, không phải 402; đã dừng trước khi ký.`);
          const acceptance = challenge?.accepts?.[0] ?? null;
          emit({
            type: "challenge",
            serviceId: service.id,
            serviceName: service.name,
            status: response.status,
            amount: service.price.amount,
            atomicAmount: acceptance?.amount ?? service.price.atomic,
            payTo: acceptance?.payTo ?? service.sellerAddress,
            network: acceptance?.network ?? "eip155:5042002",
            message: `HTTP 402 · ${service.name} yêu cầu ${service.price.amount} USDC.`,
          });
        }

        const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: key });
        let balances = await gateway.getBalances();
        emit({ type: "balances", balances: jsonSafe(balances), message: `Ví ${balances.wallet.formatted} USDC · Gateway khả dụng ${balances.gateway.formattedAvailable} USDC.` });

        const requiredAtomic = BigInt(Math.round(required * 1_000_000));
        if (balances.gateway.available < requiredAtomic) {
          if (!input.autoDeposit) {
            throw new Error(`Gateway thiếu ${(Number(requiredAtomic - balances.gateway.available) / 1_000_000).toFixed(6)} USDC. Bật auto-deposit để nạp thật.`);
          }
          const shortfallAtomic = requiredAtomic - balances.gateway.available;
          // Add one micro-USDC to avoid decimal rounding edge cases.
          const depositAmount = ((Number(shortfallAtomic) + 1) / 1_000_000).toFixed(6);
          if (balances.wallet.balance < shortfallAtomic) {
            throw new Error(`Ví chỉ có ${balances.wallet.formatted} USDC, không đủ nạp ${depositAmount} USDC vào Gateway.`);
          }
          emit({ type: "deposit-start", amount: depositAmount, message: `Đang approve + deposit ${depositAmount} USDC vào Circle Gateway…` });
          const deposit = await gateway.deposit(depositAmount);
          emit({
            type: "deposit",
            amount: deposit.formattedAmount,
            approvalTx: deposit.approvalTxHash ?? null,
            depositTx: deposit.depositTxHash,
            approvalUrl: deposit.approvalTxHash ? `${ARC_EXPLORER}/tx/${deposit.approvalTxHash}` : null,
            depositUrl: `${ARC_EXPLORER}/tx/${deposit.depositTxHash}`,
            message: `Đã nạp ${deposit.formattedAmount} USDC vào Gateway.`,
          });
          balances = await gateway.getBalances();
        }

        const results: Array<Record<string, unknown>> = [];
        for (const service of services) {
          emit({ type: "payment-start", serviceId: service.id, serviceName: service.name, amount: service.price.amount, message: `Đang ký EIP-3009 cho ${service.name}…` });
          const paid = await gateway.pay(service.url, requestOptions(service));
          const receipt = await findReceipt(service.id, account.address, paid.transaction);
          const result = {
            serviceId: service.id,
            serviceName: service.name,
            seller: service.seller,
            sellerAddress: service.sellerAddress,
            status: paid.status,
            amount: paid.formattedAmount,
            atomicAmount: paid.amount.toString(),
            transaction: paid.transaction,
            explorerUrl: `${ARC_EXPLORER}/tx/${paid.transaction}`,
            receiptId: receipt?.id ?? null,
            resultHash: receipt?.resultHash ?? null,
            data: jsonSafe(paid.data),
          };
          results.push(result);
          emit({ type: "payment", ...result, message: `Settled ${paid.formattedAmount} USDC · nhận HTTP ${paid.status}.` });
        }

        let insight: string | null = null;
        if (input.groqKey?.trim()) {
          emit({ type: "thinking", message: "Groq đang đọc kết quả và viết bản tóm tắt cho agent…" });
          const groq = new Groq({ apiKey: input.groqKey.trim() });
          const completion = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            temperature: 0.25,
            max_tokens: 420,
            messages: [
              {
                role: "system",
                content: `Bạn là ${input.agentName || `Agent ${input.agentId}`}. Trả lời bằng tiếng Việt, súc tích, dựa đúng dữ liệu API, nêu 3 insight hữu ích và 1 hành động tiếp theo. Không bịa số liệu.`,
              },
              { role: "user", content: JSON.stringify(results).slice(0, 12000) },
            ],
          });
          insight = completion.choices[0]?.message?.content ?? null;
          emit({ type: "insight", insight, model: "llama-3.3-70b-versatile", message: "Groq đã hoàn tất bản phân tích." });
        }

        const finalBalances = await gateway.getBalances();
        emit({
          type: "complete",
          spent: results.reduce((sum, item) => sum + Number(item.amount), 0),
          calls: results.length,
          balances: jsonSafe(finalBalances),
          insight,
          message: `Hoàn tất ${results.length} giao dịch x402 thật trên Arc Testnet.`,
        });
      } catch (error) {
        emit({ type: "error", error: safeError(error), message: safeError(error) });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-content-type-options": "nosniff",
    },
  });
}
