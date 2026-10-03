import { displayVerdict, outcomes, type Decision } from "../lib/decision";
import { scenarios, type Purpose, type ScenarioId } from "../lib/demo";

type Props = { result: Decision; purpose: Purpose; scenarioId: ScenarioId };

export default function DecisionReceipt({ result, purpose, scenarioId }: Props) {
  const scenario = scenarios.find((item) => item.id === scenarioId)!;
  const hard = purpose === "Client meeting";
  return (
    <details className="decision-details" key={`${purpose}-${scenarioId}-${result.verdict}`}>
      <summary>How this was decided <span>Intent Record + policy + Instinct</span></summary>
      <div className="details-content">
        <div className="policy-explanation">
          <span className="field-label">FINAL DECISION · {displayVerdict(result.verdict)}</span>
          <strong>{result.policyReason}</strong>
          <p>Instinct raw verdict: <b>{result.instinctVerdict}</b></p>
          <p>{result.verdict === result.instinctVerdict ? "The final decision agrees with Instinct." : "A deterministic guardrail changed Instinct’s decision."}</p>
          <dl className="receipt-facts">
            <div><dt>Customer purpose</dt><dd>{purpose}</dd></div>
            <div><dt>Verification state</dt><dd>{scenarioId === "kitchen" ? "unverified" : "verified"}</dd></div>
            <div><dt>Delivery constraint</dt><dd>12:30 PM · {hard ? "hard deadline" : "soft target; up to 15 minutes flexible"}</dd></div>
            <div><dt>Order constraints</dt><dd>4 people · $60 maximum · same sparkling water</dd></div>
            <div><dt>Merchant change</dt><dd>{scenario.original} → {scenario.proposed}</dd></div>
            <div><dt>Scenario facts used</dt><dd>{scenario.facts.join(" · ")}</dd></div>
          </dl>
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
