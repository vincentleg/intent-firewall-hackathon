"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const outcomes = ["AUTO_ADAPT", "ASK", "HOLD", "BLOCK"] as const;
type Verdict = (typeof outcomes)[number];
type Purpose = "Client meeting" | "Casual team lunch";
type ScenarioId = "package" | "delay" | "kitchen";
type Decision = { verdict: Verdict; policyReason: string; instinctVerdict: Verdict; probabilities: Record<Verdict, number> };

const scenarios = [
  { id: "package", number: "01", icon: "▦", title: "A different package", description: "Same water. Same quantity. Better price.", original: "4 sparkling waters", proposed: "2 twin-packs of the same water", facts: ["Same usable quantity", "Lower price · $1 cheaper"] },
  { id: "delay", number: "02", icon: "◷", title: "A little later", description: "15 minutes can change everything.", original: "Delivery at 12:30 PM", proposed: "Delivery at 12:45 PM", facts: ["Delivery delayed by 15 minutes"] },
  { id: "kitchen", number: "03", icon: "◎", title: "Ready. Or is it?", description: "The kitchen says yes. The scan is missing.", original: "Order marked ready", proposed: "Kitchen says ready; verification scan missing", facts: ["Verification scan missing"] },
] as const;

function decisionInput(purpose: Purpose, scenario: ScenarioId) {
  const hard = purpose === "Client meeting";
  return {
    intent: {
      purpose, partySize: 4, budget: "$60 maximum", preference: "Same sparkling water, four usable servings",
      deadlineMeaning: hard ? "hard" : "soft",
      // The existing API recognizes deadline fields as hard constraints. A soft
      // target uses preferredDeliveryTime so it reaches Instinct without that override.
      ...(hard ? { hardDeadline: "12:30 PM" } : { preferredDeliveryTime: "12:30 PM" }),
      timingContext: hard ? "Food is needed for a client meeting; late delivery requires customer approval." : "A flexible team lunch; a 15-minute delay is acceptable if the order and budget are preserved.",
    },
    originalOrder: { sparklingWater: { packages: 4, servings: 4 }, totalPrice: 60, deliveryTime: "12:30 PM", kitchenState: "ready" },
    proposedChange: scenario === "package"
      ? { sparklingWater: { packages: 2, packageType: "twin-pack", servings: 4, sameProduct: true }, totalPrice: 59, deliveryTime: "12:30 PM" }
      : scenario === "delay"
        ? { deliveryTime: "12:45 PM", itemsUnchanged: true, totalPrice: 60 }
        : { kitchenState: "Kitchen says ready", verificationScan: "missing", itemsUnchanged: true },
    verificationState: scenario === "kitchen" ? "unverified" : "verified",
  };
}

function isDecision(value: unknown): value is Decision {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Decision>;
  return outcomes.includes(item.verdict as Verdict) && outcomes.includes(item.instinctVerdict as Verdict)
    && typeof item.policyReason === "string" && !!item.probabilities
    && outcomes.every((key) => typeof item.probabilities?.[key] === "number" && Number.isFinite(item.probabilities[key]) && item.probabilities[key] >= 0 && item.probabilities[key] <= 1);
}

