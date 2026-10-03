// Shared wire contract. No credentials or server configuration belong here.
export const outcomes = ["AUTO_ADAPT", "ASK", "HOLD", "BLOCK"] as const;
export type Verdict = (typeof outcomes)[number];
export const autoAdaptThreshold = 0.80;
export type Probabilities = Record<Verdict, number>;
export type PolicyCheck = { rule: string; status: "passed" | "enforced" | "not_applicable"; detail: string };
export type IntentRecord = {
  purpose: string;
  partySize: number;
  budget: { maximum: number; currency: "USD" };
  hardConstraints: {
    maxTotalPrice: number;
    minServings: number;
    requiredProduct?: string;
    individuallyPackaged?: boolean;
    separatelyLabeled?: boolean;
    dietaryRestrictions: string[];
  };
  softPreferences: string[];
  deadline: string;
  deadlineMeaning: "hard" | "soft";
  dietaryContext: string;
  preferencesContext: string;
  originalOrderContext: string;
};
export type Decision = {
  finalVerdict: Verdict;
  confidence: number;
  constraintsPreserved: string[];
  constraintsAtRisk: string[];
  verifiedFacts: string[];
  unverifiedFacts: string[];
  verdict: Verdict;
  policyReason: string;
  instinctVerdict: Verdict;
  probabilities: Probabilities;
  policyChecks?: PolicyCheck[];
};
export type DecisionInput = {
  intent: IntentRecord | string | Record<string, unknown>;
  originalOrder: string | Record<string, unknown>;
  proposedChange: string | Record<string, unknown>;
  verificationState: "verified" | "unverified";
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isVerdict(value: unknown): value is Verdict {
  return outcomes.some((outcome) => outcome === value);
}
export function isProbabilities(value: unknown): value is Probabilities {
  return isRecord(value) && outcomes.every((key) =>
    typeof value[key] === "number" && Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1,
  ) && Math.abs(outcomes.reduce((sum, key) => sum + Number(value[key]), 0) - 1) <= 0.01;
}
export function isDecision(value: unknown): value is Decision {
  return isRecord(value) && isVerdict(value.verdict) && isVerdict(value.instinctVerdict)
    && typeof value.policyReason === "string" && isProbabilities(value.probabilities)
    && value.finalVerdict === value.verdict && typeof value.confidence === "number"
    && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1
    && ["constraintsPreserved", "constraintsAtRisk", "verifiedFacts", "unverifiedFacts"].every((key) =>
      Array.isArray(value[key]) && value[key].every((fact: unknown) => typeof fact === "string"))
    && (value.policyChecks === undefined || (Array.isArray(value.policyChecks) && value.policyChecks.every((check) =>
      isRecord(check) && typeof check.rule === "string" && typeof check.detail === "string"
      && typeof check.status === "string" && ["passed", "enforced", "not_applicable"].includes(check.status),
    )));
}
export function isDecisionInput(value: unknown): value is DecisionInput {
  if (!isRecord(value) || typeof value.verificationState !== "string" || !["verified", "unverified"].includes(value.verificationState)) return false;
  return ["intent", "originalOrder", "proposedChange"].every((key) => {
    const field = value[key];
    return (typeof field === "string" && field.trim().length > 0) || (isRecord(field) && Object.keys(field).length > 0);
  });
}
export function displayVerdict(verdict: Verdict) {
  return verdict === "AUTO_ADAPT" ? "AUTO-ADAPT" : verdict;
}
