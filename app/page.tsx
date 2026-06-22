"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentState, Catalog, Service, StreamEvent } from "@/lib/types";
import { clearAgentVault, hasSavedVault, loadAgentVault, saveAgentVault } from "@/lib/vault";

const AGENT_SEEDS: Array<Omit<AgentState, "privateKey" | "groqKey" | "query" | "address" | "walletBalance" | "gatewayBalance" | "status" | "spent" | "calls">> = [
  { id: 1, name: "Orion", role: "Crypto markets", glyph: "O", color: "#ff9255", selected: ["oracle-check", "sentiment"] },
  { id: 2, name: "Vega", role: "Stocks · FX", glyph: "V", color: "#50d9aa", selected: ["stocks", "fx-rates"] },
  { id: 3, name: "Atlas", role: "Weather · world", glyph: "A", color: "#66a6ff", selected: ["weather", "country-info"] },
  { id: 4, name: "Lyra", role: "Research", glyph: "L", color: "#bd8bff", selected: ["wikipedia", "dictionary"] },
  { id: 5, name: "Nova", role: "Dev · DeFi", glyph: "N", color: "#f0cf65", selected: ["news-tech", "defi-tvl"] },
];

const initialAgents: AgentState[] = AGENT_SEEDS.map((agent) => ({
  ...agent,
  privateKey: "",
  groqKey: "",
  query: "",
  address: "",
  walletBalance: "—",
  gatewayBalance: "—",
  status: "idle",
  spent: 0,
  calls: 0,
}));

function short(value: string, front = 6, back = 4) {
  return value ? `${value.slice(0, front)}…${value.slice(-back)}` : "Chưa kết nối";
}

function timeLabel(iso: string) {
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso));
}

function amountOf(ids: string[], services: Service[]) {
  return ids.reduce((total, id) => total + Number(services.find((service) => service.id === id)?.price.amount ?? 0), 0);
}