function displayVerdict(verdict: Verdict) {
  return verdict === "AUTO_ADAPT" ? "AUTO-ADAPT" : verdict;
}

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
  const [avoided, setAvoided] = useState(0);
  const [comparison, setComparison] = useState<Partial<Record<Purpose, Verdict>>>({});
  const activeRequest = useRef<AbortController | null>(null);
  const scenario = scenarios.find((item) => item.id === scenarioId)!;
  const hard = purpose === "Client meeting";
  const comparisonComplete = !!comparison["Client meeting"] && !!comparison["Casual team lunch"];

  useEffect(() => () => activeRequest.current?.abort(), []);

  function clearDecision() {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setLoading(false);
    setResult(null);
    setError("");
  }

  async function runDecision() {
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/decision", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(decisionInput(purpose, scenarioId)), signal: controller.signal,
      });
      if (!response.ok) throw new Error("Decision unavailable");
      const data: unknown = await response.json();
      if (!isDecision(data)) throw new Error("Invalid decision");
      if (activeRequest.current !== controller) return;
      setResult(data);
      if (data.verdict === "AUTO_ADAPT") setAvoided((count) => count + 1);
      if (scenarioId === "delay") setComparison((previous) => ({ ...previous, [purpose]: data.verdict }));
    } catch {
      if (activeRequest.current === controller && !controller.signal.aborted) {
        setError("We couldn’t get a live decision. Please try again in a moment.");
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setLoading(false);
      }
    }
  }

  const chips: string[] = [scenarioId === "kitchen" ? "State is not verified" : "State verified", ...scenario.facts];
  if (scenarioId === "delay") chips.push(hard ? "Hard deadline · 12:30 PM" : "Soft deadline · flexible timing");
  if (result && result.policyReason !== "Instinct decision accepted" && !chips.includes(result.policyReason)) chips.push(result.policyReason);

  return (
    <div className="demo-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Intent Firewall home"><span className="brand-mark" aria-hidden="true">⌘</span> Intent Firewall</Link>
        <span className="powered"><span className="status-dot" /> Powered by ZooWork Instinct</span>
      </header>
      <main className="demo-main">
        <section className="intro">
          <div><span className="eyebrow">THE RESTAURANT’S AGENT · LIVE DEMO</span><h1>Same change.<br /><span>Different intent.</span></h1><p>Resolve harmless order changes automatically.<br className="desktop-break" /> Interrupt the customer only when intent is at risk.</p></div>
          <div className="avoided"><span className="avoided-icon" aria-hidden="true">↗</span><strong>{avoided}</strong><span>Customer interruptions<br />avoided</span><small>This demo session</small></div>
        </section>

        <section className="intent-card" aria-labelledby="intent-title">
          <div className="intent-heading"><div><span className="step">01</span><h2 id="intent-title">The Intent Record</h2></div><span className="origin">Sent with the order by the shopper agent</span></div>
          <div className="intent-content">
            <div className="purpose-field"><span className="field-label">PURPOSE · SWITCH TO COMPARE</span><div className="purpose-switch" role="group" aria-label="Customer purpose">{(["Client meeting", "Casual team lunch"] as const).map((item) => <button key={item} type="button" aria-pressed={purpose === item} onClick={() => { if (item !== purpose) { clearDecision(); setPurpose(item); } }}>{item}</button>)}</div><small>{hard ? "Timing is a promise. The meeting can’t wait." : "Timing is a preference. Lunch can wait a little."}</small></div>
            <dl className="intent-facts"><div><dt>PARTY SIZE</dt><dd>4 people</dd></div><div><dt>DELIVERY DEADLINE</dt><dd>12:30 PM <span className={`deadline-tag ${hard ? "hard" : "soft"}`}>{hard ? "Hard" : "Soft"}</span></dd></div><div><dt>BUDGET</dt><dd>$60 maximum</dd></div><div><dt>PREFERENCE</dt><dd>Sparkling water</dd></div></dl>
          </div>
        </section>

        <section className="scenario-section" aria-labelledby="scenario-title">
          <div className="section-heading"><div><span className="step">02</span><h2 id="scenario-title">The restaurant needs to make a change</h2></div><span>Choose a real-world hiccup</span></div>
          <div className="scenario-grid">{scenarios.map((item) => <button key={item.id} type="button" className={`scenario-card ${scenarioId === item.id ? "selected" : ""}`} aria-pressed={scenarioId === item.id} onClick={() => { if (item.id !== scenarioId) { clearDecision(); setScenarioId(item.id); } }}><div className="scenario-top"><span className="scenario-icon" aria-hidden="true">{item.icon}</span><span className="scenario-number">{item.number}</span><span className="selection-dot" aria-hidden="true" /></div><h3>{item.title}</h3><p>{item.description}</p><div className="change-line"><span>FROM</span><strong>{item.original}</strong></div><div className="change-line proposed"><span>TO</span><strong>{item.proposed}</strong></div></button>)}</div>
        </section>

        <section className="decision-section" aria-labelledby="decision-title">
          <div className="section-heading decision-heading"><div><span className="step">03</span><h2 id="decision-title">Protect the intent. Keep things moving.</h2></div><button className="run-button" type="button" disabled={loading} onClick={runDecision}>{loading ? <><span className="spinner" /> Evaluating intent…</> : <>{error ? "Try again" : result ? "Run again" : "Run live decision"}<span aria-hidden="true">↗</span></>}</button></div>
          <div className="comparison-grid">
            <article className="typical-flow"><div className="panel-label"><span>Typical flow</span><span className="panel-tag">EVERY CHANGE</span></div><div className="interruption-icon" aria-hidden="true">!</div><h3>Customer approval required</h3><p>A change happened. Send it back to the customer.</p><div className="flow-footer"><span className="small-dot" />Customer interrupted</div></article>
            <article className={`firewall-flow ${result ? `verdict-${result.verdict.toLowerCase()}` : ""}`} aria-busy={loading}>
              <div className="panel-label"><span><span className="mini-mark" aria-hidden="true">⌘</span> Intent Firewall</span><span className="panel-tag">{result ? "LIVE RESULT" : "INTENT AWARE"}</span></div>
              <div className="result-content" role="status" aria-live="polite">{loading ? <><div className="verdict-title loading-title">Checking intent<span className="loading-dots">…</span></div><p>Evaluating the change against {purpose.toLowerCase()} intent.</p></> : error ? <><h3 className="error-title">Let’s try that again.</h3><p>{error}</p></> : result ? <><div className="verdict-title final-verdict">{displayVerdict(result.verdict)}</div><h3 className="final-policy-reason">{result.policyReason}</h3><p>{verdictCopy[result.verdict].description}</p></> : <><div className="verdict-title waiting-title">Intent comes first.</div><p>Run a live decision to see which changes need the customer’s attention.</p></>}</div>
              <div className="flow-footer">{result ? verdictCopy[result.verdict].title : "One change. The customer’s purpose makes the difference."}</div>
            </article>
          </div>
          <div className="reason-chips" aria-label="Scenario facts and policy reasons">{chips.map((chip) => <span key={chip}><span aria-hidden="true">{chip === "State is not verified" ? "○" : "·"}</span>{chip}</span>)}</div>
          {scenarioId === "delay" && <section className={`purpose-comparison ${comparisonComplete ? "comparison-complete" : ""}`} aria-label="Live results by purpose" aria-live="polite"><div className="comparison-caption"><strong>{comparisonComplete ? "Same change. Different purpose." : "Same 15-minute delay. Two different purposes."}</strong><span>{comparisonComplete ? "12:30 PM → 12:45 PM · Only the customer’s purpose changed." : "Run both purposes to compare their actual live results."}</span></div><div className="purpose-result"><span>Client meeting</span><strong className={comparison["Client meeting"] ? `comparison-verdict outcome-${comparison["Client meeting"].toLowerCase()}` : ""}>{comparison["Client meeting"] ? displayVerdict(comparison["Client meeting"]) : "Not run yet"}</strong></div>{comparisonComplete && <span className="comparison-arrow" aria-hidden="true">→</span>}<div className="purpose-result"><span>Casual team lunch</span><strong className={comparison["Casual team lunch"] ? `comparison-verdict outcome-${comparison["Casual team lunch"].toLowerCase()}` : ""}>{comparison["Casual team lunch"] ? displayVerdict(comparison["Casual team lunch"]) : "Not run yet"}</strong></div></section>}
          {result && <details className="decision-details" key={`${purpose}-${scenarioId}-${result.verdict}`}><summary>How this was decided <span>Policy + Instinct probabilities</span></summary><div className="details-content"><div className="policy-explanation"><span className="field-label">FINAL POLICY</span><strong>{result.policyReason}</strong><p>Instinct raw verdict: <b>{result.instinctVerdict}</b></p><p>Verification state: <b>{scenarioId === "kitchen" ? "unverified" : "verified"}</b></p><small>Automatic adaptation requires verified state and at least 80% AUTO_ADAPT confidence.</small></div><div className="probabilities" aria-label="Instinct outcome probabilities">{outcomes.map((outcome) => <div className="probability-row" key={outcome}><span>{outcome}</span><div className="probability-track"><div style={{ width: `${result.probabilities[outcome] * 100}%` }} /></div><strong>{(result.probabilities[outcome] * 100).toFixed(1)}%</strong></div>)}</div></div></details>}
        </section>
        <footer className="demo-footer"><span>Less friction. More intention.</span><span>Shopper agent <span aria-hidden="true">→</span> Intent Record <span aria-hidden="true">→</span> Restaurant’s Intent Firewall</span></footer>
      </main>
    </div>
  );
}
