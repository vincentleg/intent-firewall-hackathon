# Intent Firewall

**Same change. Different intent.**

[Try the live demo](https://intent-firewall-hackathon.vercel.app)

Restaurants routinely need to change an order. Asking the customer about every harmless substitution creates unnecessary interruptions; approving every change ignores what the customer meant.

Intent Firewall evaluates the merchant’s change against the shopper’s Intent Record. It resolves harmless changes automatically and escalates when purpose or hard constraints are at risk.

## The two-minute demo

1. **Client meeting + A little later:** delivery moves from 12:30 to 12:45. The hard deadline is missed → **ASK**.
2. Switch to **Casual team lunch**, keeping the same delay. Flexible timing allows **AUTO-ADAPT**, subject to the live confidence threshold.
3. Choose **Bowls or family trays?** Shared team lunch accepts two verified two-person trays; **four separately labeled desk meals** requires individual packaging and labels → **ASK**.
4. **A different package** preserves four waters and lowers the price. **Ready. Or is it?** has a missing scan → **HOLD**.

The comparison displays actual API results. No verdict is fabricated or replayed. Automatic adaptation requires a live AUTO_ADAPT choice with at least 80% confidence; live confidence can vary.

## Architecture

Shopper Agent → Intent Record → Restaurant Intent Firewall → ZooWork Instinct → Resolve or Escalate.

The Next.js server’s `POST /api/decision` sends one choice question to ZooWork Instinct at `https://api.zoowork.ai/v1/systemone`, using model `instinct`. Context includes purpose, hard constraints, soft preferences, original order, merchant change and verification facts. Instinct returns probabilities for AUTO_ADAPT, ASK, HOLD and BLOCK.

A deterministic policy layer remains authoritative:

- Unverified physical state → HOLD.
- Missed hard deadline → ASK, allowing the customer to approve.
- Hard budget, usable quantity, product identity and required packaging/labels take precedence over soft preferences.
- AUTO_ADAPT requires verified state and confidence ≥ 0.80.

The expandable receipt separates the model’s original choice from the final policy decision and shows evidence and constraints. Requests have timeouts, cancellation, double-click protection and visible retry states. The counter counts each adapted purpose/scenario combination once per page session.

**Production uses direct Instinct.** Managed-agent code remains experimental local work and is disabled in production; it is not part of the live architecture.

## Local setup

Use Node.js 22+ and npm:

```bash
npm ci
npm run dev
```

Before running, create ignored `.env.local` with the server-only **INSTINCT_API_KEY**. Never use a `NEXT_PUBLIC_` key or commit credentials. **USE_ZOOWORK_AGENT** controls experimental local orchestration and should remain disabled. **ZOOWORK_API_KEY** and **ZOOWORK_AGENT_ID** are only relevant to that local experiment; the live demo does not require them.

Open http://localhost:3000. Validate with:

```bash
npm run lint
npx tsc --noEmit --incremental false
npm test
npm run build
```

Tests mock upstream services and require no credentials. Live decisions need a valid Instinct key.

## Scope

Restaurant orders, merchant attributes and verification are simulated scenario facts; model decisions and probabilities are live. The demo evaluates changes without modifying orders or sending notifications. Caller-supplied records are not authenticated merchant attestations. Clock-only deadlines assume the same delivery day. Production order execution would require authenticated evidence, durable history and abuse controls.
