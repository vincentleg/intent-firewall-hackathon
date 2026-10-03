import { displayVerdict, outcomes, type Decision } from "../lib/decision";
import { decisionInput, scenarios, type Purpose, type ScenarioId } from "../lib/demo";

type Props = { result: Decision; purpose: Purpose; scenarioId: ScenarioId };

export default function DecisionReceipt({ result, purpose, scenarioId }: Props) {
  const scenario = scenarios.find((item) => item.id === scenarioId)!;
  const hard = purpose === "Client meeting";
  const input = decisionInput(purpose, scenarioId);
  const trays = scenarioId === "trays";
  return (
    <details className="decision-details" key={`${purpose}-${scenarioId}-${result.verdict}`}>
      <summary>How this was decided <span>Intent Record + policy + Instinct</span></summary>
      <div className="details-content">
        <div className="policy-explanation">
          <span className="field-label">FINAL DECISION · {displayVerdict(result.verdict)}</span>
          <strong>{result.policyReason}</strong>
          <p>Instinct raw verdict: <b>{result.instinctVerdict}</b></p>
          <p>Instinct choice confidence: <b>{(result.confidence * 100).toFixed(1)}%</b></p>
          <p>{result.verdict === result.instinctVerdict ? "The final decision agrees with Instinct." : "A deterministic guardrail changed Instinct’s decision."}</p>
          <dl className="receipt-facts">
            <div><dt>Customer purpose</dt><dd>{purpose}</dd></div>
            <div><dt>Verification state</dt><dd>{scenarioId === "kitchen" ? "unverified" : "verified"}</dd></div>
            <div><dt>Delivery constraint</dt><dd>12:30 PM · {hard ? "hard deadline" : "soft target; up to 15 minutes flexible"}</dd></div>
            <div><dt>Order constraints</dt><dd>4 people · $60 maximum · {trays ? "same meal, four servings" : "same sparkling water"}</dd></div>
            <div><dt>Merchant change</dt><dd>{scenario.original} → {scenario.proposed}</dd></div>
            <div><dt>Scenario facts used</dt><dd>{scenario.facts.join(" · ")}</dd></div>
          </dl>
          <div className="agent-context">
            <span className="field-label">AGENT CONTEXT</span>
            <dl className="receipt-facts">
              <div><dt>What the customer meant</dt><dd>{typeof input.intent === "object" ? String(input.intent.preferencesContext) : purpose}</dd></div>
              <div><dt>Important constraints</dt><dd>{result.constraintsPreserved.length ? result.constraintsPreserved.join(" · ") : "Preservation not established"}</dd></div>
              <div><dt>Constraints at risk</dt><dd>{result.constraintsAtRisk.length ? result.constraintsAtRisk.join(" · ") : "No identified hard constraint at risk"}</dd></div>
              <div><dt>Verified facts</dt><dd>{result.verifiedFacts.length ? result.verifiedFacts.join(" · ") : "No verified change facts"}</dd></div>
              {result.unverifiedFacts.length > 0 && <div><dt>Unverified facts</dt><dd>{result.unverifiedFacts.join(" · ")}</dd></div>}
            </dl>
          </div>
          {result.orchestration?.mode === "managed_agent" && <p className="receipt-note">Merchant agent session: ZooWork Managed Agent · {result.orchestration.resumed ? "resumed order context" : "new order context"} · {result.orchestration.history?.length ?? 0} recent decisions</p>}
          {result.orchestration?.mode === "direct_fallback" && <p className="receipt-note">Merchant agent unavailable. Evaluated directly with Instinct and the same policy guardrails.</p>}
          <small>Merchant attributes and verification are supplied demo facts. No real order is changed.</small>
        </div>
        <div className="receipt-evidence">
          <span className="field-label">INSTINCT PROBABILITY DISTRIBUTION</span>
          <div className="probabilities" aria-label="Instinct outcome probabilities">
            {outcomes.map((outcome) => (
              <div className="probability-row" key={outcome}>
                <span>{outcome}</span>
                <div className="probability-track"><div style={{ width: `${result.probabilities[outcome] * 100}%` }} /></div>
                <strong>{(result.probabilities[outcome] * 100).toFixed(1)}%</strong>
              </div>
            ))}
          </div>
          <span className="field-label">DETERMINISTIC GUARDRAILS</span>
          {result.policyChecks ? <ul className="policy-checks">{result.policyChecks.map((check) => (
            <li key={check.rule} data-status={check.status}>
              <strong>{check.rule}<span>{check.status.replace("_", " ")}</span></strong>
              <p>{check.detail}</p>
            </li>
          ))}</ul> : <p className="receipt-note">Unverified state → HOLD. Hard deadline miss → ASK. AUTO-ADAPT requires verified state and at least 80% confidence.</p>}
        </div>
      </div>
    </details>
  );
}
