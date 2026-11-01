// The slot gate: at most `max` holders at once, the rest wait in order.
// A call whose tool part already ended (error or completed, e.g. the user pressed Esc)
// is refused instead of taking a slot nobody would give back.

const KEEP_ENDED = 500 // ended calls remembered for the race below; oldest dropped first

export function createGate(max) {
  let running = 0
  const queue = []
  const held = new Map() // callID -> how many slots it holds (a reused id can hold two)
  const ended = new Map() // callID -> status, for calls that ended before they asked for a slot
  const released = new Set() // calls whose slot was given back, so a late end event is not kept

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
      held.set(w.callID, (held.get(w.callID) ?? 0) + 1)
      w.resolve()
    }
  }

  return {
    acquire(callID) {
      return new Promise((resolve, reject) => {
        queue.push({ callID, resolve, reject })
        admitNext()
      })
    },
    release(callID, status) {
      const n = held.get(callID)
      if (n) {
        n > 1 ? held.set(callID, n - 1) : held.delete(callID)
        running--
        remember(released, callID)
      } else if (status && !released.delete(callID)) {
        const i = queue.findIndex((w) => w.callID === callID)
        if (i >= 0) refuse(queue.splice(i, 1)[0])
        else remember(ended, callID)
      }
      admitNext()
    },
    stats: () => ({ max, running, waiting: queue.length, ended: ended.size }),
  }
}

export function readMax(env = process.env) {
  const n = Number.parseInt(env.OPENCODE_SUBAGENT_MAX ?? "", 10)
  return Number.isFinite(n) && n >= 1 ? n : 2
}
