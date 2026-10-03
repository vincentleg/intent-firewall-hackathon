import { autoAdaptThreshold, isRecord, type Decision, type DecisionInput, type Probabilities, type Verdict } from "./decision";

type DeliveryTime = { kind: "clock" | "timestamp"; value: number };

function parseDeliveryTime(value: string): DeliveryTime | undefined {
  const text = value.trim();
  // Only compare explicit timestamps with offsets, or times on the same day.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) {
    const timestamp = Date.parse(text);
    return Number.isFinite(timestamp) ? { kind: "timestamp", value: timestamp } : undefined;
  }
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(text);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3]?.toUpperCase();
  if (minute > 59 || (period ? hour < 1 || hour > 12 : hour > 23)) return undefined;
  return { kind: "clock", value: (period ? hour % 12 + (period === "PM" ? 12 : 0) : hour) * 60 + minute };
}

function collectDeliveryTimes(value: unknown, role: "deadline" | "delivery", softDefault = false): DeliveryTime[] {
  const times: DeliveryTime[] = [];
  const fieldPattern = role === "deadline"
    ? /^(?:hard)?(?:delivery)?deadline(?:time)?$/
    : /^(?:proposed|new|estimated)?delivery(?:time|at)?$|^(?:new|proposed)?eta$|^arrival(?:time|at)?$/;
  const labelPattern = role === "deadline"
    ? /(?:hard\s+(?:delivery\s+)?deadline|must\s+(?:arrive|be\s+delivered)\s+by)\s*(?:is|at|by|:|=)?\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/gi
    : /(?:proposed\s+delivery|delivery(?:\s+time)?|arrival(?:\s+time)?|ETA)\s*(?:is|at|by|:|=)?\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/gi;

  function visit(item: unknown, field = "", soft = false) {
    if (typeof item === "string") {
      if (fieldPattern.test(field.replace(/[\s_-]/g, "").toLowerCase()) && !(role === "deadline" && soft && !/^hard/i.test(field))) {
        const time = parseDeliveryTime(item);
        if (time) times.push(time);
      }
      for (const match of item.matchAll(labelPattern)) {
        const time = parseDeliveryTime(match[1]);
        if (time) times.push(time);
      }
    } else if (Array.isArray(item)) {
      item.forEach((entry) => visit(entry, field, soft));
    } else if (isRecord(item)) {
      const meaning = typeof item.deadlineMeaning === "string" ? item.deadlineMeaning.toLowerCase() : undefined;
      const isSoft = meaning === "soft" || (meaning !== "hard" && soft);
      Object.entries(item).forEach(([key, entry]) => visit(entry, key, isSoft));
    }
  }

  visit(value, "", softDefault);
  return times;
}

function deliveryDeadlineStatus(input: DecisionInput): "clear" | "missed" | "unclear" {
  const soft = isRecord(input.intent) && input.intent.deadlineMeaning === "soft";
  const deadlines = collectDeliveryTimes([input.intent, input.originalOrder], "deadline", soft);
  const deliveries = collectDeliveryTimes(input.proposedChange, "delivery");
  // A bare proposed time is also unambiguous when a delivery deadline is supplied.
  if (typeof input.proposedChange === "string") {
    const time = parseDeliveryTime(input.proposedChange);
    if (time) deliveries.push(time);
  }
  if (deadlines.some((deadline) => deliveries.some(
    (delivery) => delivery.kind === deadline.kind && delivery.value > deadline.value,
  ))) return "missed";
  if (hasHardDeadline(input.intent) || hasHardDeadline(input.originalOrder, soft)) {
    if (hasUnparseableHardDeadline(input.intent) || hasUnparseableHardDeadline(input.originalOrder, soft) || !deadlines.length || !deliveries.length || deadlines.some((deadline) => !deliveries.some((delivery) => delivery.kind === deadline.kind))) return "unclear";
  }
  return "clear";
}

