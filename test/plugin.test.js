// Plugin-level tests: hooks and events as opencode 1.19.5 sends them.
import { test } from "node:test"
import assert from "node:assert/strict"
import { SubagentCap } from "../index.js"

process.env.OPENCODE_SUBAGENT_MAX = "1"
const within = (p, ms = 200) =>
  Promise.race([p.then(() => "ran"), new Promise((r) => setTimeout(() => r("still waiting"), ms))])
const partEvent = (callID, status, id = "prt_x", sessionID = "S") => ({
  event: { type: "message.part.updated", properties: { part: { id, sessionID, type: "tool", tool: "task", callID, state: { status } } } },
})
const topClient = { session: { get: async () => ({ data: { parentID: undefined } }) } }

// --- Finding 1: slash-command subtask path keys hooks by part.id, events by part.callID (prompt.ts:288,309,330,391)
test("F1 subtask path: Esc during a /command subtask frees its slot", async () => {
  const h = await SubagentCap({ client: topClient })
  // prompt.ts:307-311 before hook with callID: part.id
  await h["tool.execute.before"]({ tool: "task", sessionID: "S", callID: "prt_1" }, { args: {} })
  // prompt.ts:362-374 onInterrupt marks the part error; part.callID is a ulid (prompt.ts:288); after hook never runs
  await h.event(partEvent("01JULIDCALL", "error", "prt_1"))
  const next = h["tool.execute.before"]({ tool: "task", sessionID: "S", callID: "call_2" }, { args: {} })
  assert.equal(await within(next), "ran")
})
test("F1 comparison: Esc during a model task call frees its slot", async () => {
  const h = await SubagentCap({ client: topClient })
  await h["tool.execute.before"]({ tool: "task", sessionID: "S", callID: "call_1" }, { args: {} })
  await h.event(partEvent("call_1", "error")) // processor.ts:592-605, callID = toolCallId (processor.ts:242)
  const next = h["tool.execute.before"]({ tool: "task", sessionID: "S", callID: "call_2" }, { args: {} })
  assert.equal(await within(next), "ran")
})

// --- Finding 2: parent lookup failure -> nested call treated as top-level -> waits on its own parent's slot
test("F2 nested call whose parent lookup fails does not wait for a slot", async () => {
  const client = { session: { get: async ({ path }) => (path.id === "child" ? { error: { status: 500 } } : { data: {} }) } }
  const h = await SubagentCap({ client })
  await h["tool.execute.before"]({ tool: "task", sessionID: "top", callID: "c1" }, { args: {} }) // parent holds the only slot
  const nested = h["tool.execute.before"]({ tool: "task", sessionID: "child", callID: "c2" }, { args: {} })
  assert.equal(await within(nested), "ran") // otherwise: parent waits for child, child waits for parent's slot
})
test("F2b a failed lookup is not cached: a later nested call runs once the lookup recovers", async () => {
  let fail = true
  const client = { session: { get: async ({ path }) => { if (path.id === "child" && fail) throw new Error("busy"); return { data: path.id === "child" ? { parentID: "top" } : {} } } } }
  const h = await SubagentCap({ client })
  const first = h["tool.execute.before"]({ tool: "task", sessionID: "child", callID: "n1" }, { args: {} })
  await first
  await h["tool.execute.after"]({ tool: "task", sessionID: "child", callID: "n1" })
  fail = false
  await h["tool.execute.before"]({ tool: "task", sessionID: "top", callID: "c1" }, { args: {} })
  const nested = h["tool.execute.before"]({ tool: "task", sessionID: "child", callID: "n2" }, { args: {} })
  assert.equal(await within(nested), "ran")
})
test("F2 comparison: nested call with a working lookup does not wait", async () => {
  const client = { session: { get: async ({ path }) => ({ data: path.id === "child" ? { parentID: "top" } : {} }) } }
  const h = await SubagentCap({ client })
  await h["tool.execute.before"]({ tool: "task", sessionID: "top", callID: "c1" }, { args: {} })
  const nested = h["tool.execute.before"]({ tool: "task", sessionID: "child", callID: "c2" }, { args: {} })
  assert.equal(await within(nested), "ran")
})

// --- Finding 3 (conditional on provider ids): callID is the only key, across sessions and turns
test("F3 a reused callID after a normal completion is not refused", async () => {
  const h = await SubagentCap({ client: topClient })
  await h["tool.execute.before"]({ tool: "task", sessionID: "A", callID: "call_0" }, { args: {} })
  await h["tool.execute.after"]({ tool: "task", sessionID: "A", callID: "call_0" }) // tools.ts:120 after hook first
  await h.event(partEvent("call_0", "completed", "prt_x", "A")) // then the part completes -> goes to `ended`
  await assert.doesNotReject(h["tool.execute.before"]({ tool: "task", sessionID: "B", callID: "call_0" }, { args: {} }))
})
test("F3 comparison: a fresh callID after a normal completion runs", async () => {
  const h = await SubagentCap({ client: topClient })
  await h["tool.execute.before"]({ tool: "task", sessionID: "A", callID: "call_0" }, { args: {} })
  await h["tool.execute.after"]({ tool: "task", sessionID: "A", callID: "call_0" })
  await h.event(partEvent("call_0", "completed", "prt_x", "A"))
  await assert.doesNotReject(h["tool.execute.before"]({ tool: "task", sessionID: "B", callID: "call_1" }, { args: {} }))
})
