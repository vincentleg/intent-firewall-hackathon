import type { DecisionInput, IntentRecord } from "./decision";

export type Purpose = "Client meeting" | "Casual team lunch" | "Shared team lunch" | "Four separately labeled desk meals";
export type ScenarioId = "package" | "delay" | "kitchen" | "trays";

export const scenarios = [
  { id: "package", number: "01", icon: "▦", title: "A different package", description: "Same water. Same quantity. Better price.", original: "4 sparkling waters", proposed: "2 twin-packs of the same water", facts: ["Same usable quantity", "Lower price · $1 cheaper"] },
  { id: "delay", number: "02", icon: "◷", title: "A little later", description: "15 minutes can change everything.", original: "Delivery at 12:30 PM", proposed: "Delivery at 12:45 PM", facts: ["Delivery delayed by 15 minutes"] },
  { id: "kitchen", number: "03", icon: "◎", title: "Ready. Or is it?", description: "The kitchen says yes. The scan is missing.", original: "Order marked ready", proposed: "Kitchen says ready; verification scan missing", facts: ["Verification scan missing"] },
  { id: "trays", number: "04", icon: "▤", title: "Bowls or family trays?", description: "Four servings. Two ways to share them.", original: "4 individual Mediterranean bowls", proposed: "2 family trays · 4 servings", facts: ["Same meal and usable quantity", "Price unchanged", "Individual packaging and labels removed"] },
] as const;

export function purposeOptions(scenario: ScenarioId): Purpose[] {
  return scenario === "trays" ? ["Shared team lunch", "Four separately labeled desk meals"] : ["Client meeting", "Casual team lunch"];
}

export function decisionInput(purpose: Purpose, scenario: ScenarioId): DecisionInput {
  const hard = purpose === "Client meeting";
  const trays = scenario === "trays";
  const deskMeals = purpose === "Four separately labeled desk meals";
  const intent: IntentRecord = {
    purpose, partySize: 4, budget: { maximum: 60, currency: "USD" },
    hardConstraints: { maxTotalPrice: 60, minServings: 4,
      ...(trays ? { individuallyPackaged: deskMeals, separatelyLabeled: deskMeals } : { requiredProduct: "same sparkling water" }),
      dietaryRestrictions: [],
    },
    softPreferences: trays ? [deskMeals ? "Convenient desk delivery" : "Shared serving is welcome; family trays are acceptable"] : ["Sparkling water", "Preferred delivery at 12:30 PM"],
    deadline: "12:30 PM", deadlineMeaning: hard ? "hard" : "soft",
    dietaryContext: "No dietary restrictions supplied; do not infer allergies or dietary suitability.",
    preferencesContext: trays ? (deskMeals ? "Each person needs a separate labeled meal to eat at their desk; shared trays require approval." : "The team eats together; shared trays preserve the purpose when the same food and four servings are preserved.") : "Same sparkling water, four usable servings",
    originalOrderContext: trays ? (deskMeals ? "Four individual Mediterranean bowls, labeled for four recipients, $60 total." : "Four individual Mediterranean bowls for a shared team lunch, exactly four servings, $60 total. Individual packaging and labels are not required.") : "Four sparkling waters, four usable servings, $60 total.",
  };
  return {
    intent: { ...intent,
      ...(hard ? { hardDeadline: "12:30 PM" } : { preferredDeliveryTime: "12:30 PM" }),
      timingContext: hard ? "Food is needed for a client meeting; late delivery requires customer approval." : "A flexible team lunch; a 15-minute delay is acceptable if the order and budget are preserved.",
    },
    originalOrder: { ...(trays ? { meal: "Mediterranean bowls", servings: 4, individuallyPackaged: true, separatelyLabeled: deskMeals } : { sparklingWater: { packages: 4, servings: 4 } }), totalPrice: 60, deliveryTime: "12:30 PM", kitchenState: "ready",
      merchant: { name: "Demo restaurant", evidenceSource: "Simulated merchant scenario; not an authenticated kitchen feed", attributes: trays && !deskMeals ? { verificationState: "verified", cuisine: "Mediterranean", familyTrayServings: 2, sameUnderlyingMeal: true, dietaryCompatibilityUnchanged: true } : { sparklingWaterPackageSizes: [1, 2], twinPackContainsSameProduct: true } },
    },
    proposedChange: trays
      ? { ...(deskMeals ? {} : {
          cuisine: "Mediterranean", servingsPerTray: 2, usableServingsVerified: true,
          sameUnderlyingMeal: true, dietaryCompatibilityUnchanged: true,
          merchantAttributesVerified: true, individualLabelsRequired: false,
        }), meal: deskMeals ? "same meal" : "Same Mediterranean meal as the original bowls", packages: 2, packageType: "family tray", servings: 4, individuallyPackaged: false, separatelyLabeled: false, totalPrice: 60, deliveryTime: "12:30 PM", scenarioFacts: deskMeals
          ? ["Same meal", "Four usable servings", "Two shared family trays replace four individual bowls", "Individual packaging and labels removed", "Price and delivery unchanged"]
          : ["Original: four individual Mediterranean bowls", "Proposed: two family trays of the same underlying Mediterranean meal", "Each tray is verified to serve exactly two people; exactly four usable servings total", "Dietary compatibility is verified unchanged from the original meal; no new dietary suitability is inferred", "Total price remains $60, within the same $60 hard budget", "Delivery time unchanged at 12:30 PM", "No individual packaging or labeling requirement exists for this shared team lunch", "Merchant portion sizes and meal-equivalence attributes are verified within the simulated scenario"] }
      : scenario === "package"
      ? { sparklingWater: { packages: 2, packageType: "twin-pack", servings: 4, sameProduct: true }, totalPrice: 59, deliveryTime: "12:30 PM", scenarioFacts: ["Same product", "Same usable quantity: 4 servings", "Price decreases by $1", "Delivery time unchanged"] }
      : scenario === "delay"
        ? { deliveryTime: "12:45 PM", itemsUnchanged: true, totalPrice: 60, scenarioFacts: ["15-minute delay", "Products, quantity and price unchanged"] }
        : { kitchenState: "Kitchen says ready", verificationScan: "missing", itemsUnchanged: true, totalPrice: 60, scenarioFacts: ["Kitchen reports ready", "Physical verification scan is missing"] },
    verificationState: scenario === "kitchen" ? "unverified" : "verified",
  };
}
