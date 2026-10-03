// Server-side orchestration only. Never import this module from a Client Component.
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { DecisionInput, Decision, Verdict } from "./decision";
import { isDecision, isRecord } from "./decision";

export type MerchantAgentReceipt = {
  mode: "managed_agent" | "direct_fallback";
  sessionToken?: string;
  sessionId?: string;
  resumed?: boolean;
  history?: { eventId: string; verdict: Verdict; policyReason: string }[];
};
type Checkpoint = {
  order: string; agentId: string; sessionId: string; cursor: string; expires: number;
  history: NonNullable<MerchantAgentReceipt["history"]>;
};
const activeSessions = new Set<string>();
const key = () => {
  const value = process.env.ZOOWORK_API_KEY;
  if (!value) throw new Error("Managed agent is not configured");
  return value;
};
export function orderFingerprint(input: DecisionInput) {
  return createHash("sha256").update(JSON.stringify([input.intent, input.originalOrder])).digest("hex");
}
function sign(checkpoint: Checkpoint) {
  const payload = Buffer.from(JSON.stringify(checkpoint)).toString("base64url");
  return `${payload}.${createHmac("sha256", key()).update(payload).digest("base64url")}`;
}
function restore(token: string | undefined, order: string, agentId: string): Checkpoint | undefined {
  if (!token) return undefined;
  if (token.length > 10000) throw new Error("Invalid order session");
  const [payload, signature, extra] = token.split(".");
  const expected = createHmac("sha256", key()).update(payload || "").digest();
  const actual = Buffer.from(signature || "", "base64url");
  if (extra || expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("Invalid order session");
  const checkpoint: Checkpoint = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (checkpoint.order !== order || checkpoint.agentId !== agentId || checkpoint.expires < Date.now()
    || !checkpoint.sessionId || !checkpoint.cursor || !Array.isArray(checkpoint.history)) throw new Error("Invalid order session");
  return checkpoint;
}

export async function evaluateMerchantChangeWithAgent(
  input: DecisionInput, evaluate: () => Promise<Response>, token?: string, signal?: AbortSignal,
): Promise<Response> {
  key();
  const agentId = process.env.ZOOWORK_AGENT_ID;
  if (!agentId) throw new Error("Merchant agent has not been provisioned");
  const order = orderFingerprint(input);
  const checkpoint = restore(token, order, agentId);
  const lock = checkpoint?.sessionId ?? order;
  if (activeSessions.has(lock)) throw new Error("Order evaluation already in progress");
  activeSessions.add(lock);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const timeout = setTimeout(cancel, 25000);
  let sessionId = checkpoint?.sessionId;
  let client: import("@zoowork-ai/sdk").ZooworkClient | undefined;
  let finished = false;
  try {
    const sdk = await import("@zoowork-ai/sdk");
    client = sdk.createZooworkClient({ fetch: (url, options) => fetch(url, {
      ...options, signal: options?.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal,
    }) });
    const eventId = randomUUID();
    const message = JSON.stringify({ type: "merchant_change", eventId, orderContext: { intent: input.intent, originalOrder: input.originalOrder }, change: input.proposedChange, verificationState: input.verificationState, recentDecisions: checkpoint?.history ?? [] });
    let inputEventId: string | undefined;
    if (checkpoint) {
      const session = await client.getSession(agentId, checkpoint.sessionId);
      if (session.metadata?.orderFingerprint !== order || session.run_status === "running" || session.archived) throw new Error("Order session is unavailable");
      const posted = await client.postEvents(agentId, checkpoint.sessionId, [{ type: "user.message", content: message, idempotency_key: eventId }]);
      const receipt = posted.events[0];
      if (receipt?.accepted !== true) throw new Error("Merchant event was not accepted");
      inputEventId = receipt.id ?? undefined;
    } else {
      const session = await client.createSession(agentId, { metadata: { orderFingerprint: order }, runtime_mode: "active", initial_events: [{ type: "user.message", content: message, idempotency_key: eventId }] }, eventId);
      sessionId = session.session_id;
    }
    let cursor = checkpoint?.cursor;
    let currentRun: string | undefined;
    let result: Decision & { raw?: unknown } | undefined;
    let responseStatus = 200;
    const handled = new Set<string>();
    for await (const event of client.streamEvents(agentId, sessionId!, { cursor, signal: controller.signal })) {
      if (event.eventType === "run.started" && (!checkpoint || event.payload.inboundMessageId === inputEventId)) currentRun = event.runId;
      const tool = sdk.customToolUse(event);
      if (tool?.phase === "requested" && tool.name === "evaluate_intent_firewall" && tool.input?.eventId === eventId && !handled.has(tool.callId)) {
        handled.add(tool.callId);
        currentRun = event.runId;
        const response = await evaluate();
        responseStatus = response.status;
        const data: unknown = await response.json();
        await client.resolveCustomToolCall(agentId, tool.callId, { content: [{ type: "json", value: data }], isError: !response.ok });
        if (!response.ok || !isDecision(data)) throw new Error("Canonical decision engine failed");
        result = data;
      }
      cursor = event.cursor ?? cursor;
      if (sdk.isRunFinished(event) && currentRun && event.runId === currentRun) {
        finished = true;
        if (sdk.runOutcome(event) !== "succeeded" || !result || !cursor) throw new Error("Merchant agent did not complete evaluation");
        const history = [...(checkpoint?.history ?? []), { eventId, verdict: result.verdict, policyReason: result.policyReason }].slice(-5);
        const sessionToken = sign({ order, agentId, sessionId: sessionId!, cursor, history, expires: Date.now() + 86400000 });
        return Response.json({ ...result, orchestration: { mode: "managed_agent", sessionId, sessionToken, resumed: !!checkpoint, history } satisfies MerchantAgentReceipt }, { status: responseStatus, headers: { "Cache-Control": "no-store" } });
      }
    }
    throw new Error("Merchant agent timed out or disconnected");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
    controller.abort();
    activeSessions.delete(lock);
    // Release a parked turn before taking the explicit direct fallback.
    if (!finished && client && sessionId) {
      const cleanup = (await import("@zoowork-ai/sdk")).createZooworkClient({ fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(2000) }) });
      await cleanup.postEvents(agentId, sessionId, [{ type: "user.interrupt", idempotency_key: randomUUID() }]).catch(() => {});
    }
  }
}

export function sessionTokenFromInput(input: unknown): string | undefined {
  return isRecord(input) && typeof input.agentSessionToken === "string" ? input.agentSessionToken : undefined;
}
