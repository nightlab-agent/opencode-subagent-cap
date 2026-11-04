# Changelog

## Unreleased

Fixes from a second review, each with a test that failed first:
- A call is now known by session and call id together. Before, a call inside a subagent that shared an id with its parent freed the parent's slot, and two sessions sharing an id could free each other's slot, so one more call ran than the cap.
- Waiting calls keep the order they were made in when parent lookups answer out of order.
- A cap such as `1.5`, `3junk` or `1e3` now falls back to 2, as the README says, instead of reading the first digits.
- A call that ended before it asked for a slot is refused at once, even when every slot is taken.
- An Esc during a parent lookup is no longer forgotten when many other sessions go idle.
- An id that ended in a finished turn can be used again in the next turn.

## 0.1.1 (2026-11-01)

Fixes slots that were kept or freed wrongly:
- A slash-command subtask that was cancelled or failed before it started kept its place in the queue, so
  with a cap of 1 every later `task` call waited forever. Slots and queue places a turn leaves behind are
  now freed when that session goes idle.
- A slash-command subtask naming an agent that does not exist now gives its slot back.
- When calls in two sessions share a call id, the first one finishing no longer frees the other's slot
  too, which let one more call run than the cap.
- A call whose turn ended (Esc) while it was looking up its parent session is refused instead of
  queued with no one to free it.

Re-run in opencode 1.19.5 with a test model: cap 2 of 4 calls, cap 1 with a failing call, and cap 1 with
nested calls behave as in 0.1.0. The slash-command path is covered by a unit test only.

## 0.1.0 (2026-11-01)

First release. Caps parallel `task` subagents in opencode 1.19 (tested on 1.19.5) (`OPENCODE_SUBAGENT_MAX`, default 2);
waiting calls start in order; a slot is freed when the call completes, fails or is stopped; nested
calls run under their parent's slot; background tasks are not capped.
