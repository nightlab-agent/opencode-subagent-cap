import { test } from "node:test"
import assert from "node:assert/strict"
import { createGate, readMax } from "../gate.js"
import { SubagentCap } from "../index.js"

const tick = () => new Promise((r) => setImmediate(r))
const topClient = { session: { get: async () => ({ data: {} }) } }
const before = (h, callID, sessionID = "S", args = {}) =>
  h["tool.execute.before"]({ tool: "task", callID, sessionID }, { args })
const after = (h, callID, sessionID = "S") =>
  h["tool.execute.after"]({ tool: "task", callID, sessionID })
const idle = (h, sessionID) => h.event({ event: { type: "session.idle", properties: { sessionID } } })

async function plugin(client = topClient, max = 1) {
  const previous = process.env.OPENCODE_SUBAGENT_MAX
  process.env.OPENCODE_SUBAGENT_MAX = String(max)
  try {
    return await SubagentCap({ client })
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_SUBAGENT_MAX
    else process.env.OPENCODE_SUBAGENT_MAX = previous
  }
}

for (const [name, childID] of [["reused id", "call_0"], ["comparison: distinct ids", "child_call"]]) {
  test(`R1 nested completion keeps the parent's slot: ${name}`, async () => {
    const client = { session: { get: async ({ path }) => ({ data: path.id === "child" ? { parentID: "top" } : {} }) } }
    const h = await plugin(client)
    await before(h, "call_0", "top")
    await before(h, childID, "child")
    await after(h, childID, "child")
    let admitted = false
    const queued = before(h, "next", "other").then(() => (admitted = true))
    await tick()
    const admittedBeforeParentFinished = admitted
    await after(h, "call_0", "top")
    await queued
    assert.equal(admittedBeforeParentFinished, false)
  })
}

for (const [name, secondID] of [["reused id", "call_0"], ["comparison: distinct ids", "call_1"]]) {
  test(`R2 both completion channels allow later id reuse: ${name}`, async () => {
    const g = createGate(2)
    await g.acquire("call_0", "A")
    await g.acquire(secondID, "B")
    g.release("call_0")
    g.release(secondID)
    g.release("call_0", "completed")
    g.release(secondID, "completed")
    await assert.doesNotReject(g.acquire("call_0", "C"))
  })
}

for (const [name, secondID] of [["reused id", "call_0"], ["comparison: distinct ids", "call_1"]]) {
  test(`R2 finishing session B leaves session A counted: ${name}`, async () => {
    const h = await plugin(topClient, 2)
    await before(h, "call_0", "A")
    await before(h, secondID, "B")
    await after(h, secondID, "B")
    await idle(h, "B")
    await before(h, "third", "C")
    let admitted = false
    const queued = before(h, "fourth", "D").then(() => (admitted = true))
    await tick()
    const admittedWhileAStillRuns = admitted
    await idle(h, "A")
    await queued
    assert.equal(admittedWhileAStillRuns, false)
  })
}

for (const reverse of [true, false]) {
  test(`R3 FIFO survives parent lookups: ${reverse ? "reversed responses" : "comparison: ordered responses"}`, async () => {
    const answers = []
    const client = { session: { get: ({ path }) => path.id === "holder"
      ? Promise.resolve({ data: {} }) : new Promise((r) => answers.push(r)) } }
    const h = await plugin(client)
    await before(h, "held", "holder")
    const order = []
    const first = before(h, "first").then(() => order.push("first"))
    const second = before(h, "second").then(() => order.push("second"))
    answers[reverse ? 1 : 0]({ data: {} })
    await tick()
    answers[reverse ? 0 : 1]({ data: {} })
    await tick()
    await after(h, "held", "holder")
    await tick()
    await after(h, order[0])
    await Promise.all([first, second])
    assert.deepEqual(order, ["first", "second"])
  })
}

test("R4 malformed cap values fall back to 2", () => {
  for (const value of ["1.5", "3junk", "1e3"]) {
    assert.equal(readMax({ OPENCODE_SUBAGENT_MAX: value }), 2, value)
  }
})

test("R4 comparison: a whole-number cap is accepted", () => {
  assert.equal(readMax({ OPENCODE_SUBAGENT_MAX: "3" }), 3)
})

for (const endedBeforeAcquire of [true, false]) {
  test(`R5 cancellation rejects without a free slot: ${endedBeforeAcquire ? "event before acquire" : "comparison: event after acquire"}`, async () => {
    const g = createGate(1)
    await g.acquire("holder")
    if (endedBeforeAcquire) g.release("cancelled", "error")
    let rejected = false
    const cancelled = g.acquire("cancelled").catch(() => (rejected = true))
    if (!endedBeforeAcquire) g.release("cancelled", "error")
    await tick()
    const rejectedWhileFull = rejected
    g.release("holder")
    await cancelled
    assert.equal(rejectedWhileFull, true)
  })
}

for (const unrelatedSessions of [500, 0]) {
  test(`R6 idle during lookup stays remembered: ${unrelatedSessions ? "500 other sessions go idle" : "comparison: no other sessions"}`, async () => {
    let answer
    const h = await plugin({ session: { get: () => new Promise((r) => (answer = r)) } })
    const pending = before(h, "cancelled", "S")
    const result = pending.then(() => "ran", (e) => e.message)
    await idle(h, "S")
    for (let i = 0; i < unrelatedSessions; i++) await idle(h, `other_${i}`)
    answer({ data: {} })
    assert.match(await result, /ended while it waited/)
  })
}