function hasHardDeadline(value: unknown, soft = false): boolean {
  if (typeof value === "string") return /hard\s+(?:delivery\s+)?deadline|must\s+(?:arrive|be\s+delivered)\s+by/i.test(value);
  if (Array.isArray(value)) return value.some((item) => hasHardDeadline(item, soft));
  if (!isRecord(value)) return false;
  const meaning = typeof value.deadlineMeaning === "string" ? value.deadlineMeaning.toLowerCase() : undefined;
  const isSoft = meaning === "soft" || (meaning !== "hard" && soft);
  return Object.entries(value).some(([key, item]) => {
    const field = key.replace(/[\s_-]/g, "").toLowerCase();
    return (/^(?:hard)?(?:delivery)?deadline(?:time)?$/.test(field) && (!isSoft || field.startsWith("hard"))) || hasHardDeadline(item, isSoft);
  });
}

function hasUnparseableHardDeadline(value: unknown, soft = false): boolean {
  if (Array.isArray(value)) return value.some((item) => hasUnparseableHardDeadline(item, soft));
  if (!isRecord(value)) return false;
  const meaning = typeof value.deadlineMeaning === "string" ? value.deadlineMeaning.toLowerCase() : undefined;
  const isSoft = meaning === "soft" || (meaning !== "hard" && soft);
  return Object.entries(value).some(([key, item]) => {
    const field = key.replace(/[\s_-]/g, "").toLowerCase();
    const hardField = /^(?:hard)?(?:delivery)?deadline(?:time)?$/.test(field) && (!isSoft || field.startsWith("hard"));
    return (hardField && (typeof item !== "string" || !parseDeliveryTime(item))) || hasUnparseableHardDeadline(item, isSoft);
  });
}

// Only explicit structured facts can establish a hard constraint as preserved.
function constraintEvidence(input: DecisionInput) {
  const intent: Record<string, unknown> = isRecord(input.intent) ? input.intent : {};
  const hard = isRecord(intent.hardConstraints) ? intent.hardConstraints : {};
  const legacy = isRecord(intent.constraints) ? intent.constraints : {};
  const budget = isRecord(intent.budget) ? intent.budget : {};
  const original = isRecord(input.originalOrder) ? input.originalOrder : {};
  const change = isRecord(input.proposedChange) ? input.proposedChange : {};
  const preserved: string[] = [], atRisk: string[] = [];
  let budgetRisk = false;
  const maximum = hard.maxTotalPrice ?? budget.maximum ?? legacy.budgetMaximum;
  if (maximum !== undefined) {
    const price = change.totalPrice;
    if (typeof maximum !== "number" || !Number.isFinite(maximum) || maximum < 0 || typeof price !== "number" || !Number.isFinite(price) || price < 0) {
      budgetRisk = true; atRisk.push("Hard budget could not be checked");
    } else if (price > maximum) {
      budgetRisk = true; atRisk.push(`Total price $${price} exceeds hard budget $${maximum}`);
    } else preserved.push(`Total price $${price} stays within $${maximum} budget`);
  }
  const servings = isRecord(change.sparklingWater) ? change.sparklingWater.servings : change.servings ?? (change.itemsUnchanged === true ? original.servings ?? (isRecord(original.sparklingWater) ? original.sparklingWater.servings : undefined) : undefined);
  const minimum = hard.minServings ?? legacy.usableServings;
  if (minimum !== undefined) {
    if (typeof minimum !== "number" || !Number.isFinite(minimum) || minimum < 1 || typeof servings !== "number" || !Number.isFinite(servings) || servings < minimum) atRisk.push("Required usable servings are reduced or not established");
    else preserved.push(`${servings} usable servings meet the party's needs`);
  }
  for (const [key, label] of [["individuallyPackaged", "Individual meal packaging"], ["separatelyLabeled", "Separate recipient labels"]] as const) {
    if (hard[key] === true) {
      const value = change[key] ?? (change.itemsUnchanged === true ? original[key] : undefined);
      if (value === true) preserved.push(`${label} preserved`);
      else atRisk.push(`${label} required but ${value === false ? "removed" : "not established"}`);
    }
  }
  if (hard.requiredProduct !== undefined) {
    if (change.itemsUnchanged === true || (isRecord(change.sparklingWater) && change.sparklingWater.sameProduct === true)) preserved.push("Required product identity preserved");
    else atRisk.push("Required product identity is not established");
  }
  if (Array.isArray(hard.dietaryRestrictions) && hard.dietaryRestrictions.length) {
    const confirmed = change.dietaryRestrictionsPreserved;
    for (const restriction of hard.dietaryRestrictions) {
      if (typeof restriction !== "string") { atRisk.push("Dietary constraint could not be checked"); continue; }
      if (change.itemsUnchanged === true || (Array.isArray(confirmed) && confirmed.includes(restriction))) preserved.push(`Dietary restriction preserved: ${restriction}`);
      else atRisk.push(`Dietary restriction not established: ${restriction}`);
    }
  }
  const facts = Array.isArray(change.scenarioFacts) ? change.scenarioFacts.filter((fact): fact is string => typeof fact === "string") : [];
  return { preserved, atRisk, budgetRisk, facts };
}

