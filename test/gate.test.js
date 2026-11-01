import { test } from "node:test"
import assert from "node:assert/strict"
import { createGate, readMax } from "../gate.js"

const tick = () => new Promise((r) => setImmediate(r))

test("runs at most max at once, the rest wait in order", async () => {
  const g = createGate(2)
  const order = []
  for (const id of ["a", "b", "c", "d"]) g.acquire(id).then(() => order.push(id))
  await tick()
  assert.deepEqual(order, ["a", "b"])
  g.release("a")
  await tick()
  assert.deepEqual(order, ["a", "b", "c"])
})

test("a slot freed by an error event lets the next call run", async () => {
  const g = createGate(1)
  let ran = false
  await g.acquire("x")
  g.acquire("y").then(() => (ran = true))
  g.release("x", "error")
  await tick()
  assert.equal(ran, true)
})

test("release by both the after hook and the event frees one slot only", async () => {
  const g = createGate(1)
  await g.acquire("x")
  g.release("x")
  g.release("x", "completed")
  // the late event is not kept and never counts as a second free slot
  assert.deepEqual(g.stats(), { max: 1, running: 0, waiting: 0, ended: 0 })
  await g.acquire("y")
  let third = false
  g.acquire("w").then(() => (third = true))
  await tick()
  assert.equal(third, false)
})

test("a call that ended while waiting is refused, not run", async () => {
  const g = createGate(1)
  await g.acquire("x")
  const p = g.acquire("y")
  g.release("y", "error")
  await assert.rejects(p, /ended while it waited/)
  assert.deepEqual(g.stats(), { max: 1, running: 1, waiting: 0, ended: 0 })
})

test("readMax: default 2, bad values fall back", () => {
  assert.equal(readMax({}), 2)
  assert.equal(readMax({ OPENCODE_SUBAGENT_MAX: "3" }), 3)
  assert.equal(readMax({ OPENCODE_SUBAGENT_MAX: "0" }), 2)
  assert.equal(readMax({ OPENCODE_SUBAGENT_MAX: "x" }), 2)
})

test("a call that ended before it asked for a slot is refused (Esc during the parent lookup)", async () => {
  const g = createGate(1)
  g.release("z", "error")
  await assert.rejects(g.acquire("z"), /ended while it waited/)
  assert.deepEqual(g.stats(), { max: 1, running: 0, waiting: 0, ended: 0 })
})

test("comparison: a call that did not end takes the slot as usual", async () => {
  const g = createGate(1)
  await g.acquire("z")
  assert.deepEqual(g.stats(), { max: 1, running: 1, waiting: 0, ended: 0 })
})

test("ended calls that never ask for a slot are not kept forever", () => {
  const g = createGate(1)
  for (let i = 0; i < 600; i++) g.release(`n${i}`, "completed")
  assert.equal(g.stats().ended, 500)
})
test("F3c two holders with the same callID both give back their slot", async () => {
  const g = createGate(2)
  await g.acquire("call_0"); await g.acquire("call_0") // two sessions, same provider id
  g.release("call_0"); g.release("call_0")
  assert.equal(g.stats().running, 0)
})
test("F3c comparison: two holders with distinct callIDs both give back their slot", async () => {
  const g = createGate(2)
  await g.acquire("a"); await g.acquire("b")
  g.release("a"); g.release("b")
  assert.equal(g.stats().running, 0)
})
