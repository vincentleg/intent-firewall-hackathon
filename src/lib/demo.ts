import type { DecisionInput } from "./decision";

export type Purpose = "Client meeting" | "Casual team lunch";
export type ScenarioId = "package" | "delay" | "kitchen";

export const scenarios = [
  { id: "package", number: "01", icon: "▦", title: "A different package", description: "Same water. Same quantity. Better price.", original: "4 sparkling waters", proposed: "2 twin-packs of the same water", facts: ["Same usable quantity", "Lower price · $1 cheaper"] },
  { id: "delay", number: "02", icon: "◷", title: "A little later", description: "15 minutes can change everything.", original: "Delivery at 12:30 PM", proposed: "Delivery at 12:45 PM", facts: ["Delivery delayed by 15 minutes"] },
  { id: "kitchen", number: "03", icon: "◎", title: "Ready. Or is it?", description: "The kitchen says yes. The scan is missing.", original: "Order marked ready", proposed: "Kitchen says ready; verification scan missing", facts: ["Verification scan missing"] },
] as const;

export function decisionInput(purpose: Purpose, scenario: ScenarioId): DecisionInput {
  const hard = purpose === "Client meeting";
  return {
    intent: {
      purpose, partySize: 4, budget: "$60 maximum", preference: "Same sparkling water, four usable servings",
      deadlineMeaning: hard ? "hard" : "soft",
      constraints: { budgetMaximum: 60, currency: "USD", usableServings: 4, product: "same sparkling water", softTimingFlexibilityMinutes: hard ? 0 : 15 },
      // Preserve compatibility with the deployed API as well as the local policy.
      ...(hard ? { hardDeadline: "12:30 PM" } : { preferredDeliveryTime: "12:30 PM" }),
      timingContext: hard ? "Food is needed for a client meeting; late delivery requires customer approval." : "A flexible team lunch; a 15-minute delay is acceptable if the order and budget are preserved.",
    },
    originalOrder: { sparklingWater: { packages: 4, servings: 4 }, totalPrice: 60, deliveryTime: "12:30 PM", kitchenState: "ready",
      merchant: { name: "Demo restaurant", evidenceSource: "Simulated merchant scenario; not an authenticated kitchen feed", attributes: { sparklingWaterPackageSizes: [1, 2], twinPackContainsSameProduct: true } },
    },
    proposedChange: scenario === "package"
      ? { sparklingWater: { packages: 2, packageType: "twin-pack", servings: 4, sameProduct: true }, totalPrice: 59, deliveryTime: "12:30 PM", scenarioFacts: ["Same product", "Same usable quantity: 4 servings", "Price decreases by $1", "Delivery time unchanged"] }
      : scenario === "delay"
        ? { deliveryTime: "12:45 PM", itemsUnchanged: true, totalPrice: 60, scenarioFacts: ["15-minute delay", "Products, quantity and price unchanged"] }
        : { kitchenState: "Kitchen says ready", verificationScan: "missing", itemsUnchanged: true, scenarioFacts: ["Kitchen reports ready", "Physical verification scan is missing"] },
    verificationState: scenario === "kitchen" ? "unverified" : "verified",
  };
}
