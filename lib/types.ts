export type Service = {
  id: string;
  name: string;
  description: string;
  category: string;
  seller: string;
  sellerAddress: string;
  method: "GET" | "POST";
  url: string;
  verified: boolean;
  price: { amount: string; currency: "USDC"; atomic: string };
};

export type Catalog = {
  name: string;
  payment: { mode: string; facilitator: string; instructions: string };
  network: { name: string; chainId: number; explorer: string };
  services: Service[];
};

export type AgentState = {
  id: number;
  name: string;
  role: string;
  glyph: string;
  color: string;
  privateKey: string;
  groqKey: string;
  query: string;
  address: string;
  walletBalance: string;
  gatewayBalance: string;
  selected: string[];
  status: "idle" | "checking" | "ready" | "running" | "done" | "error";
  spent: number;
  calls: number;
};

export type StreamEvent = {
  type: string;
  at: string;
  agentId?: number;
  message?: string;
  [key: string]: unknown;
};
