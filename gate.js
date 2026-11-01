// The slot gate: at most `max` holders at once, the rest wait in order.
// A call whose tool part already ended (error or completed, e.g. the user pressed Esc)
// is refused instead of taking a slot nobody would give back.

const KEEP_ENDED = 500 // ended calls remembered for the race below; oldest dropped first

export function createGate(max) {
  let running = 0
  const queue = []
  const held = new Map() // callID -> sessions holding a slot under it (a reused id can hold two)
  const ended = new Map() // callID -> status, for calls that ended before they asked for a slot
  const released = new Set() // slots given back by the after hook, so the end event that follows is not counted again
  const endedFirst = new Set() // slots given back by the end event, so a late after hook is not counted again

  function remember(set, id) {
    set instanceof Map ? set.set(id, true) : set.add(id)
    if (set.size > KEEP_ENDED) set.delete(set.keys().next().value)
  }

  function refuse(w) {
    w.reject(new Error(`subagent-cap: ${w.callID} ended while it waited for a slot`))
  }

  function admitNext() {
    while (running < max && queue.length) {
      const w = queue.shift()
      if (ended.delete(w.callID)) {
        refuse(w)
        continue
      }
      running++
      held.set(w.callID, [...(held.get(w.callID) ?? []), w.sessionID])
      w.resolve()
    }
  }

  return {
    acquire(callID, sessionID) {
      return new Promise((resolve, reject) => {
        queue.push({ callID, sessionID, resolve, reject })
        admitNext()
      })
    },
    release(callID, status) {
      if (status ? released.delete(callID) : endedFirst.delete(callID)) return admitNext()
      const holders = held.get(callID)
      if (holders) {
        holders.length > 1 ? held.set(callID, holders.slice(1)) : held.delete(callID)
        running--
        remember(status ? endedFirst : released, callID)
      } else if (status) {
        const i = queue.findIndex((w) => w.callID === callID)
        if (i >= 0) refuse(queue.splice(i, 1)[0])
        else remember(ended, callID)
      }
      admitNext()
    },
    // The session finished its turn (idle): anything it still holds or waits for can only leak,
    // e.g. a slash-command subtask cancelled while it waited, or one that named an unknown agent.
    releaseSession(sessionID) {
      for (const [callID, holders] of held) {
        const keep = holders.filter((s) => s !== sessionID)
        running -= holders.length - keep.length
        keep.length ? held.set(callID, keep) : held.delete(callID)
      }
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].sessionID === sessionID) refuse(queue.splice(i, 1)[0])
      admitNext()
    },
    stats: () => ({ max, running, waiting: queue.length, ended: ended.size }),
  }
}

export function readMax(env = process.env) {
  const n = Number.parseInt(env.OPENCODE_SUBAGENT_MAX ?? "", 10)
  return Number.isFinite(n) && n >= 1 ? n : 2
}
