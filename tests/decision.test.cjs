const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { applyPolicy } = require("../src/lib/policy.ts");
const { isDecision, isDecisionInput } = require("../src/lib/decision.ts");
const { decisionInput } = require("../src/lib/demo.ts");
const { POST } = require("../src/app/api/decision/route.ts");
const originalFetch = global.fetch;
const originalKey = process.env.INSTINCT_API_KEY;
after(() => { global.fetch = originalFetch; if (originalKey === undefined) delete process.env.INSTINCT_API_KEY; else process.env.INSTINCT_API_KEY = originalKey; });
const probabilities = (p = .9) => ({ AUTO_ADAPT: p, ASK: (1-p)/3, HOLD: (1-p)/3, BLOCK: (1-p)/3 });
const policy = (input, verdict = "AUTO_ADAPT", p = .9) => applyPolicy(input, verdict, probabilities(p));
const request = (input = decisionInput("Client meeting", "delay")) => new Request("http://localhost/api/decision", { method: "POST", body: JSON.stringify(input) });

test("unverified physical state wins over any model outcome and missed deadline", () => {
  for (const verdict of ["AUTO_ADAPT", "ASK", "HOLD", "BLOCK"]) {
    const input = { ...decisionInput("Client meeting", "delay"), verificationState: "unverified" };
    assert.equal(policy(input, verdict).verdict, "HOLD");
  }
});
test("verified hard delay always asks, including when Instinct says BLOCK", () => {
  for (const verdict of ["AUTO_ADAPT", "ASK", "HOLD", "BLOCK"]) {
    const result = policy(decisionInput("Client meeting", "delay"), verdict);
    assert.equal(result.verdict, "ASK"); assert.equal(result.instinctVerdict, verdict);
    assert.equal(result.policyReason, "Hard delivery deadline would be missed");
  }
});
test("same delay with a soft constraint can adapt; generic deadline honors soft meaning", () => {
  const input = decisionInput("Casual team lunch", "delay");
  assert.equal(policy(input).verdict, "AUTO_ADAPT");
  input.intent.deadline = "12:30 PM";
  input.originalOrder.deadline = "12:30 PM";
  assert.equal(policy(input).verdict, "AUTO_ADAPT");
  input.intent.hardDeadline = "12:30 PM";
  assert.equal(policy(input).verdict, "ASK");
});
test("80% threshold is inclusive; low confidence asks", () => {
  const input = decisionInput("Client meeting", "package");
  assert.equal(policy(input, "AUTO_ADAPT", .8).verdict, "AUTO_ADAPT");
  assert.equal(policy(input, "AUTO_ADAPT", .799).verdict, "ASK");
  for (const verdict of ["ASK", "HOLD", "BLOCK"]) assert.equal(policy(input, verdict).verdict, verdict);
});
test("unreadable hard constraint prevents automatic adaptation", () => {
  const input = decisionInput("Client meeting", "delay");
  input.intent.hardDeadline = "lunchtime";
  assert.equal(policy(input).verdict, "ASK");
  input.intent.other = { hardDeadline: "12:30 PM" };
  assert.equal(policy(input).verdict, "ASK");
  input.proposedChange.deliveryTime = "later";
  assert.equal(policy(input).verdict, "ASK");
});
test("clock boundary, noon, midnight and offset timestamps compare correctly", () => {
  for (const [deadline, delivery, expected] of [
    ["12:30 PM", "12:30 PM", "AUTO_ADAPT"], ["12:30 PM", "12:29 PM", "AUTO_ADAPT"],
    ["12:00 AM", "12:01 AM", "ASK"], ["11:59 AM", "12:00 PM", "ASK"],
    ["2026-10-03T12:30:00-07:00", "2026-10-03T19:45:00Z", "ASK"],
    ["2026-10-03T12:30:00-07:00", "12:45 PM", "ASK"],
  ]) {
    const input = decisionInput("Client meeting", "delay");input.intent.hardDeadline = deadline;input.proposedChange.deliveryTime = delivery;
    assert.equal(policy(input).verdict, expected);
  }
});
test("labeled text input remains supported", () => {
  const input = { intent: "Client meeting; hard deadline: 12:30 PM", originalOrder: "Delivery 12:30 PM", proposedChange: "Proposed delivery: 12:45 PM", verificationState: "verified" };
  assert.equal(policy(input).verdict, "ASK");
});
test("response validation rejects invalid verdicts and malformed distributions", () => {
  const valid = policy(decisionInput("Casual team lunch", "delay"));
  assert.ok(isDecision(valid));
  for (const changes of [{ verdict: "OTHER" }, { probabilities: { ...probabilities(), ASK: NaN } }, { probabilities: probabilities(.9), policyChecks: [{}] }, { probabilities: { AUTO_ADAPT: 1, ASK: 1, HOLD: 1, BLOCK: 1 } }]) assert.ok(!isDecision({ ...valid, ...changes }));
  assert.ok(!isDecisionInput({ ...decisionInput("Client meeting", "delay"), verificationState: { status: "verified" } }));
  assert.ok(!isDecisionInput({ ...decisionInput("Client meeting", "delay"), verificationState: { toString: "verified" } }));
});
test("route authenticates server-side and returns one choice plus honest policy receipt", async () => {
  process.env.INSTINCT_API_KEY = "test-only-key";
  const raw = { answers: { decision: { choice: "AUTO_ADAPT", probabilities: probabilities(.95) } }, usage: {} };
  global.fetch = async (url, options) => {
    assert.equal(url, "https://api.zoowork.ai/v1/systemone");
    assert.equal(options.headers.Authorization, "Bearer test-only-key");
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, "instinct");assert.deepEqual(Object.keys(payload.questions), ["decision"]);
    assert.deepEqual(Object.keys(payload.questions.decision.criteria), ["AUTO_ADAPT", "ASK", "HOLD", "BLOCK"]);
    assert.equal(JSON.parse(payload.state).intent.purpose, "Client meeting");
    return Response.json(raw);
  };
  const response = await POST(request());const data = await response.json();
  assert.equal(response.status, 200);assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(data.verdict, "ASK");assert.equal(data.instinctVerdict, "AUTO_ADAPT");assert.deepEqual(data.raw, raw);assert.deepEqual(data.probabilities, raw.answers.decision.probabilities);
  assert.ok(isDecision(data));assert.ok(!JSON.stringify(data).includes("test-only-key"));
});
test("route validates configuration, input, upstream failures and incomplete responses", async () => {
  delete process.env.INSTINCT_API_KEY;assert.equal((await POST(request())).status, 503);
  process.env.INSTINCT_API_KEY = "test-only-key";
  assert.equal((await POST(new Request("http://localhost/api/decision", {method:"POST",body:"{"}))).status, 400);
  assert.equal((await POST(request({}))).status, 400);
  assert.equal((await POST(request({ ...decisionInput("Client meeting", "delay"), verificationState:"pending" }))).status, 400);
  assert.equal((await POST(request({ ...decisionInput("Client meeting", "delay"), intent:"x".repeat(33000) }))).status, 413);
  for (const status of [401, 429, 500]) {
    global.fetch = async () => new Response("private upstream details", { status });
    const r = await POST(request());assert.equal(r.status, status === 429 ? 503 : 502);
    const body = await r.json();assert.equal(body.upstreamStatus,status);assert.ok(!JSON.stringify(body).includes("private"));
  }
  global.fetch = async () => Response.json({});assert.equal((await POST(request())).status, 502);
  global.fetch = async () => { throw Error("private network error"); };assert.equal((await POST(request())).status, 502);
});
test("upstream is aborted at the server deadline and on caller cancellation", async () => {
  process.env.INSTINCT_API_KEY = "test-only-key";
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback) => originalSetTimeout(callback, 5);
  global.fetch = async (url, { signal }) => new Promise((resolve, reject) => {
    if (signal.aborted) reject(new Error("aborted"));
    else signal.addEventListener("abort", () => reject(new Error("aborted")), { once:true });
  });
  try { const r = await POST(request());assert.equal(r.status,504);assert.equal((await r.json()).code,"TIMEOUT"); }
  finally { global.setTimeout = originalSetTimeout; }
  const controller = new AbortController();controller.abort();
  assert.equal((await POST(new Request("http://localhost/api/decision",{method:"POST",body:JSON.stringify(decisionInput("Client meeting","delay")),signal:controller.signal}))).status,502);
});

