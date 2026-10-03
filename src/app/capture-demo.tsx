"use client";

import { useEffect, useRef, useState } from "react";
import { displayVerdict, isDecision, isRecord, type Decision, type Verdict } from "../lib/decision";
import { decisionInput, type Purpose } from "../lib/demo";
import DecisionReceipt from "./decision-receipt";

const labels: Record<Verdict, string> = { ASK: "Customer decision needed", AUTO_ADAPT: "Resolved automatically", HOLD: "Waiting for verification", BLOCK: "Change cannot proceed" };
const titles = ["An AI shopper places the order.", "The restaurant receives the order — and the reason behind it.", "The restaurant is running 15 minutes late.", "Intent Firewall checks the change against what the customer meant.", "This change breaks the customer’s intent.", "Now change only the customer’s purpose.", "The same change. A new decision.", "Same change. Different intent. Different decision."];
const meeting: Purpose = "Client meeting";
const lunch: Purpose = "Casual team lunch";

export default function CaptureDemo({ onExit }: { onExit: () => void }) {
  const [step, setStep] = useState(1);
  const [decisions, setDecisions] = useState<Partial<Record<Purpose, Decision>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const cache = useRef(new Map<Purpose, Decision>());
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const purpose = step >= 6 ? lunch : meeting;
  const decision = decisions[purpose];

  function cancel() { active.current?.abort(); active.current = null; setLoading(false); setError(""); }
  function reset() { cancel(); cache.current.clear(); setDecisions({}); setStep(1); }
  async function evaluate(selectedPurpose: Purpose) {
    if (cache.current.has(selectedPurpose) || active.current) return;
    const controller = new AbortController(); active.current = controller; setLoading(true); setError("");
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 40_000);
    try {
      const response = await fetch("/api/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(decisionInput(selectedPurpose, "delay")), signal: controller.signal });
      const data: unknown = await response.json();
      if (!response.ok) throw new Error(isRecord(data) && data.code === "RATE_LIMITED" ? "The live service is busy. Wait a moment and retry." : "The live decision service is unavailable. Please retry.");
      if (!isDecision(data)) throw new Error("The live service returned an incomplete decision. Please retry.");
      if (active.current !== controller || controller.signal.aborted) return;
      cache.current.set(selectedPurpose, data); setDecisions((previous) => ({ ...previous, [selectedPurpose]: data }));
    } catch (failure) {
      if (active.current === controller) setError(timedOut ? "The live decision took too long. Please retry." : failure instanceof Error && failure.name !== "TypeError" && !(failure instanceof SyntaxError) ? failure.message : "We couldn’t reach the live service. Check your connection and retry.");
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setLoading(false); }
    }
  }
  function go(next: number) {
    if (loading || next < 1 || next > 8) return;
    setError(""); setStep(next);
    if (next === 5 || next === 7) void evaluate(next === 5 ? meeting : lunch);
  }
  const ready = !loading && !error && ((step !== 5 && step !== 7) || !!decision);
  const resolved = decision?.verdict === "AUTO_ADAPT";
  const status = step <= 2 ? "ACCEPTED" : step <= 4 || step === 6 ? "CHANGE PROPOSED" : loading ? "EVALUATING INTENT" : error ? "DECISION UNAVAILABLE" : decision ? ({ ASK: "PAUSED FOR CUSTOMER", AUTO_ADAPT: "UPDATED", HOLD: "WAITING FOR VERIFICATION", BLOCK: "CHANGE BLOCKED" }[decision.verdict]) : "CHANGE PROPOSED";

  function verdictPanel(result: Decision) {
    return <div className={`capture-verdict verdict-${result.verdict.toLowerCase()}`}><strong className="final-verdict">{displayVerdict(result.verdict)}</strong><h3>{labels[result.verdict]}</h3><p>{result.policyReason}</p></div>;
  }
  function checks() {
    return <ul className="capture-checks"><li>✓ Purpose: {purpose.toLowerCase()}</li><li>✓ {purpose === meeting ? "Hard deadline: 12:30 PM" : "Timing is soft · 15-minute flexibility"}</li><li>✓ Merchant change verified</li><li>{purpose === meeting ? "! New ETA misses the deadline" : resolved ? "✓ Intent preserved" : "✓ Same food, quantity and price"}</li></ul>;
  }

  return <div className="demo-shell capture-demo"><header className="topbar"><button className="brand" type="button" onClick={() => { cancel(); onExit(); }}><span className="brand-mark" aria-hidden="true">⌘</span>Intent Firewall</button><span className="powered"><span className="status-dot" />Powered by ZooWork Instinct</span></header>
    <main className="capture-main"><nav className="capture-controls" aria-label="Presentation controls"><span className="capture-step" aria-live="polite">Step {step} of 8</span><div><button className="mode-link previous-step" disabled={step === 1 || loading} onClick={() => go(step - 1)}>Previous</button><button className="run-button next-step" disabled={step === 8 || !ready} onClick={() => go(step + 1)}>Next step <span aria-hidden="true">→</span></button><button className="mode-link capture-reset" onClick={reset}>Reset</button><button className="mode-link capture-exit" onClick={() => { cancel(); onExit(); }}>Exit demo</button></div></nav>
      <section className={`capture-frame capture-step-${step}`} key={step} aria-label={`Presentation step ${step}`}><span className="eyebrow">{step === 1 ? "SHOPPER AGENT" : step === 2 ? "ORDER + INTENT RECORD" : step === 3 ? "RESTAURANT FULFILLMENT" : step === 6 ? "ONLY THE PURPOSE CHANGES" : step === 8 ? "INTENT FIREWALL" : "SEMANTIC DECISION · ZOOWORK INSTINCT"}</span><h1>{step === 7 && resolved ? "The exact same restaurant change can now be resolved automatically." : titles[step - 1]}</h1>
      {step === 1 ? <div className="shopper-stage"><div className="shopper-emblem" aria-hidden="true">↗</div><h2>Shopper Agent</h2><p>Ordering lunch for a client meeting</p><dl className="order-facts"><div><dt>Purpose</dt><dd>Client meeting</dd></div><div><dt>Meeting</dt><dd>12:30 PM</dd></div><div><dt>For</dt><dd>4 people</dd></div></dl><span className="capture-record">ORDER + INTENT RECORD → RESTAURANT</span></div> : step === 8 ? <>
        <div className="capture-hero"><div><span className="field-label">CLIENT MEETING</span><p>12:30 → 12:45</p>{decisions[meeting] && verdictPanel(decisions[meeting]!)}</div><span className="hero-arrow" aria-hidden="true">→</span><div><span className="field-label">CASUAL TEAM LUNCH</span><p>12:30 → 12:45</p>{decisions[lunch] && verdictPanel(decisions[lunch]!)}</div></div><p className="capture-takeaway">Intent Firewall resolves harmless changes and escalates only when the customer’s intent is actually at risk.</p><span className="powered capture-sponsor">Powered by ZooWork Instinct</span>
      </> : <div className="capture-story"><article className="order-card"><header><span className="field-label">ORDER #1842</span><span className="order-status" data-verdict={step === 5 || step === 7 ? decision?.verdict : undefined}>{status}</span></header><p className="placed-by">Shopper Agent → Restaurant</p><span className="capture-record">ORDER + INTENT RECORD</span><div className="context-intent"><span className="field-label">PURPOSE</span><h2>{purpose}</h2>{step === 6 && <p className="intent-rewind">Client meeting → Casual team lunch<br />Hard deadline → Soft timing preference</p>}</div><dl className="order-facts"><div><dt>For</dt><dd>4 people</dd></div><div><dt>Delivery</dt><dd>{step === 7 && resolved ? "12:45 PM" : "12:30 PM"}</dd></div><div><dt>Budget</dt><dd>$60 max</dd></div></dl><div className="order-items"><span>4 Mediterranean bowls</span><span>4 sparkling waters</span></div>{step === 7 && resolved && <p className="order-outcome">Customer interruption: None</p>}</article><div className="capture-action">{step === 2 ? <><h2>Accepted by the restaurant.</h2><p>The order says what to deliver.<br />The Intent Record says why it matters.</p></> : <><span className="field-label">DELIVERY DELAY · VERIFIED</span><p className="capture-delay">12:30 PM → 12:45 PM</p>{step === 3 ? <p>The same meal. The same quantity.<br />But a different arrival time.</p> : step === 6 ? <><h2>The merchant change stays exactly the same.</h2><p>Same food. Same quantity. Same price.<br />Only the customer’s purpose changes.</p></> : <>{step === 4 && <><h2>Intent Firewall</h2><p>Evaluating change…</p></>}{(step === 4 || step === 7) && checks()}{loading ? <p className="capture-loading" role="status">Evaluating with the live decision service…</p> : error ? <div className="capture-error" role="alert"><h2>Decision service unavailable</h2><p>{error}</p><button className="run-button retry-decision" onClick={() => evaluate(purpose)}>Retry decision</button></div> : (step === 5 || step === 7) && decision ? verdictPanel(decision) : null}{step === 5 && decision?.verdict === "ASK" && <p>The client meeting starts at 12:30 PM.</p>}</>}</>}</div></div>}
      </section>
      {(step === 5 || step === 7) && decision && <DecisionReceipt result={decision} purpose={purpose} scenarioId="delay" />}
    </main></div>;
}
