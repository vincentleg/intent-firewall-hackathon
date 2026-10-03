# Intent Firewall

**Same change. Different intent.**

A packaging substitution and a 15-minute delivery delay should not always trigger the same approval flow. Intent Firewall represents the restaurant’s agent: it evaluates merchant changes against the customer’s purpose and interrupts the customer only when their intent is at risk.

[Open the live demo](https://intent-firewall-hackathon.vercel.app)

## Try the key moment

1. Select **Client meeting** and **A little later**, then **Run live decision**: the 12:30 → 12:45 delivery misses a hard deadline, so the final verdict is **ASK**.
2. Switch to **Casual team lunch** and run the same change: timing is flexible, so **AUTO-ADAPT** is allowed if Instinct selects it with at least 80% confidence.
3. The comparison shows both actual live results. Open **How this was decided** for the receipt.

| Merchant change | Context | Expected behavior |
| --- | --- | --- |
| 4 waters → 2 twin-packs of the same water | Four usable servings, $1 cheaper, verified | AUTO_ADAPT if confidence permits |
| Delivery 12:30 → 12:45 | Client meeting; hard deadline | ASK; customer may approve |
| Same delivery delay | Casual lunch; soft target, 15-minute flexibility | Live result; AUTO_ADAPT if confidence permits |
| Kitchen says ready, scan missing | Unverified physical state | HOLD |

ASK and HOLD remain real live outcomes; the UI never substitutes a canned answer. BLOCK is supported for incompatible changes but is not forced by these three scenarios.

## Architecture

Shopper agent Intent Record → restaurant change → `POST /api/decision` → ZooWork Instinct → deterministic guardrails → final verdict and receipt.

- Next.js 16, React 19, TypeScript and CSS/Tailwind; no additional runtime libraries. Production builds use the supported webpack compiler to avoid a local Turbopack subprocess port-binding failure.
- Instinct evaluates exactly one choice question over AUTO_ADAPT, ASK, HOLD and BLOCK. It receives customer purpose, constraints, party size, budget, original order, proposed change, merchant attributes and verification state. See the [official API contract](https://api.zoowork.ai/docs/).
- The server reads `INSTINCT_API_KEY` and calls the free preview endpoint `https://api.zoowork.ai/v1/systemone` with model `instinct`. The key never enters client code.
- Guardrails require HOLD for unverified state, ASK for a missed hard deadline, and verified state plus at least 0.80 confidence for AUTO_ADAPT. An unreadable hard deadline disables automatic adaptation. Soft deadlines do not trigger the hard-deadline override.
- The API preserves `instinctVerdict`, `probabilities` and `raw`; it adds final `verdict`, `policyReason` and structured `policyChecks`. The UI shows a collapsed receipt rather than internal JSON.
- Requests have a 30-second upstream timeout, a 40-second browser timeout, cancellation on selection changes, response validation and an explicit retry state. Nothing is cached or fabricated as a live decision.
- The counter counts each successfully adapted purpose/scenario combination once per page session. Re-running that same demo change does not increment it again.

## Local setup

Use Node.js 22+ and npm.

```bash
npm ci
```

Create `.env.local` with the server-only environment variable **INSTINCT_API_KEY**, set to your free preview key. Do not prefix it with `NEXT_PUBLIC_` or commit the file. Configure the same variable in your deployment environment.

```bash
npm run dev
```

Open http://localhost:3000.

```bash
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm start
```

The tests use mocked upstream responses; they require neither credentials nor network access. Real demo runs require a working Instinct key.

## Scope and trust

Merchant attributes, orders and verification states are simulated scenario facts. Instinct decisions and probabilities are live. The demo evaluates changes; it does not actually change an order, send a notification or execute a refund.

The API accepts caller-supplied Intent Records; it is not an authenticated merchant attestation service. Clock-only deadlines assume the same delivery day. Supply explicit ISO timestamps with UTC offsets for dated comparisons. Production order processing would need authenticated records, durable decision history and infrastructure-level abuse controls. Those integrations are intentionally outside this gallery demo.

### Optional ZooWork merchant orchestration

The direct Instinct engine remains canonical. Managed-agent orchestration is **off by default** (`USE_ZOOWORK_AGENT=false`). Set server-only `ZOOWORK_API_KEY`, then run `node scripts/setup-merchant-agent.mjs` once. This provisions one **Intent Firewall Merchant Agent**, starts it, and saves `ZOOWORK_AGENT_ID` in ignored `.env.local` without enabling the flag. Node 20+ is required; the setup script's environment-file loading requires Node 20.12+.

When enabled, each order gets a persistent ZooWork session. The agent receives its Intent Record and merchant event and requests the application-executed `evaluate_intent_firewall` tool. The backend supplies immutable request facts to the existing Instinct/policy engine and records its exact result in the session. The UI receives that canonical result, a signed order-bound resume checkpoint, and the last five decision summaries. The same browser resumes the session for subsequent changes to that order; refreshing clears its in-memory resume handles. ZooWork's durable transcript retains the full event and tool-result history.

An agent failure or timeout uses the direct engine with an explicit fallback receipt. A request caches its evaluation so fallback cannot call Instinct twice after a tool already ran. Invalid/expired resume handles also fall back instead of trusting arbitrary session IDs. No order is actually changed. Do not enable production until its server-side key and agent ID are configured and the managed path is validated there. No customer authentication or production order storage is implemented by this demo.
