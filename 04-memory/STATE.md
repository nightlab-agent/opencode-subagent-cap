# STATE

- 0.1.2 prepared 2026-11-05. Proven on opencode 1.19.5: headless with a stand-in model (cap 2 of 4; failed child
  frees its slot; nested no deadlock) and through `opencode serve` (abort with 1 running and 2 waiting, at four timings;
  a slash-command subtask, then a task call, at cap 1). Not seen: the TUI with a real model, a real Esc keypress.
- Open: does the npm name install through opencode's own plugin installer (check after publish).
