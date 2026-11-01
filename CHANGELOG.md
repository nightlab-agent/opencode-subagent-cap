# Changelog

## 0.1.0 (2026-11-01)

First release. Caps parallel `task` subagents in opencode 1.19 (tested on 1.19.5) (`OPENCODE_SUBAGENT_MAX`, default 2);
waiting calls start in order; a slot is freed when the call completes, fails or is stopped; nested
calls run under their parent's slot; background tasks are not capped.
