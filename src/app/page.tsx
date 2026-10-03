"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { displayVerdict, isDecision, isRecord, type Decision, type Verdict } from "../lib/decision";
import { decisionInput, purposeOptions, scenarios, type Purpose, type ScenarioId } from "../lib/demo";
import DecisionReceipt from "./decision-receipt";

const verdictCopy: Record<Verdict, string> = {
  AUTO_ADAPT: "Resolved automatically", ASK: "Customer decision needed",
  HOLD: "Waiting for verification", BLOCK: "Hard constraint violated",
};
type Phase = "idle" | "meeting" | "switching" | "lunch" | "complete" | "error";
const emptyComparison = () => ({ delay: {}, trays: {} } as Record<"delay" | "trays", Partial<Record<Purpose, Verdict>>>);

export default function Home() {
  const [mode, setMode] = useState<"guided" | "explore">("guided");
  const [phase, setPhase] = useState<Phase>("idle");
  const [purpose, setPurpose] = useState<Purpose>("Client meeting");
  const [scenarioId, setScenarioId] = useState<ScenarioId>("delay");
  const [result, setResult] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [slow, setSlow] = useState(false);
  const [avoided, setAvoided] = useState(0);
  const [comparison, setComparison] = useState(emptyComparison);
  const activeRequest = useRef<AbortController | null>(null);
  const countedAdaptations = useRef(new Set<string>());
  const scenario = scenarios.find((item) => item.id === scenarioId)!;
  const pair = purposeOptions(scenarioId);
  const liveComparison = scenarioId === "trays" ? comparison.trays : comparison.delay;
  const complete = pair.every((item) => !!liveComparison[item]);

  useEffect(() => () => activeRequest.current?.abort(), []);

  function clearDecision() {
    activeRequest.current?.abort(); activeRequest.current = null;
    setLoading(false); setBusy(false); setSlow(false); setResult(null); setError("");
  }
  function reset() {
    clearDecision(); setPhase("idle"); setPurpose("Client meeting"); setScenarioId("delay");
    setComparison(emptyComparison()); setAvoided(0); countedAdaptations.current.clear();
  }
  function switchMode(next: "guided" | "explore") {
    reset(); setMode(next);
  }
  function wait(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException("Canceled", "AbortError")); return; }
      const abort = () => { window.clearTimeout(timer); reject(new DOMException("Canceled", "AbortError")); };
      const timer = window.setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
  async function evaluate(selectedPurpose: Purpose, selectedScenario: ScenarioId, controller: AbortController) {
    setPurpose(selectedPurpose); setScenarioId(selectedScenario); setResult(null); setError(""); setLoading(true); setSlow(false);
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 40_000);
    const slowTimer = window.setTimeout(() => { if (activeRequest.current === controller) setSlow(true); }, 8_000);
    try {
      const response = await fetch("/api/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(decisionInput(selectedPurpose, selectedScenario)), signal: controller.signal });
      let data: unknown;
      try { data = await response.json(); } catch { throw new Error("The service returned an unreadable response. Please retry."); }
      if (!response.ok) {
        const code = isRecord(data) ? data.code : undefined;
        throw new Error(code === "RATE_LIMITED" ? "The live service is busy. Wait a moment and retry." : code === "TIMEOUT" ? "The live decision took too long. Please retry." : "The live decision service is temporarily unavailable. Please retry.");
      }
      if (!isDecision(data)) throw new Error("The service returned an incomplete decision. Please retry.");
      if (activeRequest.current !== controller || controller.signal.aborted) throw new DOMException("Canceled", "AbortError");
      setResult(data);
      const key = `${selectedPurpose}:${selectedScenario}`;
      if (data.verdict === "AUTO_ADAPT" && !countedAdaptations.current.has(key)) { countedAdaptations.current.add(key); setAvoided((count) => count + 1); }
      if (selectedScenario === "delay" || selectedScenario === "trays") setComparison((previous) => ({ ...previous, [selectedScenario]: { ...previous[selectedScenario], [selectedPurpose]: data.verdict } }));
    } catch (failure) {
      if (timedOut) throw new Error("The live decision took too long. Please retry.");
      throw failure;
    } finally {
      window.clearTimeout(timeout); window.clearTimeout(slowTimer);
      if (activeRequest.current === controller) { setLoading(false); setSlow(false); }
    }
  }
  async function run(guided: boolean) {
    if (activeRequest.current) return;
    if (guided) reset();
    const controller = new AbortController(); activeRequest.current = controller; setBusy(true);
    try {
      if (guided) {
        setPhase("meeting"); const firstStart = Date.now();
        await evaluate("Client meeting", "delay", controller);
        await wait(Math.max(0, 14_000 - (Date.now() - firstStart)), controller.signal);
        setPhase("switching"); setPurpose("Casual team lunch"); setResult(null);
        await wait(2_000, controller.signal);
        setPhase("lunch"); const secondStart = Date.now();
        await evaluate("Casual team lunch", "delay", controller);
        await wait(Math.max(0, 14_000 - (Date.now() - secondStart)), controller.signal);
        setPhase("complete");
      } else await evaluate(purpose, scenarioId, controller);
    } catch (failure) {
      if (activeRequest.current === controller) {
        setResult(null);
        setError(failure instanceof Error && failure.name !== "TypeError" ? failure.message : "We couldn’t reach the live service. Check your connection and retry.");
        if (guided) setPhase("error");
      }
    } finally {
      if (activeRequest.current === controller) { activeRequest.current = null; setBusy(false); setLoading(false); setSlow(false); }
    }
  }

  return <div className="demo-shell"><a className="skip-link" href="#main-content">Skip to demo</a>
    <header className="topbar"><Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">⌘</span>Intent Firewall</Link><span className="powered"><span className="status-dot" />Powered by ZooWork Instinct</span></header>
    <main className="demo-main focused-main" id="main-content">
      <section className="intro focused-intro"><div><span className="eyebrow">ORDER CHANGES SHOULDN’T ALWAYS INTERRUPT THE CUSTOMER</span><h1>Same change.<br /><span>Different intent.</span></h1><p>The restaurant agent that resolves harmless order changes without bothering the customer.</p><p className="intro-support">Intent Firewall checks every merchant change against what the customer actually meant.</p></div></section>
      <div className="mode-actions">{mode === "guided" ? <><button className="run-button demo-button" disabled={busy} onClick={() => run(true)}>{busy ? "Demo running…" : error ? "Retry demo" : phase === "complete" ? "Replay demo" : "Run the demo"}<span aria-hidden="true">↗</span></button><button className="mode-link" onClick={() => switchMode("explore")}>Explore it yourself</button></> : <><span className="mode-label">Explore it yourself</span><button className="mode-link" onClick={() => switchMode("guided")}>Back to guided demo</button></>}{(busy || phase !== "idle") && <button className="mode-link reset-button" onClick={reset}>Reset</button>}</div>
      <div className="story-strip" aria-label="How it works"><span>Customer intent</span><i aria-hidden="true">→</i><span>Merchant change</span><i aria-hidden="true">→</i><span>Decision</span></div>
      {mode === "explore" && <div className="explore-controls"><label>Customer purpose<select className="purpose-select" value={purpose} onChange={(event) => { clearDecision(); setPurpose(event.target.value as Purpose); }}>{pair.map((item) => <option key={item}>{item}</option>)}</select></label><label>Merchant change<select className="scenario-select" value={scenarioId} onChange={(event) => { const next = event.target.value as ScenarioId; clearDecision(); setScenarioId(next); if (!purposeOptions(next).includes(purpose)) setPurpose(purposeOptions(next)[0]); }}>{[scenarios[1], scenarios[3], scenarios[0], scenarios[2]].map((item) => <option key={item.id} value={item.id}>{item.id === "trays" ? "Bowls → family trays" : item.title}</option>)}</select></label><button className="run-button evaluate-button" disabled={busy} onClick={() => run(false)}>{loading ? "Evaluating…" : error ? "Retry change" : "Evaluate change"}<span aria-hidden="true">↗</span></button></div>}
      <section className="focused-context" aria-label="Current order and merchant change"><div className="context-intent" key={purpose}><span className="field-label">WHAT THE CUSTOMER MEANT</span><h2>{purpose}{purpose === "Client meeting" && " at 12:30"}</h2><p>{purpose === "Client meeting" ? "A hard deadline. The meeting can’t wait." : purpose === "Casual team lunch" ? "A shared lunch. A little flexibility is fine." : purpose === "Shared team lunch" ? "Eating together matters; separate bowls don’t." : "Four people need four separate, labeled meals."}</p><small>4 people · $60 maximum · {purpose === "Client meeting" ? "12:30 hard deadline" : "12:30 preferred delivery"}</small></div><div className="context-change"><span className="field-label">WHAT CHANGED</span><h2>{scenarioId === "delay" ? "Delivery moves 15 minutes later" : scenarioId === "trays" ? "Bowls become family trays" : scenario.title}</h2><p className="focused-change">{scenarioId === "delay" ? "12:30 PM → 12:45 PM" : `${scenario.original} → ${scenario.proposed}`}</p><small>{scenarioId === "delay" ? "Same order. Same quantity. Same price." : scenario.facts.join(" · ")}</small></div></section>
      <article id="live-decision" className={`firewall-flow focused-result ${result ? `verdict-${result.verdict.toLowerCase()}` : ""}`} aria-busy={loading}><div className="panel-label"><span>Intent Firewall</span><span className="panel-tag">{loading ? "LIVE EVALUATION" : result ? "LIVE DECISION" : mode === "guided" && busy ? "SAME CHANGE · NEW PURPOSE" : "RESOLVE OR ESCALATE"}</span></div><div className="result-content" key={`${purpose}:${loading}:${result?.verdict}`} role="status" aria-live="polite">{loading ? <><div className="verdict-title loading-title"><span className="spinner" /> Checking intent…</div><p>{slow ? "Still waiting for the live service. You can reset and retry." : "Checking purpose, constraints and verified facts with ZooWork Instinct."}</p></> : error ? <><h3 className="error-title">Let’s try that again.</h3><p>{error}</p></> : result ? <><div className="verdict-title final-verdict">{displayVerdict(result.verdict)}</div><h3 className="final-policy-reason">{verdictCopy[result.verdict]}</h3><p>{result.policyReason}</p>{mode === "guided" && purpose === "Client meeting" && result.verdict === "ASK" && <p>The meeting starts at 12:30. Ask the customer.</p>}</> : <><div className="verdict-title waiting-title">{phase === "switching" ? "Only the purpose changes." : "Can the restaurant handle it?"}</div><p>{phase === "switching" ? "Client meeting → Casual team lunch. The delivery change stays exactly the same." : "A harmless change can be resolved. A broken promise needs a decision."}</p></>}</div></article>
      {(scenarioId === "delay" || scenarioId === "trays") && complete && <section className={`purpose-comparison comparison-complete ${scenarioId === "delay" ? "timing-comparison" : "semantic-comparison"}`} aria-label="Live results by purpose"><div className="comparison-caption"><strong>SAME CHANGE<br />DIFFERENT INTENT</strong><span>{scenarioId === "delay" ? "12:30 PM → 12:45 PM" : "4 bowls → 2 family trays"}</span></div>{pair.map((item, index) => <div className="comparison-entry" key={item}>{index > 0 && <span className="comparison-arrow" aria-hidden="true">→</span>}<div className="purpose-result"><span>{item}</span><strong className={`comparison-verdict outcome-${liveComparison[item]!.toLowerCase()}`}>{displayVerdict(liveComparison[item]!)}</strong></div></div>)}<p className="comparison-message">Intent Firewall interrupts the customer only when the change actually breaks what they meant.</p></section>}
      {mode === "guided" && phase === "complete" && <div className="secondary-proof"><span>Timing is only the beginning. Try four bowls → two family trays to see why packaging can change the meaning of a meal.</span><button className="mode-link" onClick={() => { switchMode("explore"); setScenarioId("trays"); setPurpose("Shared team lunch"); }}>Explore the meal example →</button></div>}
      {result && <DecisionReceipt result={result} purpose={purpose} scenarioId={scenarioId} />}
      <section className="outcome-strip" aria-label="Product value"><span><b>Fewer unnecessary interruptions</b>Ask only when intent is at risk.</span><span><b>Faster merchant resolution</b>Resolve harmless changes automatically.</span><span><b>Intent preserved</b>Purpose and hard constraints come first.</span></section>
      <footer className="demo-footer"><div className="architecture-strip" aria-label="Decision architecture">{["Shopper Agent", "Intent Record", "Restaurant Intent Firewall", "ZooWork Instinct", "Resolve or Escalate"].map((step, index) => <span key={step}>{index > 0 && <i aria-hidden="true">→</i>}{step}</span>)}</div>{avoided > 0 && <span>{avoided} customer interruptions avoided in this session</span>}</footer>
    </main>
  </div>;
}