test("semantic serving format depends on explicit customer constraints", () => {
  const shared = policy(decisionInput("Shared team lunch", "trays"));
  assert.equal(shared.finalVerdict, "AUTO_ADAPT");
  assert.equal(shared.confidence, .9);
  assert.ok(shared.constraintsPreserved.some(fact => fact.includes("4 usable servings")));
  const desk = policy(decisionInput("Four separately labeled desk meals", "trays"));
  assert.equal(desk.verdict, "ASK");
  assert.equal(desk.instinctVerdict, "AUTO_ADAPT");
  assert.ok(desk.constraintsAtRisk.some(fact => fact.includes("recipient labels")));
  assert.equal(policy(decisionInput("Shared team lunch", "trays"), "ASK").verdict, "ASK");
});

test("hard budget, serving and dietary constraints override soft preferences", () => {
  for (const price of [61, "60", NaN, undefined]) {
    const input = decisionInput("Shared team lunch", "trays");
    input.proposedChange.totalPrice = price;
    assert.equal(policy(input).verdict, "ASK");
  }
  const input = decisionInput("Shared team lunch", "trays");
  input.proposedChange.servings = 3;
  assert.equal(policy(input).verdict, "ASK");
  input.proposedChange.servings = 4;
  input.intent.hardConstraints.dietaryRestrictions = ["vegetarian"];
  assert.equal(policy(input).verdict, "ASK");
  input.proposedChange.dietaryRestrictionsPreserved = ["vegetarian"];
  assert.equal(policy(input).verdict, "AUTO_ADAPT");
  input.verificationState = "unverified";
  const result = policy(input);
  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(result.verifiedFacts, []);
  assert.deepEqual(result.constraintsPreserved, []);
  assert.ok(result.unverifiedFacts.length > 0);
});

