// Review findings (2026-11-01): hooks and events as opencode 1.19.5 sends them (raw/opencode-src/v1.19.5).
import { test } from "node:test"
import assert from "node:assert/strict"
import { createGate } from "../gate.js"

process.env.OPENCODE_SUBAGENT_MAX = "1"
const { SubagentCap } = await import("../index.js")
const within = (p, ms = 200) =>
  Promise.race([p.then(() => "ran"), new Promise((r) => setTimeout(() => r("still waiting"), ms))])
const partEvent = (callID, status, id = "prt_x") => ({
  event: { type: "message.part.updated", properties: { part: { id, type: "tool", tool: "task", callID, state: { status } } } },
})
const topClient = { session: { get: async () => ({ data: { parentID: undefined } }) } }
const idle = (h, sessionID = "S") => h.event({ event: { type: "session.idle", properties: { sessionID } } })
const before = (h, callID, sessionID = "S") => h["tool.execute.before"]({ tool: "task", sessionID, callID }, { args: {} })
const after = (h, callID, sessionID = "S") => h["tool.execute.after"]({ tool: "task", sessionID, callID })

// R1 (kind 3+1): reused callID. A finishes the normal way (after hook, then completed event,
// session/tools.ts:120-128); the second release lands on B's slot while B still runs.
test("R1 reused callID: A's after hook + completed event leave B's slot counted", async () => {
  const g = createGate(2)
  await g.acquire("call_0"); await g.acquire("call_0") // sessions A and B, same provider id
  g.release("call_0"); g.release("call_0", "completed") // A only
  assert.equal(g.stats().running, 1) // B is still running
})
test("R1 comparison: distinct ids, A's after hook + completed event free one slot", async () => {
  const g = createGate(2)
  await g.acquire("a"); await g.acquire("b")
  g.release("a"); g.release("a", "completed")
  assert.equal(g.stats().running, 1)
})

// R2 (kind 4): /command subtask cancelled while queued. prompt.ts:307 awaits the hook via
// Effect.promise (plugin/index.ts:294, no signal); onInterrupt (prompt.ts:360) wraps only
// taskTool.execute, so no error event and no after hook: the waiter is later admitted for nobody.
test("R2 subtask cancelled while queued does not keep a slot forever", async () => {
  const h = await SubagentCap({ client: topClient })
  await before(h, "call_1")
  const queued = before(h, "prt_2", "S2").catch((e) => e) // subtask queued; user presses Esc; no part event for it
  await new Promise((r) => setTimeout(r, 10)) // it reaches the queue
  await idle(h, "S2") // the cancelled session's turn ends
  assert.match(String(await queued), /ended while it waited/)
  await after(h, "call_1"); await h.event(partEvent("call_1", "completed"))
  const next = before(h, "call_3")
  assert.equal(await within(next), "ran")
})
test("R2 comparison: model task call cancelled while queued frees its place", async () => {
  const h = await SubagentCap({ client: topClient })
  await before(h, "call_1")
  before(h, "call_2").catch(() => {})
  await h.event(partEvent("call_2", "error", "prt_2")) // processor.ts:591-605 cleanup marks it error
  await after(h, "call_1"); await h.event(partEvent("call_1", "completed"))
  const next = before(h, "call_3")
  assert.equal(await within(next), "ran")
})

// R3 (kind 4): /command subtask naming an unknown agent. prompt.ts:307 takes the slot, prompt.ts:313-318
// throws "Agent not found"; the part stays "running", no after hook, no event.
test("R3 subtask with an unknown agent gives back its slot", async () => {
  const h = await SubagentCap({ client: topClient })
  await before(h, "prt_1") // then throw: no after hook, no part event
  await idle(h) // the turn ends
  const next = before(h, "call_2")
  assert.equal(await within(next), "ran")
})
test("R3 comparison: subtask with a known agent gives back its slot", async () => {
  const h = await SubagentCap({ client: topClient })
  await before(h, "prt_1")
  await after(h, "prt_1"); await h.event(partEvent("01JULID", "completed", "prt_1"))
  const next = before(h, "call_2")
  assert.equal(await within(next), "ran")
})

test("Esc during the parent lookup: the call is refused, not queued for nobody", async () => {
  let answer
  const slow = { session: { get: () => new Promise((r) => (answer = r)) } }
  const h = await SubagentCap({ client: slow })
  const p = before(h, "prt_1", "S9").catch((e) => e)
  await idle(h, "S9") // turn ended while the lookup was out
  answer({ data: { parentID: undefined } })
  assert.match(String(await p), /ended while it waited/)
  const next = before(h, "call_2", "S8")
  answer({ data: { parentID: undefined } })
  assert.equal(await within(next), "ran")
})
test("Esc comparison: no idle during the lookup, the call takes its slot", async () => {
  let answer
  const slow = { session: { get: () => new Promise((r) => (answer = r)) } }
  const h = await SubagentCap({ client: slow })
  const p = before(h, "prt_1", "S7")
  answer({ data: { parentID: undefined } })
  assert.equal(await within(p), "ran")
})
