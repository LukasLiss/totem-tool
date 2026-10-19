# TOTeM AI Assistant Empirical Evaluation Benchmark

A systematic, reproducible evaluation framework to benchmark LLMs for Object-Centric Process Mining (OCPM) tasks within the TOTeM tool. Designed for empirical academic publications (BPM, ICPM, CAiSE).

---

## 🔬 Factorial Evaluation Matrix

The benchmark evaluates performance across three independent experimental dimensions:

1. **Models ($M$)**:
   - `gemini-3.8-flash` / `gemini-2.0-flash` / `gemini-1.5-flash`
   - `claude-3-5-sonnet-20241022` / `claude-3-opus-20240229`
   - `gpt-4o` / `o3-mini`
   - `mock` (deterministic local offline testing)

2. **System Prompt Strategies ($P$)**:
   - `zero_shot`: Minimal task instructions without domain context.
   - `few_shot_cot`: Step-by-step chain-of-thought with annotated process mining reasoning exemplars.
   - `rag_augmented`: Retrieval-augmented generation with authoritative TOTeM documentation chunks (`help.md`).
   - `dynamic_context`: Production TOTeM dual-channel prompt incorporating active UI state, Teach/Act mode, and live log metadata.

3. **Tool Execution Harnesses ($H$)**:
   - `ungrounded`: Zero-tool parametric baseline (measures baseline knowledge & hallucination rate).
   - `mcp`: Grounded Process Mining Model Context Protocol (MCP) server executing tools over DuckDB and `totem_lib` (`backend/mcp_server/server.py`).

---

## 📊 Benchmark Suite (20 Tasks)

The suite covers 5 representative OCPM task categories across canonical event logs (`ContainerLogistics.sqlite` and `order-management.sqlite`):

| Category | Tasks | Metric / Ground Truth Type |
| :--- | :--- | :--- |
| **Descriptive** | `T01`–`T04` | Event/object counts and distinct object type extraction |
| **Bottleneck** | `T05`–`T07` | Longest delay activity pairs (`OrderEmptyContainers` $\to$ `Depart`, `PlaceinStock` $\to$ `BringtoLoadingBay`) |
| **Lifespan** | `T08`–`T10` | Top-2 longest lived object types (`Forklift`, `Truck` in logistics; `Products`, `Employees` in orders) |
| **Discovery** | `T11`–`T14` | OCCN discovery, TOTeM graph generation, trace variants for leading object types |
| **UI Action** | `T15`–`T20` | Dual-mode Teach tour highlight sequences (6-step dashboard tour) and Act mode mutations |

---

## 🚀 Running the Benchmark

### 1. Zero-Token Local Test Run (Mock Mode)
Run a quick sanity check across the conditions without consuming API tokens:
```bash
python evaluation/assistant_benchmark/runner.py --mock --tasks 3
```

### 2. Run Single Model Pilot (e.g., Gemini 3.8 Flash)
```bash
python evaluation/assistant_benchmark/runner.py \
  --models gemini-3.8-flash \
  --prompts zero_shot,few_shot_cot,rag_augmented,dynamic_context \
  --harnesses ungrounded,mcp
```

### 3. Full Server Sweep (For Academic Publication)
On your university server with API access:
```bash
python evaluation/assistant_benchmark/runner.py \
  --models gemini-3.8-flash,claude-3-5-sonnet-20241022,gpt-4o \
  --prompts zero_shot,few_shot_cot,rag_augmented,dynamic_context \
  --harnesses ungrounded,mcp \
  --output-dir evaluation/assistant_benchmark/results/full_sweep
```

---

## 📈 Publication-Ready Outputs

Each run automatically writes to `--output-dir`:
1. `results_<timestamp>.csv`: Complete row-level trace of prompt tokens, completion tokens, latency, invoked tools, exact match score, and judge score.
2. `table_accuracy_<timestamp>.tex`: LaTeX table formatted with `booktabs` comparing task categories and overall accuracy across all conditions.
3. `table_efficiency_<timestamp>.tex`: LaTeX table comparing mean latency (s), mean token consumption, and tool invocation accuracy (%).

---

## 🧪 Unit Testing

Run the benchmark test suite to verify ground-truth solvers and scorers:
```bash
pytest evaluation/assistant_benchmark/tests
```
