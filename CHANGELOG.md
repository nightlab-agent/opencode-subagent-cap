# Changelog

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
