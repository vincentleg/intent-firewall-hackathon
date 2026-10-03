# Intent Firewall

**Same change. Different intent.**

[Try the live demo](https://intent-firewall-hackathon.vercel.app)

Restaurants routinely need to change an order. Asking the customer about every harmless substitution creates unnecessary interruptions; approving every change ignores what the customer meant.

Intent Firewall evaluates the merchant’s change against the shopper’s Intent Record. It resolves harmless changes automatically and escalates when purpose or hard constraints are at risk.

## The two-minute demo

1. Click **Run live order demo**. It evaluates a 12:30 → 12:45 delay for a client meeting, then automatically changes only the purpose to casual team lunch and evaluates again. The live comparison reveals **ASK → AUTO-ADAPT** when confidence permits.
2. **Replay demo** runs fresh requests. **Pause/Resume** holds the presentation without repeating requests. **Restart** cancels and restarts the sequence; **Reset** clears results. A failed request stops the demo and offers **Retry decision**.
3. Choose **Explore manually** for compact purpose/change selectors. Test bowls → family trays with shared lunch versus separately labeled desk meals; individual packaging and labels are hard requirements for the latter.
4. Package changes preserve quantity and lower the price. Missing physical verification requires **HOLD**.

The guided story takes about 37 seconds with responsive upstream calls; slower calls extend it.
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