export function applyPolicy(input: DecisionInput, instinctVerdict: Verdict, probabilities: Probabilities): Decision {
  const deadline = deliveryDeadlineStatus(input);
  const evidence = constraintEvidence(input);
  const verified = input.verificationState === "verified";
  const confident = probabilities.AUTO_ADAPT >= autoAdaptThreshold;
  let verdict = instinctVerdict;
  let policyReason = "Instinct decision accepted";
  if (!verified) {
    verdict = "HOLD";
    policyReason = "State is not verified";
  } else if (deadline === "missed") {
    verdict = "ASK";
    policyReason = "Hard delivery deadline would be missed";
  } else if (instinctVerdict === "AUTO_ADAPT" && deadline === "unclear") {
    verdict = "ASK";
    policyReason = "Hard delivery deadline could not be checked";
  } else if (evidence.budgetRisk) {
    verdict = "ASK";
    policyReason = "Hard budget limit exceeded or could not be checked";
  } else if (evidence.atRisk.length) {
    verdict = "ASK";
    policyReason = evidence.atRisk[0];
  } else if (instinctVerdict === "AUTO_ADAPT" && !confident) {
    verdict = "ASK";
    policyReason = "AUTO_ADAPT confidence below 0.80";
  }
  return {
    verdict, finalVerdict: verdict, policyReason, instinctVerdict, probabilities,
    confidence: probabilities[instinctVerdict],
    constraintsPreserved: verified ? evidence.preserved : [],
    constraintsAtRisk: [...evidence.atRisk, ...(deadline === "missed" ? ["Hard delivery deadline would be missed"] : deadline === "unclear" ? ["Hard delivery deadline could not be checked"] : []), ...(!verified ? ["Physical state is not verified"] : [])],
    verifiedFacts: verified ? evidence.facts : [],
    unverifiedFacts: verified ? [] : evidence.facts,
    policyChecks: [
      { rule: "Verification", status: verified ? "passed" : "enforced", detail: verified ? "Merchant state supplied as verified" : "Unverified physical state must remain on hold" },
      { rule: "Hard deadline", status: deadline === "clear" ? "passed" : "enforced", detail: deadline === "missed" ? "Proposed delivery exceeds a hard deadline" : deadline === "unclear" ? "Hard timing constraint cannot be compared; automatic adaptation is disabled" : "No identified hard delivery deadline is missed" },
      { rule: "Hard order constraints", status: evidence.atRisk.length ? "enforced" : "passed", detail: evidence.atRisk.length ? evidence.atRisk.join("; ") : evidence.preserved.length ? evidence.preserved.join("; ") : "No structured hard order constraints supplied; semantic compatibility is evaluated by Instinct" },
      { rule: "Automatic adaptation", status: instinctVerdict !== "AUTO_ADAPT" ? "not_applicable" : confident ? "passed" : "enforced", detail: instinctVerdict !== "AUTO_ADAPT" ? "Instinct did not select AUTO_ADAPT" : `Instinct AUTO_ADAPT confidence ${(probabilities.AUTO_ADAPT * 100).toFixed(1)}%; minimum 80%` },
    ],
  };
}
