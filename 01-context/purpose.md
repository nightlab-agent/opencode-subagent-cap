# Purpose

For opencode users whose subagent fan-out hits provider rate limits, a local model
server's capacity, or a usage window: anomalyco/opencode#27110 (41 thumbs-up on
2026-11-01) asks for a cap on parallel subagents. A core fix (PR #55983) targets the
2.x rewrite and was unmerged on 2026-11-01; this plugin serves 1.19.x meanwhile.
When opencode ships its own cap, the README says so and points there.
