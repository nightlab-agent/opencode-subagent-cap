// The slot gate: at most `max` holders at once, the rest wait in order.
// A call whose tool part already ended (error or completed, e.g. the user pressed Esc)
// is refused instead of taking a slot nobody would give back.
// A provider can reuse a call id across sessions, so a call is known by session and id together.

const KEEP_ENDED = 500 // ended calls remembered for the race below; oldest dropped first

const keyOf = (sessionID, callID) => `${sessionID}\0${callID}`

function add(counts, key, keep = KEEP_ENDED) {
  counts.set(key, (counts.get(key) ?? 0) + 1)
  if (counts.size > keep) counts.delete(counts.keys().next().value)
}

function take(counts, key) {
  const n = counts.get(key)
  if (!n) return false
  n > 1 ? counts.set(key, n - 1) : counts.delete(key)
  return true
}

export function createGate(max) {
  let running = 0
  let tickets = 0
  const queue = [] // in ticket order
  const held = new Map() // call -> slots held under it (a reused id can hold two)
  const ended = new Map() // calls that ended before they asked for a slot
  const released = new Map() // slots given back by the after hook, so the end event that follows is not counted again
  const endedFirst = new Map() // slots given back by the end event, so a late after hook is not counted again

  function refuse(w) {
    w.reject(new Error(`subagent-cap: ${w.callID} ended while it waited for a slot`))
  }

  function admitNext() {
    while (running < max && queue.length) {
      const w = queue.shift()
      running++
      add(held, w.key, Infinity)
      w.resolve()
    }
  }

  return {
    // A place in line, taken before any await so a slow parent lookup cannot move a call back.
    ticket: () => ++tickets,
    acquire(callID, sessionID, ticket = ++tickets) {
      return new Promise((resolve, reject) => {
        const w = { key: keyOf(sessionID, callID), callID, sessionID, ticket, resolve, reject }
        if (ended.delete(w.key)) return refuse(w)
        const i = queue.findIndex((q) => q.ticket > ticket)
        i < 0 ? queue.push(w) : queue.splice(i, 0, w)
        admitNext()
      })
    },
    release(callID, status, sessionID) {
      const key = keyOf(sessionID, callID)
      if (take(status ? released : endedFirst, key)) return
      if (take(held, key)) {
        running--
        add(status ? endedFirst : released, key)
      } else if (status) {
        const i = queue.findIndex((w) => w.key === key)
        if (i >= 0) refuse(queue.splice(i, 1)[0])
        else add(ended, key)
      }
      admitNext()
    },
    // The session finished its turn (idle): anything it still holds or waits for can only leak,
    // e.g. a slash-command subtask cancelled while it waited, or one that named an unknown agent.
    // What ended in that turn is forgotten too, so the next turn can reuse the id.
    releaseSession(sessionID) {
      const own = keyOf(sessionID, "")
      for (const [key, slots] of held) {
        if (!key.startsWith(own)) continue
        running -= slots
        held.delete(key)
      }
      for (const key of ended.keys()) if (key.startsWith(own)) ended.delete(key)
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].sessionID === sessionID) refuse(queue.splice(i, 1)[0])
      admitNext()
    },
    stats: () => ({ max, running, waiting: queue.length, ended: ended.size }),
  }
}

export function readMax(env = process.env) {
  const raw = env.OPENCODE_SUBAGENT_MAX ?? ""
  const n = Number(raw)
  return /^\d+$/.test(raw) && Number.isSafeInteger(n) && n >= 1 ? n : 2
}