test("managed-agent configuration failure falls back to one canonical evaluation", async () => {
  const saved = { flag: process.env.USE_ZOOWORK_AGENT, key: process.env.ZOOWORK_API_KEY, agent: process.env.ZOOWORK_AGENT_ID };
  process.env.INSTINCT_API_KEY = 'test-only-key';
  process.env.USE_ZOOWORK_AGENT = 'true';
  delete process.env.ZOOWORK_API_KEY;
  let calls = 0;
  global.fetch = async () => { calls++; return Response.json({ answers: { decision: { choice: 'AUTO_ADAPT', probabilities: probabilities(.9) } } }); };
  try {
    const response = await POST(request(decisionInput('Casual team lunch', 'delay')));
    const data = await response.json();
    assert.equal(response.status, 200); assert.equal(data.verdict, 'AUTO_ADAPT');
    assert.equal(data.orchestration.mode, 'direct_fallback'); assert.equal(calls, 1);
    process.env.ZOOWORK_API_KEY = 'test-only-managed-key';
    process.env.ZOOWORK_AGENT_ID = 'agt_test';
    const invalid = await POST(request({ ...decisionInput('Client meeting', 'delay'), agentSessionToken: 'forged.token' }));
    const result = await invalid.json();
    assert.equal(result.verdict, 'ASK'); assert.equal(result.orchestration.mode, 'direct_fallback');
    assert.ok(!JSON.stringify(result).includes('test-only-managed-key'));
  } finally {
    for (const [name, value] of [['USE_ZOOWORK_AGENT', saved.flag], ['ZOOWORK_API_KEY', saved.key], ['ZOOWORK_AGENT_ID', saved.agent]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
