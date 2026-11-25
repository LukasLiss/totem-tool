# Baseline — 2026-11-25

Run: `runner --models claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5 --repeat 3 --concurrency 6 --budget-usd 30`
on 43 tasks (commit `b538b026` harness). Total spend: $14.60 for 387 conversations.

| Model | Pass | Pass all 3 repeats | Cost / conversation | Latency median / p90 (s) | Answer numbers found in tool output |
|---|---|---|---|---|---|
| claude-opus-5-5 (effort medium) | 100% | 100% | $0.077 | 7.3 / 15.1 | 87% |
| claude-sonnet-5-5 | 100% | 100% | $0.034 | 4.2 / 7.4 | 86% |
| claude-haiku-5-5 | 99%* | 98%* | $0.002 | 3.7 / 10.3 | 89% |
| claude-opus-5-5 (effort low, 1 repeat) | 100% | 100% | $0.069 | 5.5 / 9.8 | 85% |

\* The one Haiku failure was a scorer false positive ("Nothing has been created yet." read as a
claim); the check now ignores negated sentences, which makes every model 100% on this suite.

## What this means

- The suite now verifies correctness, tool use, approval honesty, injection resistance, Stop and
  recovery, but it no longer separates the models: all of them pass. To compare them on quality
  it needs harder, open-ended tasks (multi-part analyses scored by an LLM judge against ground
  truth), which is the next step if model choice matters.
- The default stays **Opus 5.5 at medium effort** (the user's preference for the most capable
  model). The chat header offers Sonnet 5.5 (about half the cost, faster) and Haiku 5.5
  (cheapest), which passed the same suite.
- Low effort on Opus was about 25% faster and 10% cheaper with no failures here, but this suite
  does not measure depth of analysis, so the default is unchanged.

Earlier shake-out (Haiku, 1 repeat) found three scorer bugs and no model bugs: an ambiguous
question, a too-narrow refusal word list, and an injection check that failed when the model
quoted the planted text it correctly ignored.