export default function ConsolePage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [agents, setAgents] = useState<AgentState[]>(initialAgents);
  const [activeId, setActiveId] = useState(1);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [results, setResults] = useState<Record<number, StreamEvent[]>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [runAllConfirmOpen, setRunAllConfirmOpen] = useState(false);
  const [vaultStatus, setVaultStatus] = useState<"idle" | "loading" | "saved" | "error">("idle");

  const active = agents.find((agent) => agent.id === activeId) ?? agents[0];
  const services = catalog?.services ?? [];
  const selectedServices = active.selected.map((id) => services.find((service) => service.id === id)).filter(Boolean) as Service[];
  const projected = amountOf(active.selected, services);
  const activeEvents = events.filter((event) => event.agentId === active.id || event.agentId === undefined);
  const activeResults = results[active.id] ?? [];
  const latestInsight = [...activeResults].reverse().find((event) => event.type === "insight")?.insight as string | undefined;

  const metrics = useMemo(() => ({
    spent: agents.reduce((sum, agent) => sum + agent.spent, 0),
    calls: agents.reduce((sum, agent) => sum + agent.calls, 0),
    online: agents.filter((agent) => ["ready", "running", "done"].includes(agent.status)).length,
    running: agents.filter((agent) => agent.status === "running").length,
  }), [agents]);

  useEffect(() => {
    fetch("/api/catalog", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Không tải được catalog");
        setCatalog(payload);
        setEvents([{ type: "system", at: new Date().toISOString(), message: `Đã đồng bộ ${payload.services?.length ?? 0} API từ AuraGate.` }]);
      })
      .catch((error) => setCatalogError(error instanceof Error ? error.message : String(error)));
  }, []);

  useEffect(() => {
    if (!hasSavedVault()) return;
    setVaultStatus("loading");
    loadAgentVault()
      .then((saved) => {
        if (saved?.length) {
          setAgents(saved);
          setActiveId(saved[0].id);
          setVaultStatus("saved");
        } else {
          setVaultStatus("idle");
        }
      })
      .catch(() => setVaultStatus("error"));
  }, []);

  const updateActive = (patch: Partial<AgentState>) => {
    setAgents((current) => current.map((agent) => agent.id === active.id ? { ...agent, ...patch } : agent));
  };

  function addAgent() {
    const id = Math.max(0, ...agents.map((agent) => agent.id)) + 1;
    const palette = ["#ff9255", "#50d9aa", "#66a6ff", "#bd8bff", "#f0cf65", "#f477a8", "#62d5e8"];
    const name = `Agent ${String(id).padStart(2, "0")}`;
    const agent: AgentState = {
      id,
      name,
      role: "Custom API operator",
      glyph: String.fromCharCode(64 + ((id - 1) % 26) + 1),
      color: palette[(id - 1) % palette.length],
      privateKey: "",
      groqKey: "",
      query: "",
      address: "",
      walletBalance: "—",
      gatewayBalance: "—",
      selected: ["joke"],
      status: "idle",
      spent: 0,
      calls: 0,
    };
    setAgents((current) => [...current, agent]);
    setActiveId(id);
    setVaultStatus("idle");
  }

  function removeActiveAgent() {
    if (agents.length <= 1 || active.status === "running") return;
    const remaining = agents.filter((agent) => agent.id !== active.id);
    setAgents(remaining);
    setActiveId(remaining[0].id);
    setEvents((current) => current.filter((event) => event.agentId !== active.id));
    setResults((current) => {
      const next = { ...current };
      delete next[active.id];
      return next;
    });
    setVaultStatus("idle");
  }

  async function rememberFleet() {
    try {
      await saveAgentVault(agents);
      setVaultStatus("saved");
    } catch {
      setVaultStatus("error");
    }
  }

  function forgetFleet() {
    clearAgentVault();
    setVaultStatus("idle");
  }

  async function inspectWallet() {
    if (!active.privateKey.trim()) return;
    updateActive({ status: "checking" });
    try {
      const response = await fetch("/api/wallet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ privateKey: active.privateKey }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Không đọc được ví");
      updateActive({
        status: "ready",
        address: payload.address,
        walletBalance: payload.balances?.wallet?.formatted ?? "0",
        gatewayBalance: payload.balances?.gateway?.formattedAvailable ?? "0",
      });
      setEvents((current) => [{ type: "wallet", agentId: active.id, at: new Date().toISOString(), message: `${active.name} đã kết nối ví ${short(payload.address)}.` }, ...current]);
    } catch (error) {
      updateActive({ status: "error" });
      setEvents((current) => [{ type: "error", agentId: active.id, at: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) }, ...current]);
    }
  }

  function toggleService(id: string) {
    const has = active.selected.includes(id);
    if (!has && active.selected.length >= 6) return;
    updateActive({ selected: has ? active.selected.filter((value) => value !== id) : [...active.selected, id] });
    setVaultStatus("idle");
  }

  function handleEventForAgent(event: StreamEvent, agentId: number) {
    event.agentId = agentId;
    setEvents((current) => [event, ...current].slice(0, 200));
    if (["payment", "deposit", "insight", "complete", "error"].includes(event.type)) {
      setResults((current) => ({ ...current, [agentId]: [...(current[agentId] ?? []), event] }));
    }
    if (event.type === "payment") {
      setAgents((current) => current.map((a) => a.id === agentId
        ? { ...a, spent: a.spent + Number(event.amount ?? 0), calls: a.calls + 1 }
        : a));
    }
    if (event.type === "balances" || event.type === "complete") {
      const balances = event.balances as { wallet?: { formatted?: string }; gateway?: { formattedAvailable?: string } } | undefined;
      if (balances) setAgents((current) => current.map((a) => a.id === agentId
        ? { ...a, walletBalance: balances.wallet?.formatted ?? a.walletBalance, gatewayBalance: balances.gateway?.formattedAvailable ?? a.gatewayBalance }
        : a));
    }
    if (event.type === "complete") setAgents((current) => current.map((a) => a.id === agentId ? { ...a, status: "done" } : a));
    if (event.type === "error") setAgents((current) => current.map((a) => a.id === agentId ? { ...a, status: "error" } : a));
  }

  async function runAgentById(agent: AgentState) {
    setAgents((current) => current.map((a) => a.id === agent.id ? { ...a, status: "running", spent: 0, calls: 0 } : a));
    setResults((current) => ({ ...current, [agent.id]: [] }));
    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: agent.id,
          agentName: agent.name,
          privateKey: agent.privateKey,
          groqKey: agent.groqKey,
          query: agent.query,
          serviceIds: agent.selected,
          autoDeposit: true,
        }),
      });
      if (!response.ok || !response.body) throw new Error(`Không mở được live stream (${response.status})`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handleEventForAgent(JSON.parse(line), agent.id);
        if (done) break;
      }
      if (buffer.trim()) handleEventForAgent(JSON.parse(buffer), agent.id);
    } catch (error) {
      handleEventForAgent({ type: "error", at: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) }, agent.id);
    }
  }

  async function runAgent() {
    setConfirmOpen(false);
    await runAgentById(active);
  }

  async function runAllAgents() {
    setRunAllConfirmOpen(false);
    const runnable = agents.filter((a) => a.privateKey && a.selected.length > 0 && a.status !== "running");
    await Promise.allSettled(runnable.map((a) => runAgentById(a)));
  }

  const canRun = Boolean(active.privateKey && active.selected.length && catalog?.payment.mode === "live" && active.status !== "running");
  const canRunAll = Boolean(catalog?.payment.mode === "live" && agents.some((a) => a.privateKey && a.selected.length > 0 && a.status !== "running"));

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Agent settlement console">
          <span className="brand-mark"><i /><i /><i /></span>
          <span><b>AGENT<span>/</span>SETTLE</b><small>by AuraGate</small></span>
        </a>
        <div className="network-strip">
          <span className={`live-pill ${catalog?.payment.mode === "live" ? "ok" : ""}`}><i /> {catalog ? catalog.payment.mode.toUpperCase() : "SYNCING"}</span>
          <span>ARC TESTNET</span><em />
          <span>x402 · USDC</span>
        </div>
        <a className="ghost-link" href="https://auragate.app/receipts" target="_blank" rel="noreferrer">Receipt explorer ↗</a>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">LIVE AGENT TEST CONSOLE</p>
          <h1>Run. Pay. <i>Inspect.</i></h1>
        </div>
        <p className="hero-copy">Tạo bao nhiêu agent tuỳ ý. Mở phòng chạy để xem rõ từng bước 402, chữ ký, settlement tx, receipt và JSON trả về.</p>
      </section>

      <section className="metric-grid" aria-label="Fleet summary">
        <div><span>FLEET</span><strong>{String(agents.length).padStart(2, "0")}</strong><small>agents configured</small></div>
        <div><span>CONNECTED</span><strong>{String(metrics.online).padStart(2, "0")}</strong><small>wallets ready</small></div>
        <div><span>SETTLED</span><strong>{String(metrics.calls).padStart(2, "0")}</strong><small>paid API calls</small></div>
        <div><span>SPENT</span><strong>{metrics.spent.toFixed(3)}</strong><small>USDC · this session</small></div>
      </section>

      {catalogError && <div className="banner error-banner">Không kết nối được AuraGate: {catalogError}</div>}

      <section className="workspace">
        <aside className="fleet-panel">
          <div className="section-title"><span>AGENT FLEET</span><small>{metrics.running ? `${metrics.running} RUNNING` : `${agents.length} AGENTS`}</small></div>
          <div className="fleet-actions">
            <button onClick={addAgent}>＋ Thêm agent</button>
            <button className={vaultStatus === "saved" ? "saved" : ""} onClick={rememberFleet}>{vaultStatus === "loading" ? "Đang mở vault…" : vaultStatus === "saved" ? "✓ Đã nhớ" : "⌁ Ghi nhớ"}</button>
            <button className="fleet-run-all" disabled={!canRunAll} onClick={() => setRunAllConfirmOpen(true)}>⚡ Chạy tất cả</button>
          </div>
          <div className="agent-list">
            {agents.map((agent, index) => (
              <div key={agent.id} role="button" tabIndex={0} className={`agent-row ${agent.id === active.id ? "selected" : ""}`} onClick={() => { setActiveId(agent.id); setShowPrivateKey(false); setShowGroqKey(false); }} onKeyDown={(e) => e.key === "Enter" && setActiveId(agent.id)}>
                <span className="agent-index">0{index + 1}</span>
                <span className="agent-avatar" style={{ "--agent": agent.color } as React.CSSProperties}>{agent.glyph}<i /></span>
                <span className="agent-copy"><b>{agent.name}</b><small>{agent.role}</small><code>{short(agent.address)}</code></span>
                <span className="agent-row-end">
                  <span className={`status-dot ${agent.status}`} title={agent.status} />
                  <button className="agent-expand" onClick={(e) => { e.stopPropagation(); setActiveId(agent.id); setFocusOpen(true); }} title="Mở phòng chạy">↗</button>
                </span>
              </div>
            ))}
          </div>
          <div className="privacy-note"><span>⌁</span><p><b>Encrypted local vault</b>Chỉ lưu khi bạn bấm “Ghi nhớ”. Key được mã hoá AES-GCM bằng khoá thiết bị không thể export.<button onClick={forgetFleet}>Xoá dữ liệu đã nhớ</button></p></div>
        </aside>

        <section className="command-panel" style={{ "--agent": active.color } as React.CSSProperties}>
          <div className="command-head">
            <div className="large-avatar">{active.glyph}<span>0{active.id}</span></div>
            <div className="agent-identity"><p>ACTIVE AGENT</p><input className="agent-name-input" value={active.name} onChange={(event) => { updateActive({ name: event.target.value }); setVaultStatus("idle"); }} aria-label="Tên agent" /><input className="agent-role-input" value={active.role} onChange={(event) => { updateActive({ role: event.target.value }); setVaultStatus("idle"); }} aria-label="Vai trò agent" /></div>
            <div className="command-actions"><div className="agent-state"><i className={active.status} /><span>{active.status === "running" ? "SETTLING" : active.status.toUpperCase()}</span></div><button className="focus-button" onClick={() => setFocusOpen(true)}>Mở phòng chạy <span>↗</span></button><button className="delete-agent" onClick={removeActiveAgent} disabled={agents.length <= 1 || active.status === "running"}>Xoá</button></div>
          </div>

          <div className="config-grid">
            <div className="key-block">
              <div className="field-label"><span>01 · ARC WALLET</span><small>required</small></div>
              <label className="secret-input">
                <span>PK</span>
                <input type={showPrivateKey ? "text" : "password"} value={active.privateKey} onChange={(event) => { updateActive({ privateKey: event.target.value, status: "idle", address: "" }); setVaultStatus("idle"); }} placeholder="0x · private key Arc Testnet" autoComplete="off" spellCheck={false} />
                <button type="button" onClick={() => setShowPrivateKey((value) => !value)} aria-label="Ẩn hoặc hiện private key">{showPrivateKey ? "HIDE" : "VIEW"}</button>
              </label>
              <div className="key-actions">
                <button className="connect-button" onClick={inspectWallet} disabled={!active.privateKey || active.status === "checking"}>{active.status === "checking" ? "Đang đọc balance…" : active.address ? "Refresh wallet" : "Connect wallet"}<span>→</span></button>
                <button className="key-save-btn" onClick={rememberFleet} title="Lưu key vào vault trình duyệt">⌁ Lưu key</button>
              </div>
              <div className="wallet-stats">
                <div><span>ADDRESS</span><a href={active.address ? `https://testnet.arcscan.app/address/${active.address}` : undefined} target="_blank" rel="noreferrer">{short(active.address, 8, 6)} {active.address && "↗"}</a></div>
                <div><span>WALLET</span><b>{active.walletBalance} <small>USDC</small></b></div>
                <div><span>GATEWAY</span><b>{active.gatewayBalance} <small>USDC</small></b></div>
              </div>
            </div>

            <div className="key-block">
              <div className="field-label"><span>02 · GROQ INTELLIGENCE</span><small>optional</small></div>
              <label className="secret-input groq">
                <span>AI</span>
                <input type={showGroqKey ? "text" : "password"} value={active.groqKey} onChange={(event) => { updateActive({ groqKey: event.target.value }); setVaultStatus("idle"); }} placeholder="gsk_ · Groq API key" autoComplete="off" spellCheck={false} />
                <button type="button" onClick={() => setShowGroqKey((value) => !value)}>{showGroqKey ? "HIDE" : "VIEW"}</button>
              </label>
              <div className="model-card"><div className="model-orbit"><i /><i /></div><div><span>REASONING MODEL</span><b>Llama 3.3 70B</b><small>{active.groqKey ? "Ready to synthesize paid results" : "Key chưa nhập · agent vẫn mua API được"}</small></div></div>
              <div className="key-actions groq-save">
                <p className="micro-copy" style={{ margin: 0 }}>Chỉ kết quả API gửi tới Groq. Private key không rời payment route.</p>
                <button className="key-save-btn" onClick={rememberFleet} title="Lưu Groq key vào vault">⌁ Lưu key</button>
              </div>
            </div>
          </div>

          <div className="query-block">
            <div className="field-label"><span>03 · CÂU HỎI CHO AGENT</span><small>Groq trả lời đúng trọng tâm · tùy chọn</small></div>
            <textarea
              className="query-input"
              value={active.query}
              onChange={(e) => { updateActive({ query: e.target.value }); setVaultStatus("idle"); }}
              placeholder="VD: Giá Bitcoin hiện tại là bao nhiêu? / Tỷ giá USD/VND hôm nay? / Nhiệt độ Hà Nội ngày mai?"
              rows={2}
            />
          </div>

          <div className="mission-block">
            <div className="field-label"><span>04 · MISSION QUEUE</span><small>{active.selected.length}/6 APIs</small></div>
            <div className="mission-line">
              <div className="service-stack">
                {selectedServices.map((service, index) => (
                  <button key={service.id} onClick={() => toggleService(service.id)} title="Bỏ khỏi queue"><span>0{index + 1}</span><b>{service.name}</b><small>{service.method} · {service.price.amount} USDC</small><i>×</i></button>
                ))}
                {!selectedServices.length && <div className="empty-service">Chưa chọn API nào.</div>}
              </div>
              <button className="catalog-button" onClick={() => setPickerOpen(true)}><span>＋</span>Chọn từ AuraGate<small>{services.length} live services</small></button>
            </div>
            <div className="run-bar">
              <div className="projected"><span>MAX SETTLEMENT</span><b>{projected.toFixed(3)} <small>USDC</small></b><em>Auto-deposit phần thiếu</em></div>
              <div className="flow-preview"><span>402</span><i /><span>SIGN</span><i /><span>SETTLE</span><i /><span>DATA</span></div>
              <button className="run-button" disabled={!canRun} onClick={() => setConfirmOpen(true)}><span>{active.status === "running" ? "Agent đang chạy" : "Run live purchase"}</span><i>↗</i></button>
            </div>
          </div>
        </section>
      </section>

      <section className="lower-grid">
        <div className="activity-panel">
          <div className="section-title"><span>LIVE SETTLEMENT LOG</span><small><i className="pulse" /> STREAMING</small></div>
          <div className="log-list">
            {activeEvents.length === 0 && <div className="log-empty"><i>⌁</i><p>Đang chờ agent đầu tiên.<small>Kết nối ví rồi chạy một mission.</small></p></div>}
            {activeEvents.slice(0, 16).map((event, index) => (
              <div className={`log-row ${event.type}`} key={`${event.at}-${index}`}>
                <time>{timeLabel(event.at)}</time><span className="log-node" /><code>{event.type.toUpperCase().replace("-", " ")}</code><p>{String(event.message ?? "")}</p>
                {Boolean(event.transaction) && <a href={String(event.explorerUrl)} target="_blank" rel="noreferrer">TX ↗</a>}
                {Boolean(event.depositTx) && <a href={String(event.depositUrl)} target="_blank" rel="noreferrer">DEPOSIT ↗</a>}
              </div>
            ))}
          </div>
        </div>

        <div className="result-panel">
          <div className="section-title"><span>PAID OUTPUT</span><small>{activeResults.filter((event) => event.type === "payment").length} RESULTS</small></div>
          <div className="result-body">
            {latestInsight && <div className="insight-card"><span>GROQ SYNTHESIS</span><p>{latestInsight}</p></div>}
            {activeResults.filter((event) => event.type === "payment").map((event, index) => (
              <article className="result-card" key={`${event.transaction}-${index}`}>
                <header><span>0{index + 1}</span><div><b>{String(event.serviceName)}</b><small>HTTP {String(event.status)} · {String(event.amount)} USDC</small></div><a href={String(event.explorerUrl)} target="_blank" rel="noreferrer">ARC ↗</a></header>
                <div className="proof-grid"><div><span>SETTLEMENT TX</span><code>{short(String(event.transaction), 10, 8)}</code></div><div><span>RECEIPT</span><code>{event.receiptId ? short(String(event.receiptId), 9, 6) : "indexing…"}</code></div><div><span>RESULT HASH</span><code>{event.resultHash ? short(String(event.resultHash), 10, 8) : "indexing…"}</code></div></div>
                <details><summary>View paid JSON result <span>＋</span></summary><pre>{JSON.stringify(event.data, null, 2)}</pre></details>
              </article>
            ))}
            {!activeResults.some((event) => event.type === "payment") && <div className="output-empty"><div className="scan-lines" /><span>NO PAID OUTPUT — YET</span><p>Settled API data, tx hash và receipt sẽ xuất hiện ở đây.</p></div>}
          </div>
        </div>
      </section>

      <footer><span>AGENT/SETTLE · LIVE PROOF OF WORK</span><p>Arc Testnet · USDC · Circle Gateway · x402</p><a href="https://github.com/mrcocdilinh/AuraGate" target="_blank" rel="noreferrer">SOURCE ↗</a></footer>

      {focusOpen && (
        <div className="focus-room" style={{ "--agent": active.color } as React.CSSProperties}>
          <header className="focus-header">
            <div className="focus-agent"><span className="large-avatar">{active.glyph}<i>#{active.id}</i></span><div><p>LIVE RUN ROOM</p><h2>{active.name}</h2><small>{active.role}</small></div></div>
            <div className="focus-wallet"><span>WALLET</span><code>{active.address || "Chưa kết nối"}</code><small>{active.gatewayBalance} USDC available on Gateway</small></div>
            <div className="focus-header-actions"><button className="focus-run" disabled={!canRun} onClick={() => setConfirmOpen(true)}>{active.status === "running" ? "Đang settlement…" : `Chạy ${selectedServices.length} API · ${projected.toFixed(3)} USDC`} <span>→</span></button><button className="focus-close" onClick={() => setFocusOpen(false)} aria-label="Đóng phòng chạy">×</button></div>
          </header>

          <div className="focus-stagebar">
            {[
              ["01", "PREFLIGHT", ["start", "catalog"]],
              ["02", "402 CHALLENGE", ["challenge"]],
              ["03", "SIGN & SETTLE", ["payment-start", "payment"]],
              ["04", "PAID DATA", ["complete"]],
            ].map(([number, label, types], index) => {
              const list = types as string[];
              const done = activeEvents.some((event) => list.includes(event.type));
              const running = active.status === "running" && !done && (index === 0 || activeEvents.some((event) => (types as string[]).includes(event.type)));
              return <div className={`${done ? "done" : ""} ${running ? "running" : ""}`} key={String(label)}><span>{String(number)}</span><b>{String(label)}</b><i /></div>;
            })}
          </div>

          <div className="focus-content">
            <section className="focus-process">
              <div className="focus-section-title"><div><span>PROCESS</span><h3>Quá trình chạy</h3></div><small><i className="pulse" /> REAL-TIME</small></div>
              <div className="focus-service-list">
                {selectedServices.map((service, index) => <div key={service.id}><span>{String(index + 1).padStart(2, "0")}</span><p><b>{service.name}</b><small>{service.method} · seller {short(service.sellerAddress)}</small></p><strong>{service.price.amount} <small>USDC</small></strong></div>)}
              </div>
              <div className="focus-log">
                {[...activeEvents].reverse().slice(-30).map((event, index) => <div className={event.type} key={`${event.at}-${index}`}><time>{timeLabel(event.at)}</time><i /><span>{event.type.toUpperCase().replace("-", " ")}</span><p>{String(event.message ?? "")}</p></div>)}
                {!activeEvents.length && <p className="focus-empty">Nhấn “Chạy” để bắt đầu. Console sẽ hiện từng bước thật tại đây.</p>}
              </div>
            </section>

            <section className="focus-proof">
              <div className="focus-section-title"><div><span>PROOF & OUTPUT</span><h3>Giao dịch và kết quả</h3></div><small>{activeResults.filter((event) => event.type === "payment").length} SETTLED</small></div>

              {activeResults.filter((event) => event.type === "deposit").map((event, index) => <article className="focus-deposit" key={`deposit-${index}`}><header><span>GATEWAY FUNDING</span><b>Deposit {String(event.amount)} USDC</b></header><div><span>APPROVAL TX</span><code>{String(event.approvalTx ?? "Không cần approve mới")}</code>{Boolean(event.approvalUrl) && <a href={String(event.approvalUrl)} target="_blank" rel="noreferrer">Xem trên Arcscan ↗</a>}</div><div><span>DEPOSIT TX</span><code>{String(event.depositTx)}</code><a href={String(event.depositUrl)} target="_blank" rel="noreferrer">Xem trên Arcscan ↗</a></div></article>)}

              {activeResults.filter((event) => event.type === "payment").map((event, index) => (
                <article className="focus-transaction" key={`${event.transaction}-${index}`}>
                  <header><span>TX {String(index + 1).padStart(2, "0")}</span><div><h4>{String(event.serviceName)}</h4><p>HTTP {String(event.status)} · paid {String(event.amount)} USDC</p></div><a href={String(event.explorerUrl)} target="_blank" rel="noreferrer">ARC EXPLORER ↗</a></header>
                  <dl><div><dt>SETTLEMENT TRANSACTION</dt><dd><code>{String(event.transaction)}</code></dd></div><div><dt>SELLER</dt><dd><code>{String(event.sellerAddress)}</code></dd></div><div><dt>AURAGATE RECEIPT</dt><dd><code>{String(event.receiptId ?? "Đang indexing")}</code></dd></div><div><dt>RESULT HASH</dt><dd><code>{String(event.resultHash ?? "Đang indexing")}</code></dd></div></dl>
                  <div className="focus-json"><span>PAID JSON RESPONSE</span><pre>{JSON.stringify(event.data, null, 2)}</pre></div>
                </article>
              ))}

              {latestInsight && <article className="focus-insight"><span>GROQ · LLAMA 3.3 70B</span><h4>Agent synthesis</h4><p>{latestInsight}</p></article>}
              {!activeResults.some((event) => event.type === "payment") && <div className="focus-no-results"><span>⌁</span><h4>Chưa có kết quả trả phí</h4><p>Transaction hash, receipt và JSON sẽ xuất hiện đầy đủ ở đây sau settlement.</p></div>}
            </section>
          </div>
        </div>
      )}

      {pickerOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPickerOpen(false)}>
          <section className="modal catalog-modal">
            <header><div><span>AURAGATE CATALOG</span><h3>Chọn API cho {active.name}</h3><p>Toàn bộ giá được đọc trực tiếp từ live registry.</p></div><button onClick={() => setPickerOpen(false)}>×</button></header>
            <div className="catalog-list">
              {services.map((service) => {
                const checked = active.selected.includes(service.id);
                return <button key={service.id} className={checked ? "checked" : ""} onClick={() => toggleService(service.id)} disabled={!checked && active.selected.length >= 6}>
                  <span className="check">{checked ? "✓" : ""}</span><div><b>{service.name}</b><p>{service.description}</p><small>{service.category} · {service.method} · by {service.seller}</small></div><strong>{service.price.amount}<small>USDC</small></strong>
                </button>;
              })}
            </div>
            <footer><span>{active.selected.length} API · tối đa {projected.toFixed(3)} USDC</span><button onClick={() => setPickerOpen(false)}>Xong →</button></footer>
          </section>
        </div>
      )}

      {runAllConfirmOpen && (
        <div className="modal-backdrop">
          <section className="modal confirm-modal">
            <span className="warning-mark">!</span>
            <p className="eyebrow">BATCH SETTLEMENT</p>
            <h3>Chạy đồng loạt {agents.filter((a) => a.privateKey && a.selected.length > 0 && a.status !== "running").length} agent</h3>
            <p>Tất cả agent đã có ví sẽ ký giao dịch x402 thật <b>cùng lúc</b> trên Arc Testnet. Agent nào thiếu tiền sẽ auto-deposit.</p>
            <div className="confirm-total">
              <span>TỔNG CHI TỐI ĐA</span>
              <strong>{agents.filter((a) => a.privateKey && a.selected.length > 0).reduce((sum, a) => sum + amountOf(a.selected, services), 0).toFixed(3)} <small>USDC</small></strong>
              <small>Cộng gộp toàn bộ agent</small>
            </div>
            <div className="confirm-actions"><button onClick={() => setRunAllConfirmOpen(false)}>Huỷ</button><button className="danger" onClick={runAllAgents}>Xác nhận chạy tất cả →</button></div>
          </section>
        </div>
      )}

      {confirmOpen && (
        <div className="modal-backdrop">
          <section className="modal confirm-modal">
            <span className="warning-mark">!</span>
            <p className="eyebrow">IRREVERSIBLE TESTNET ACTION</p>
            <h3>Xác nhận giao dịch thật</h3>
            <p>Agent <b>{active.name}</b> sẽ ký {selectedServices.length} thanh toán x402 bằng ví <code>{short(active.address || "private-key wallet")}</code>. Nếu Gateway thiếu tiền, app sẽ approve và deposit phần thiếu.</p>
            <div className="confirm-total"><span>CHI TỐI ĐA</span><strong>{projected.toFixed(3)} USDC</strong><small>Arc Testnet · không mô phỏng</small></div>
            <div className="confirm-actions"><button onClick={() => setConfirmOpen(false)}>Huỷ</button><button className="danger" onClick={runAgent}>Xác nhận & chạy thật →</button></div>
          </section>
        </div>
      )}
    </main>
  );
}
