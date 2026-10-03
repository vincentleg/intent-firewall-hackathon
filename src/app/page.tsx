"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { displayVerdict, isDecision, isRecord, type Decision, type Verdict } from "../lib/decision";
import { decisionInput, purposeOptions, scenarios, type Purpose, type ScenarioId } from "../lib/demo";
import DecisionReceipt from "./decision-receipt";

const verdictCopy: Record<Verdict, { title: string; description: string }> = {
  AUTO_ADAPT: { title: "Resolved. No interruption.", description: "The change preserves the customer’s intent. The restaurant can handle it automatically." },
  ASK: { title: "A choice for the customer.", description: "The restaurant needs customer approval before applying this change." },
  HOLD: { title: "Pause until it’s verified.", description: "Keep the change on hold while the restaurant verifies the missing information." },
  BLOCK: { title: "This change cannot proceed.", description: "The change conflicts with the customer’s intent or authorization." },
};

export default function Home() {
  const [purpose, setPurpose] = useState<Purpose>("Client meeting");
  const [scenarioId, setScenarioId] = useState<ScenarioId>("delay");
  const [result, setResult] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [slow, setSlow] = useState(false);
  const [avoided, setAvoided] = useState(0);
  const [comparison, setComparison] = useState<Record<"delay" | "trays", Partial<Record<Purpose, Verdict>>>>({ delay: {}, trays: {} });
  const activeRequest = useRef<AbortController | null>(null);
  const orderSessions = useRef(new Map<string, string>());
  const countedAdaptations = useRef(new Set<string>());
  const scenario = scenarios.find((item) => item.id === scenarioId)!;
  const hard = purpose === "Client meeting";
  const trays = scenarioId === "trays";
  const deskMeals = purpose === "Four separately labeled desk meals";
  const comparisonPurposes = purposeOptions(scenarioId);
  const liveComparison = scenarioId === "trays" ? comparison.trays : comparison.delay;
  const comparisonComplete = comparisonPurposes.every((item) => !!liveComparison[item]);
  const nextPurpose = comparisonPurposes.find((item) => !liveComparison[item] && item !== purpose);

  useEffect(() => () => activeRequest.current?.abort(), []);

  function clearDecision() {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setLoading(false);
    setSlow(false);
    setResult(null);
    setError("");
  }

  async function runDecision() {
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setSlow(false);
    setError("");
    setResult(null);
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
    const slowTimer = window.setTimeout(() => { if (activeRequest.current === controller) setSlow(true); }, 8_000);
    const input = decisionInput(purpose, scenarioId);
    const orderKey = JSON.stringify([input.intent, input.originalOrder]);
    try {
      const response = await fetch("/api/decision", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, agentSessionToken: orderSessions.current.get(orderKey) }), signal: controller.signal,
      });
      let data: unknown;
      try { data = await response.json(); }
      catch { throw new Error("The live service returned an unreadable response. Please try again."); }
      if (!response.ok) {
        const code = isRecord(data) ? data.code : undefined;
        const message = code === "RATE_LIMITED" ? "The live service is busy. Wait a moment, then try again."
          : code === "NOT_CONFIGURED" ? "Live decisions are temporarily unavailable. Please try again later."
          : code === "TIMEOUT" ? "The live decision took too long. Please try again."
          : "The live service couldn’t complete this decision. Please try again.";
        throw new Error(message);
      }
      if (!isDecision(data)) throw new Error("The live service returned an incomplete decision. Please try again.");
      if (activeRequest.current !== controller) return;
      if (data.orchestration?.mode === "managed_agent" && data.orchestration.sessionToken) orderSessions.current.set(orderKey, data.orchestration.sessionToken);
      else if (data.orchestration?.mode === "direct_fallback") orderSessions.current.delete(orderKey);
      setResult(data);
      const changeKey = `${purpose}:${scenarioId}`;
      if (data.verdict === "AUTO_ADAPT" && !countedAdaptations.current.has(changeKey)) {
        countedAdaptations.current.add(changeKey);
        setAvoided((count) => count + 1);
      }
      if (scenarioId === "delay" || scenarioId === "trays") setComparison((previous) => ({ ...previous, [scenarioId]: { ...previous[scenarioId], [purpose]: data.verdict } }));
    } catch (failure) {
      if (activeRequest.current === controller) {
        setError(timedOut ? "The live decision took too long. Please try again."
          : failure instanceof Error && !(failure instanceof SyntaxError) && failure.name !== "TypeError"
            ? failure.message : "We couldn’t reach the live service. Check your connection and try again.");
      }
    } finally {
      window.clearTimeout(timeout);
      window.clearTimeout(slowTimer);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setLoading(false);
        setSlow(false);
      }
    }
  }

  const chips: string[] = [scenarioId === "kitchen" ? "State is not verified" : "State verified", ...scenario.facts];
  if (scenarioId === "delay") chips.push(hard ? "Hard deadline · 12:30 PM" : "Soft deadline · flexible timing");
  if (result && result.policyReason !== "Instinct decision accepted" && !chips.includes(result.policyReason)) chips.push(result.policyReason);

  return (
    <div className="demo-shell"><a className="skip-link" href="#main-content">Skip to demo</a>
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Intent Firewall home"><span className="brand-mark" aria-hidden="true">⌘</span> Intent Firewall</Link>
        <span className="powered"><span className="status-dot" /> Powered by ZooWork Instinct</span>
      </header>
      <main className="demo-main" id="main-content">
        <section className="intro">
          <div><span className="eyebrow">INTENT-AWARE ORDER RESOLUTION</span><h1>Same change.<br /><span>Different intent.</span></h1><p>The restaurant agent that resolves harmless order changes without bothering the customer.</p><p className="intro-support">Intent Firewall checks every merchant change against what the customer actually meant.</p></div>
          <div className="avoided"><span className="avoided-icon" aria-hidden="true">↗</span><strong>{avoided}</strong><span>Customer interruptions<br />avoided</span><small>Distinct demo changes</small></div>
        </section>

        <div className="story-strip" aria-label="How it works"><span>Customer intent</span><i aria-hidden="true">→</i><span>Merchant change</span><i aria-hidden="true">→</i><span>Decision</span></div>
        <section className="intent-card" aria-labelledby="intent-title">
          <div className="intent-heading"><div><span className="step">01</span><h2 id="intent-title">What did the customer mean?</h2></div><span className="origin">Sent with the order by the shopper agent</span></div>
          <div className="intent-content">
            <div className="purpose-field"><span className="field-label">PURPOSE · SWITCH TO COMPARE</span><div className="purpose-switch" role="group" aria-label="Customer purpose">{purposeOptions(scenarioId).map((item) => <button key={item} type="button" aria-controls="live-decision" aria-pressed={purpose === item} onClick={() => { if (item !== purpose) { clearDecision(); setPurpose(item); } }}>{item}</button>)}</div><small>{trays ? deskMeals ? "Four people. Four labeled meals. Sharing isn’t the intent." : "Eating together matters. The serving format can change." : hard ? "Timing is a promise. The meeting can’t wait." : "Timing is a preference. Lunch can wait a little."}</small></div>
            <dl className="intent-facts"><div><dt>PARTY SIZE</dt><dd>4 people</dd></div><div><dt>DELIVERY DEADLINE</dt><dd>12:30 PM <span className={`deadline-tag ${hard ? "hard" : "soft"}`}>{hard ? "Hard" : "Soft"}</span></dd></div><div><dt>BUDGET</dt><dd>$60 maximum</dd></div><div><dt>PREFERENCE</dt><dd>{trays ? deskMeals ? "Separate labeled meals" : "Shared meal" : "Sparkling water"}</dd></div></dl>
          </div>
        </section>

        <section className="scenario-section" aria-labelledby="scenario-title">
          <div className="section-heading"><div><span className="step">02</span><h2 id="scenario-title">What changed?</h2></div><span>Choose a real-world hiccup</span></div>
          <div className="scenario-grid">{[scenarios[1], scenarios[3], scenarios[0], scenarios[2]].map((item) => <button key={item.id} type="button" className={`scenario-card scenario-${item.id} ${scenarioId === item.id ? "selected" : ""}`} aria-controls="live-decision" aria-pressed={scenarioId === item.id} onClick={() => { if (item.id !== scenarioId) { clearDecision(); setScenarioId(item.id); if (!purposeOptions(item.id).includes(purpose)) setPurpose(purposeOptions(item.id)[0]); } }}><div className="scenario-top"><span className="scenario-icon" aria-hidden="true">{item.icon}</span><span className="scenario-number">{item.number}</span><span className="selection-dot" aria-hidden="true" /></div><h3>{item.id === "trays" ? "Bowls → family trays" : item.title}</h3><p>{item.description}</p><div className="change-line"><span>FROM</span><strong>{item.original}</strong></div><div className="change-line proposed"><span>TO</span><strong>{item.proposed}</strong></div></button>)}</div>
        </section>

        <section className="decision-section" aria-labelledby="decision-title">
          <div className="section-heading decision-heading"><div><span className="step">03</span><h2 id="decision-title">What should the restaurant do?</h2></div><button className="run-button" type="button" disabled={loading} onClick={runDecision}>{loading ? <><span className="spinner" /> Evaluating intent…</> : <>{error ? "Try again" : result ? "Run again" : "Run live decision"}<span aria-hidden="true">↗</span></>}</button></div>
          <div className="comparison-grid">
            <article className="typical-flow"><div className="panel-label"><span>Typical approval flow</span><span className="panel-tag">ESCALATE</span></div><div className="interruption-icon" aria-hidden="true">!</div><h3>Customer approval required</h3><p>A change happened. Send it back to the customer.</p><div className="flow-footer"><span className="small-dot" />Customer interrupted</div></article>
            <article id="live-decision" className={`firewall-flow ${result ? `verdict-${result.verdict.toLowerCase()}` : ""}`} aria-busy={loading}>
              <div className="panel-label"><span><span className="mini-mark" aria-hidden="true">⌘</span> Intent Firewall</span><span className="panel-tag">{result ? "LIVE RESULT" : "INTENT AWARE"}</span></div>
              <div className="result-content" key={`${purpose}:${scenarioId}:${loading ? "loading" : error ? "error" : result?.verdict ?? "waiting"}`} role="status" aria-live="polite">{loading ? <><div className="verdict-title loading-title">Checking intent<span className="loading-dots">…</span></div><p>{slow ? "Still waiting for a live response. Your decision will appear here; no change has been applied." : `Evaluating the change against ${purpose.toLowerCase()} intent.`}</p></> : error ? <><h3 className="error-title">Let’s try that again.</h3><p>{error}</p></> : result ? <><div className="verdict-title final-verdict">{displayVerdict(result.verdict)}</div><h3 className="final-policy-reason">{result.policyReason}</h3><p>{verdictCopy[result.verdict].description}</p></> : <><div className="verdict-title waiting-title">Intent comes first.</div><p>Run a live decision to see which changes need the customer’s attention.</p></>}</div>
              <div className="flow-footer">{result ? verdictCopy[result.verdict].title : "One change. The customer’s purpose makes the difference."}</div>
            </article>
          </div>
          <div className="reason-chips" aria-label="Scenario facts and policy reasons">{chips.map((chip) => <span key={chip}><span aria-hidden="true">{chip === "State is not verified" ? "○" : "·"}</span>{chip}</span>)}</div>
          {(scenarioId === "delay" || trays) && <section className={`purpose-comparison ${trays ? "semantic-comparison" : "timing-comparison"} ${comparisonComplete ? "comparison-complete" : ""}`} aria-label="Live results by purpose" aria-live="polite">
            <div className="comparison-caption"><strong>{trays ? "Same servings. Different purpose." : <>SAME CHANGE<br />DIFFERENT PURPOSE</>}</strong><span>{trays ? "4 individual bowls → 2 family trays" : "12:30 PM → 12:45 PM"} · {comparisonComplete ? "Actual live decisions." : "Run both purposes to reveal the difference."}</span></div>
            {comparisonPurposes.map((item, index) => <div className="comparison-entry" key={item}>{index > 0 && comparisonComplete && <span className="comparison-arrow" aria-hidden="true">→</span>}<div className="purpose-result"><span>{item}</span><strong className={liveComparison[item] ? `comparison-verdict outcome-${liveComparison[item].toLowerCase()}` : ""}>{liveComparison[item] ? displayVerdict(liveComparison[item]) : "Not run yet"}</strong></div></div>)}
          </section>}
          {result && (scenarioId === "delay" || trays) && <div className="demo-next"><span>{nextPurpose ? "Keep the merchant change. Switch the customer’s purpose." : trays ? "One meal. Two different meanings." : "Next: see why four servings aren’t always four meals."}</span>{nextPurpose ? <button type="button" onClick={() => { clearDecision(); setPurpose(nextPurpose); }}>Compare {nextPurpose === "Four separately labeled desk meals" ? "labeled desk meals" : nextPurpose.toLowerCase()} <span aria-hidden="true">→</span></button> : !trays ? <button type="button" onClick={() => { clearDecision(); setScenarioId("trays"); setPurpose("Shared team lunch"); }}>Try the shared-meal demo <span aria-hidden="true">→</span></button> : null}</div>}
          {result && <DecisionReceipt result={result} purpose={purpose} scenarioId={scenarioId} />}
        </section>
        <section className="outcome-strip" aria-label="Product value"><span><b>Fewer unnecessary interruptions</b>Only ask when intent is at risk.</span><span><b>Faster merchant resolution</b>Handle harmless changes automatically.</span><span><b>Intent preserved</b>Purpose and hard constraints come first.</span></section>
        <footer className="demo-footer"><div className="architecture-strip" aria-label="Decision architecture">{["Shopper Agent", "Intent Record", "Restaurant Intent Firewall", "ZooWork Instinct", "Resolve or Escalate"].map((step, index) => <span key={step}>{index > 0 && <i aria-hidden="true">→</i>}{step}</span>)}</div></footer>
      </main>
    </div>
  );
}
