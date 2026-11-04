// Caps how many opencode subagents (the `task` tool) run at once; the rest wait
// for a free slot. Set the cap with OPENCODE_SUBAGENT_MAX (default 2).
// Nested calls (from inside a subagent) run under their parent's slot.
import { createGate, readMax } from "./gate.js"

const DONE = new Set(["completed", "error"])

export const SubagentCap = async ({ client }) => {
  const gate = createGate(readMax())
  const parentOf = new Map()
  const lookups = new Set() // calls waiting on a parent lookup, so a turn that ends meanwhile can refuse them

  // A failed lookup counts as nested (not queued, not cached): queuing a call that really is
  // nested would deadlock, while letting one top-level call through only misses the cap once.
  async function isNested(sessionID) {
    if (!parentOf.has(sessionID)) {
      try {
        const res = await client.session.get({ path: { id: sessionID } })
        if (!res?.data) return true
        parentOf.set(sessionID, res.data.parentID ?? null)
      } catch {
        return true
      }
    }
    return parentOf.get(sessionID) !== null
  }

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "task") return
      if (output?.args?.background) return
      const ticket = gate.ticket()
      const call = { sessionID: input.sessionID, turnEnded: false }
      lookups.add(call)
      const nested = await isNested(input.sessionID)
      lookups.delete(call)
      if (nested) return
      if (call.turnEnded) throw new Error(`subagent-cap: ${input.callID} ended while it waited for a slot`)
      await gate.acquire(input.callID, input.sessionID, ticket)
    },
    "tool.execute.after": async (input) => {
      if (input.tool === "task") gate.release(input.callID, undefined, input.sessionID)
    },
    event: async ({ event }) => {
      if (event?.type === "session.idle") {
        const id = event.properties?.sessionID
        for (const call of lookups) if (call.sessionID === id) call.turnEnded = true
        return gate.releaseSession(id)
      }
      if (event?.type !== "message.part.updated") return
      const part = event.properties?.part
      if (part?.type !== "tool" || part.tool !== "task") return
      const status = part.state?.status
      if (!DONE.has(status)) return
      gate.release(part.callID, status, part.sessionID)
      // a slash-command subtask hands the hooks part.id, not part.callID (session/prompt.ts in 1.19.5)
      if (part.id && part.id !== part.callID) gate.release(part.id, status, part.sessionID)
    },
  }
}
