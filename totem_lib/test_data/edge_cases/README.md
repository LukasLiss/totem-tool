# Edge-case OCEL corpus

A curated set of small, deliberately-constructed OCEL 2.0 logs that each exercise one
boundary / corner condition of the platform (empty log, dead object, cyclic dependencies,
weird timestamps, ...). They are the test fixtures that harden every miner against
degenerate input — see **Epic #200** (corpus) and **Issue #296** (the crashes it found,
since fixed).

Each case ships in two formats:

| File | What | Produced by |
|---|---|---|
| `<name>.json` | Canonical OCEL 2.0 JSON (same schema as `test_data/small/*.json`). Source of truth; read by both `import_ocel` (Polars) and `import_ocel_db` (DuckDB). | `generate_edge_cases.py` |
| `<name>.duckdb` | DuckDB database derived by round-tripping the JSON through `import_ocel_db(...).save(...)`. | `generate_edge_cases.py` |

## Catalogue

The full behavior contract — what each log represents and how every pipeline is expected to
behave (clean result vs. documented crash) — lives in
[`docs/EDGE_CASE_TAXONOMY.md`](../../../docs/EDGE_CASE_TAXONOMY.md). In short:

| Fixture | Edge case |
|---|---|
| `empty` | Zero events, zero objects |
| `single_event` | One event / one object / one type |
| `single_object_type` | Multiple events, a single object type |
| `event_no_objects` | An event referencing no objects |
| `dead_object` | An object referenced by no event |
| `disconnected_types` | Two object types that never share an event |
| `self_loop` | Same activity repeated for one object |
| `long_chain` | 50-step sequential chain |
| `cyclic` | Cyclic control flow `A → B → A → B` |
| `high_fanout` | One event related to 100+ objects |
| `equal_timestamps` | Concurrent events with identical timestamps |
| `out_of_order_timestamps` | Events stored non-chronologically |
| `null_attributes` | Missing / null attribute values |
| `unicode_names` | Unicode in activity & object-type names |
| `duplicate_event_ids` | Two events sharing an id |

Some fixtures currently make a miner crash; those are marked `xfail(strict=True)` in the
tests and listed under "currently-documented crashes" in the taxonomy. They are known
hardening opportunities, not regressions.

## How the corpus is tested

`totem_lib/tests/edge_cases/test_edge_cases.py` **globs this directory** and runs every core
miner (dual-path, Polars + DuckDB) against each `*.json`. Because it globs, **dropping a new
fixture here is picked up automatically** — no test list to edit. It runs in CI via the
existing bare-`pytest` job in `.github/workflows/build-and-test.yml`.

```bash
cd totem_lib
pytest tests/edge_cases/ -v
```

## How to add a new edge case

1. **Add a builder** in `totem_lib/tests/edge_cases/generate_edge_cases.py`: write a function
   returning an OCEL 2.0 document (use the `event(...)`, `obj(...)`, `ocel(...)` helpers) and
   register it in the `EDGE_CASES` dict.
2. **Regenerate** the corpus (writes both `.json` and `.duckdb`):
   ```bash
   cd totem_lib
   python tests/edge_cases/generate_edge_cases.py
   ```
   (Pass `--json-only` to skip the DuckDB derivation in an environment without the heavy deps.)
3. **Document** the expected behavior in `docs/EDGE_CASE_TAXONOMY.md`.
4. **Wire assertions** (only if non-default): the tests already run the new fixture through
   every miner asserting "does not raise". If your case is expected to *crash* a miner, add an
   entry to the matching `XFAIL_*` map in `test_edge_cases.py` (fixture stem →
   `(reason, ExceptionType)`) and file a follow-up issue for the fix. If it has a specific
   structural oracle (e.g. "yields exactly 2 variants"), add a targeted test at the bottom of
   that file.
5. **Run** `pytest tests/edge_cases/ -v` and commit the new `.json` + `.duckdb` together.

All files are regenerated deterministically from the script, so never hand-edit the `.json`
or `.duckdb` — change the builder and re-run.
