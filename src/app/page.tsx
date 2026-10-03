"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { displayVerdict, isDecision, isRecord, type Decision, type Verdict } from "../lib/decision";
import { decisionInput, purposeOptions, scenarios, type Purpose, type ScenarioId } from "../lib/demo";
import DecisionReceipt from "./decision-receipt";
import CaptureDemo from "./capture-demo";

const verdictCopy: Record<Verdict, string> = {
  AUTO_ADAPT: "Resolved automatically", ASK: "Customer decision needed",
  HOLD: "Waiting for verification", BLOCK: "Hard constraint violated",
};
type Phase = "intro1" | "intro2" | "intro3" | "intro4" | "hero" | "closing" | "end" | "idle" | "arriving" | "accepted" | "event" | "meeting" | "switching" | "lunch" | "complete" | "error";
const emptyComparison = () => ({ delay: {}, trays: {} } as Record<"delay" | "trays", Partial<Record<Purpose, Verdict>>>);

export default function Home() {
  const [capture, setCapture] = useState(false);
  const [mode, setMode] = useState<"guided" | "explore">("guided");
  const [phase, setPhase] = useState<Phase>("idle");
  const [purpose, setPurpose] = useState<Purpose>("Client meeting");
  const [scenarioId, setScenarioId] = useState<ScenarioId>("delay");
  const [result, setResult] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
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
    setLoading(false); setBusy(false); setSlow(false); setResult(null); setError(""); setPaused(false); pausedRef.current = false;
  }
  function reset() {
    clearDecision(); setPhase("idle"); setPurpose("Client meeting"); setScenarioId("delay");
    setComparison(emptyComparison()); setAvoided(0); countedAdaptations.current.clear();
  }
  function switchMode(next: "guided" | "explore") {
    reset(); setMode(next);
  }
  function togglePause() { pausedRef.current = !pausedRef.current; setPaused(pausedRef.current); }
  function wait(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      let remaining = ms;
      let previous = performance.now();
      const abort = () => { window.clearInterval(timer); reject(new DOMException("Canceled", "AbortError")); };
      const timer = window.setInterval(() => {
        const now = performance.now();
        if (!pausedRef.current) remaining -= now - previous;
        previous = now;
        if (signal.aborted) { abort(); return; }
        if (!pausedRef.current && remaining <= 0) { window.clearInterval(timer); signal.removeEventListener("abort", abort); resolve(); }
      }, 100);
      if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    });
  }
  async function evaluate(selectedPurpose: Purpose, selectedScenario: ScenarioId, controller: AbortController, minimumDisplayMs = 0) {
    const started = Date.now();
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
      window.clearTimeout(timeout); window.clearTimeout(slowTimer);
      await wait(Math.max(0, minimumDisplayMs - (Date.now() - started)), controller.signal);
      if (activeRequest.current !== controller) throw new DOMException("Canceled", "AbortError");
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
  async function run(guided: boolean, proof: ScenarioId = "delay") {
    if (activeRequest.current) return;
    if (guided) reset();
    const controller = new AbortController(); activeRequest.current = controller; setBusy(true);
    try {
      if (guided) {
        const secondary = proof === "trays";
        const firstPurpose: Purpose = secondary ? "Shared team lunch" : "Client meeting";
        const secondPurpose: Purpose = secondary ? "Four separately labeled desk meals" : "Casual team lunch";
        setScenarioId(proof); setPurpose(firstPurpose);
        if (!secondary) {
          for (const introPhase of ["intro1", "intro2", "intro3", "intro4"] as const) {
            setPhase(introPhase); await wait(1_600, controller.signal);
          }
        }
        setPhase("arriving"); await wait(secondary ? 1_000 : 2_000, controller.signal);
        setPhase("accepted"); await wait(secondary ? 1_000 : 2_000, controller.signal);
        setPhase("event"); await wait(secondary ? 1_000 : 3_000, controller.signal);
        setPhase("meeting"); await evaluate(firstPurpose, proof, controller, secondary ? 1_000 : 3_000);
        await wait(secondary ? 3_000 : 4_000, controller.signal);
        setPhase("switching"); setPurpose(secondPurpose); setResult(null);
        await wait(secondary ? 2_000 : 3_000, controller.signal);
        setPhase("lunch"); await evaluate(secondPurpose, proof, controller, secondary ? 1_000 : 3_000);
        await wait(secondary ? 3_000 : 4_000, controller.signal);
        if (!secondary) {
          setPhase("hero"); await wait(5_000, controller.signal);
          setPhase("closing"); await wait(3_000, controller.signal);
          setPhase("end");
        } else
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

  if (capture) return <CaptureDemo onExit={() => { reset(); setCapture(false); }} />;

  const introBeats = {
    intro1: { title: "AI agents can place orders.", detail: "But fulfillment still changes in the real world.", visual: "Item unavailable · Delivery delayed · Packaging changed · Verification missing", caption: "AI agents can place orders — but the real world still changes." },
    intro2: { title: "Restaurants don’t know which changes actually matter.", detail: "A harmless change can interrupt the customer. An important change can be missed.", visual: "Restaurant change → Ask or resolve?", caption: "Which changes are harmless? Which break what the customer meant?" },
    intro3: { title: "The order arrives. The purpose gets lost.", detail: "The merchant sees the items, but not always the reason behind them.", visual: "ORDER + WHAT THE CUSTOMER MEANT", caption: "The merchant sees the order, but not always the reason behind it." },
    intro4: { title: "Intent Firewall gives the merchant the missing context.", detail: "Carry purpose and constraints into every fulfillment decision.", visual: "ORDER + INTENT → INTENT FIREWALL → RESOLVE / ASK", caption: "Give merchants the missing context. Watch a live order." },
  };
  const introBeat = phase === "intro1" || phase === "intro2" || phase === "intro3" || phase === "intro4" ? introBeats[phase] : undefined;
  const narration = error ? "The live decision couldn’t be completed. Retry the evaluation."
    : introBeat ? introBeat.caption
    : phase === "arriving" ? "An AI shopper orders lunch for a 12:30 meeting. The order carries its purpose."
    : phase === "accepted" ? "The restaurant receives the order — and the intent behind it."
    : phase === "event" ? "The restaurant is 15 minutes late. Delivery moves from 12:30 to 12:45."
    : phase === "switching" ? "Only the purpose changes. The same restaurant delay stays in place."
    : loading ? purpose === "Client meeting" ? "Intent Firewall checks purpose, hard constraints and verified facts." : "Casual lunch allows flexible timing. Evaluate the same merchant change."
    : phase === "hero" ? "Same change. Different intent. Different decision. Resolve safely or ask."
    : phase === "closing" ? "Resolve more. Interrupt less. Preserve intent. Keep orders moving."
    : result?.verdict === "ASK" ? purpose === "Client meeting" ? "12:45 misses the client meeting. Pause the change and ask the customer." : "This change needs customer approval."
    : result?.verdict === "AUTO_ADAPT" ? "Resolved automatically. No unnecessary customer interruption."
    : "The order carries both items and purpose into restaurant fulfillment.";

  if (mode === "guided" && phase === "end") return <div className="demo-shell"><main className="end-card"><span className="end-mark brand-mark" aria-hidden="true">⌘</span><span className="eyebrow">INTENT FIREWALL</span><h1>Same change.<br />Different intent.<br /><span>Different decision.</span></h1><p>Keep orders moving without losing what the customer meant.</p><span className="powered">Powered by ZooWork Instinct</span><div className="mode-actions"><button className="run-button demo-button" onClick={() => run(true)}>Replay demo ↗</button><button className="mode-link" onClick={() => switchMode("explore")}>Explore manually</button></div><p className="end-narration">Intent Firewall helps merchants resolve harmless changes automatically — and interrupt customers only when their intent is actually at risk.</p></main></div>;

  const eventVisible = mode === "explore" || !["idle", "arriving", "accepted"].includes(phase);
  const orderStatus = error ? "DECISION SERVICE UNAVAILABLE" : loading ? "EVALUATING INTENT" : result ? ({ ASK: "PAUSED FOR CUSTOMER", AUTO_ADAPT: "UPDATED", HOLD: "WAITING FOR VERIFICATION", BLOCK: "CHANGE BLOCKED" }[result.verdict]) : phase === "arriving" ? "ORDER ARRIVING" : eventVisible ? "CHANGE PROPOSED" : "ORDER ACCEPTED";
  const deliveryUpdated = result?.verdict === "AUTO_ADAPT" && scenarioId === "delay";
  return <div className="demo-shell"><a className="skip-link" href="#main-content">Skip to demo</a>
    <header className="topbar"><Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">⌘</span>Intent Firewall</Link><span className="powered"><span className="status-dot" />Powered by ZooWork Instinct</span></header>
    <main className="demo-main focused-main" id="main-content">
      <section className="intro focused-intro"><div><span className="eyebrow">ORDER CHANGES SHOULDN’T ALWAYS INTERRUPT THE CUSTOMER</span><h1>Same change.<br /><span>Different intent.</span></h1><p>The restaurant agent that resolves harmless order changes without bothering the customer.</p><p className="intro-support">An AI shopper placed the order. The restaurant needs to change it. Intent Firewall decides whether the merchant can resolve it automatically or must ask the customer.</p></div></section>
      <div className="mode-actions">{mode === "guided" ? <>{!busy && <button className="run-button demo-button" onClick={() => run(true, error ? scenarioId : "delay")}>{error ? "Retry decision" : phase === "complete" ? "Replay demo" : "Run live demo"}<span aria-hidden="true">↗</span></button>}{busy && <><button className="run-button pause-button" onClick={togglePause}>{paused ? "Resume" : "Pause"}</button><button className="mode-link restart-button" onClick={() => { reset(); void run(true, scenarioId); }}>Restart</button></>}{!busy && <button className="mode-link capture-entry" onClick={() => { reset(); setCapture(true); }}>Step-by-step demo</button>}<button className="mode-link" onClick={() => switchMode("explore")}>Explore manually</button></> : <><span className="mode-label">Merchant console</span><button className="mode-link" onClick={() => switchMode("guided")}>Back to live order demo</button></>}{!busy && (result || error || phase !== "idle") && <button className="mode-link reset-button" onClick={reset}>Reset</button>}</div>
      {introBeat && <section className="cinematic-intro" key={phase} aria-label="Product introduction"><span className="eyebrow">THE MERCHANT’S MISSING CONTEXT</span><h2>{introBeat.title}</h2><p>{introBeat.detail}</p><div className="intro-visual">{introBeat.visual}</div></section>}
      {mode === "guided" && phase !== "idle" && <div className="narration" key={narration} role="status" aria-live="polite"><p>{narration}</p>{paused && <span>Paused</span>}</div>}
      <div className={`demo-content ${introBeat ? "content-hidden" : ""} ${mode === "guided" && busy ? "cinematic-layout" : ""}`}>
      <div className={`transaction-flow ${busy && !paused ? "flow-active" : ""}`} aria-label="Order transaction"><span><b>Shopper Agent</b><small>Sends order + intent</small></span><i aria-hidden="true">→</i><span><b>Active order #1842</b><small>Purpose travels with the order</small></span><i aria-hidden="true">→</i><span><b>Restaurant</b><small>Receives and fulfills</small></span></div>
      {mode === "explore" && <div className="explore-controls"><label>Customer purpose<select className="purpose-select" value={purpose} onChange={(event) => { clearDecision(); setPurpose(event.target.value as Purpose); }}>{pair.map((item) => <option key={item}>{item}</option>)}</select></label><label>Merchant change<select className="scenario-select" value={scenarioId} onChange={(event) => { const next = event.target.value as ScenarioId; clearDecision(); setScenarioId(next); if (!purposeOptions(next).includes(purpose)) setPurpose(purposeOptions(next)[0]); }}>{[scenarios[1], scenarios[3], scenarios[0], scenarios[2]].map((item) => <option key={item.id} value={item.id}>{item.id === "trays" ? "Bowls → family trays" : item.title}</option>)}</select></label><button className="run-button evaluate-button" disabled={busy} onClick={() => run(false)}>{loading ? "Evaluating…" : error ? "Retry change" : "Evaluate change"}<span aria-hidden="true">↗</span></button></div>}
      <div className="live-workbench">
      <section className={`order-workspace ${paused ? "is-paused" : ""}`} aria-label="Active restaurant order">
        <article className={`order-card ${phase === "arriving" ? "order-arriving" : ""}`}><header><span className="field-label">ORDER #1842</span><span className="order-status" data-verdict={result?.verdict} role="status">{orderStatus}</span></header><p className="placed-by">Placed by Shopper Agent · Intent Record attached</p><div className="context-intent" key={purpose}><span className="field-label">CUSTOMER PURPOSE</span><h2>{purpose}</h2><p>{purpose === "Client meeting" ? "Lunch must arrive before the 12:30 client meeting." : purpose === "Casual team lunch" ? "Lunch together. A 15-minute delay is acceptable." : purpose === "Shared team lunch" ? "A shared meal for four; serving format is flexible." : "Four separate meals, individually packaged and labeled."}</p></div><dl className="order-facts"><div><dt>For</dt><dd>4 people</dd></div><div><dt>Delivery</dt><dd>{deliveryUpdated ? "12:45 PM · Updated" : "12:30 PM"}</dd></div><div><dt>Budget</dt><dd>$60 max</dd></div></dl><div className="order-items"><span>{result?.verdict === "AUTO_ADAPT" && scenarioId === "trays" ? "2 family trays · 4 servings" : "4 Mediterranean bowls"}</span><span>{result?.verdict === "AUTO_ADAPT" && scenarioId === "package" ? "2 twin-packs of sparkling water" : "4 sparkling waters"}</span></div>{result?.verdict === "AUTO_ADAPT" && <p className="order-outcome">Order updated · No customer interruption</p>}{result?.verdict === "ASK" && <p className="order-outcome">Change paused · Customer approval needed</p>}</article>
        <div className="merchant-event" aria-live="polite"><span className="field-label">RESTAURANT FULFILLMENT</span>{eventVisible ? <div className="event-content"><span className="event-tag">MERCHANT CHANGE</span><h2>{scenarioId === "delay" ? "Delivery is running 15 minutes late." : scenarioId === "trays" ? "The kitchen proposes family trays." : scenario.title}</h2><p className="focused-change">{scenarioId === "delay" ? "12:30 PM → 12:45 PM" : scenarioId === "trays" ? "4 individual bowls → 2 family trays" : `${scenario.original} → ${scenario.proposed}`}</p><small>{scenarioId === "delay" ? "Same order. Same quantity. Same price." : scenarioId === "trays" ? "Same food. Exactly 4 servings. Same budget." : scenario.facts.join(" · ")}</small></div> : <div className="event-awaiting"><h2>{phase === "arriving" ? "An order is arriving." : "Order received. Ready to fulfill."}</h2><p>The restaurant can see the order and why the customer placed it.</p></div>}{paused && <p className="pause-note">Demo paused. Resume to continue.</p>}</div>
      </section>
      <article id="live-decision" className={`firewall-flow focused-result ${loading && !paused ? "firewall-evaluating" : ""} ${result ? `verdict-${result.verdict.toLowerCase()}` : ""}`} aria-busy={loading}><div className="panel-label"><span>Intent Firewall</span><span className="panel-tag">{loading ? "LIVE EVALUATION" : result ? "LIVE DECISION" : mode === "guided" && busy ? "SAME CHANGE · NEW PURPOSE" : "RESOLVE OR ESCALATE"}</span></div><div className="result-content" key={`${purpose}:${loading}:${result?.verdict}`} role="status" aria-live="polite">{loading ? <><div className="verdict-title loading-title"><span className="spinner" /> Checking intent…</div><p>{slow ? "Still waiting for the live service. You can reset and retry." : "Semantic decision · ZooWork Instinct"}</p></> : error ? <><h3 className="error-title">Decision service unavailable</h3><p>{error}</p></> : result ? <><div className="verdict-title final-verdict">{displayVerdict(result.verdict)}</div><h3 className="final-policy-reason">{verdictCopy[result.verdict]}</h3><p>{result.policyReason}</p>{mode === "guided" && purpose === "Client meeting" && result.verdict === "ASK" && <p>The meeting starts at 12:30. Ask the customer.</p>}</> : <><div className="verdict-title waiting-title">{phase === "switching" ? "Only the purpose changes." : "Can the restaurant handle it?"}</div><p>{phase === "switching" ? "The purpose changes. Food, quantity, price and merchant change stay the same." : "A harmless change can be resolved. A broken promise needs a decision."}</p></>}</div>{eventVisible && <ul className="intelligence-checks" aria-label="Decision context"><li>Purpose: {purpose}</li><li>{purpose === "Client meeting" ? "Hard deadline: 12:30 PM" : purpose === "Four separately labeled desk meals" ? "Hard constraint: separate packaging + labels" : "Soft preference: flexible timing / serving"}</li><li>Hard budget: $60 · Quantity: 4</li><li>{scenarioId === "kitchen" ? "Verification scan missing" : "Merchant change verified"}</li><li>{result ? result.constraintsAtRisk.length ? "Hard constraint at risk" : result.constraintsPreserved.length ? "Constraints preserved" : "See evidence in receipt" : "Checking intent against the change"}</li></ul>}</article>
      </div>
      {(scenarioId === "delay" || scenarioId === "trays") && complete && <section className={`purpose-comparison comparison-complete ${scenarioId === "delay" ? "timing-comparison" : "semantic-comparison"}`} aria-label="Live results by purpose"><div className="comparison-caption"><strong>{scenarioId === "trays" ? <>SAME FOOD. SAME QUANTITY.<br />DIFFERENT PURPOSE.</> : <>SAME CHANGE.<br />DIFFERENT INTENT.<br />DIFFERENT DECISION.</>}</strong><span>{scenarioId === "delay" ? "12:30 PM → 12:45 PM" : "4 bowls → 2 family trays"}</span></div>{pair.map((item, index) => <div className="comparison-entry" key={item}>{index > 0 && <span className="comparison-arrow" aria-hidden="true">→</span>}<div className="purpose-result"><span>{item}</span><strong className={`comparison-verdict outcome-${liveComparison[item]!.toLowerCase()}`}>{displayVerdict(liveComparison[item]!)}</strong></div></div>)}<p className="comparison-message">Intent Firewall interrupts the customer only when the change actually breaks what they meant.</p></section>}
      {mode === "guided" && phase === "complete" && <div className="secondary-proof"><span>Meaning goes beyond timing. Four bowls or two family trays?</span><button className="mode-link" onClick={() => run(true, "trays")}>See another decision →</button></div>}
      {phase === "complete" && <section className="approval-comparison" aria-label="Merchant workflow comparison"><div><span className="field-label">TYPICAL APPROVAL FLOW</span><p>Restaurant change → Customer approval → Interruption</p></div><div><span className="field-label">WITH INTENT FIREWALL</span><p>Restaurant change → Intent checked → Resolve safely or escalate</p></div></section>}
      {result && <DecisionReceipt result={result} purpose={purpose} scenarioId={scenarioId} />}
      <section className="outcome-strip" aria-label="Product value"><span><b>INTERRUPT LESS</b>Ask only when intent is actually at risk.</span><span><b>RESOLVE MORE</b>Harmless changes can continue automatically.</span><span><b>PRESERVE INTENT</b>Purpose and constraints travel with the order.</span></section>
      <footer className="demo-footer"><div className="architecture-strip" aria-label="Decision architecture">{["Shopper Agent", "Intent Record", "Restaurant", "Intent Firewall", "ZooWork Instinct", "Resolve or Escalate"].map((step, index) => <span key={step}>{index > 0 && <i aria-hidden="true">→</i>}{step}</span>)}</div>{avoided > 0 && <span>{avoided} customer interruptions avoided in this session</span>}</footer>
      </div>
    </main>
  </div>;
}
