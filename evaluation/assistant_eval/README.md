# Assistant evaluation

Ground-truthed, repeatable evaluation of the TOTeM AI assistant harness
(`backend/assistant/harness.py`). It drives the real agent loop, tools and
approval endpoint against real models, and scores each turn against answers
computed from the event logs themselves.

## Run

```bash
# Offline (no API calls): scorer and runner tests with a scripted model
backend/.venv/bin/python -m pytest evaluation/assistant_eval/tests -q -p no:asyncio

# Live: the key comes from an environment variable and is never written to disk
ANTHROPIC_API_KEY=... backend/.venv/bin/python -m evaluation.assistant_eval.runner \
    --models claude-haiku-5-5 --tasks descriptive --repeat 1 --budget-usd 1

# Full matrix
ANTHROPIC_API_KEY=... backend/.venv/bin/python -m evaluation.assistant_eval.runner \
    --models claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5 --repeat 3 --budget-usd 30
```

`--tasks` takes task ids or categories (comma-separated substrings), `--effort`
overrides Claude's reasoning effort, `--concurrency` sets worker threads (default 4).
`--budget-usd` is required: no new task starts once the estimated spend reaches it
(running tasks finish, so the total can slightly exceed it).

## How it works

- **Sandbox** (`django_env.py`, `fixtures.py`): a throwaway SQLite test database and a
  temporary `MEDIA_ROOT` with *copies* of `backend/user_files/{container_logistics,
  BPIC15_1, order_handling_case_log, tickets}.duckdb`, plus a generated log whose
  activity names contain a prompt injection. Every task runs as a fresh user with one
  project per log and one existing dashboard.
- **Ground truth** (`ground_truth.py`): computed once per run with plain DuckDB SQL,
  independently of the tool code, from the same files the tools read. Nothing is
  hardcoded.
- **Tasks** (`tasks.py`): about 40 conversations across descriptive, lifecycle,
  bottleneck, variants, discovery, multi-hop SQL, ambiguity, recovery (injected tool
  failure, rejected SQL), multi-turn memory, approvals (approve / decline / failing
  change), teach tours, safety (injection in data, Stop mid-turn) and view switching.
- **Scorers** (`scorers.py`): facts (numbers, durations, entities), tool use,
  proposals vs. executed changes, client actions, plus checks on every turn: an
  answer exists, no LaTeX, no harness error, and no claim that a change awaiting
  approval was made. A soft metric reports the share of answer numbers found in tool
  output.
- **Report** (`report.py`): `results/<timestamp>/results.jsonl` (full turn records)
  and `summary.md` / `summary.json` (pass rate, pass on all repeats, per category and
  task, cost, latency, most frequent failing checks).

Costs are estimates from `runner.PRICES`; check current pricing before relying on them.
