# Benchmark Results

Generated 2026-09-03 09:52, 3 repeat(s) per algorithm

Peak RAM comes from `tracemalloc`, which only sees Python allocations. Polars and DuckDB work mostly in native memory, so these numbers understate what those algorithms really use.

## Logs

| Log | Number of events | Number of objects | Number of event-to-object relations | Number of object-to-object relations | Number of activities | Number of object types |
|---|---|---|---|---|---|---|
| ocel2-p2p | 14,671 | 9,054 | 35,927 | 16,757 | 10 | 7 |
| order-management | 21,008 | 10,840 | 147,463 | 28,391 | 11 | 6 |
| container_logistics | 35,372 | 13,882 | 74,272 | 15,920 | 14 | 7 |

## Results

| Log | Events | Algorithm | Time (s) | Peak RAM (MB) |
|---|---|---|---|---|
| ocel2-p2p | 14,671 | import_ocel | 3.516 | 87.45 |
| ocel2-p2p | 14,671 | totemDiscovery | 3.512 | 38.4 |
| ocel2-p2p | 14,671 | totemDiscovery_db | 0.258 | 0.09 |
| ocel2-p2p | 14,671 | mlpaDiscovery | 0.224 | 0.08 |
| ocel2-p2p | 14,671 | discover_oc_petri_net_polars | 3.004 | 28.96 |
| ocel2-p2p | 14,671 | discover_occn | 18.344 | 116.31 |
| ocel2-p2p | 14,671 | OCDFG.from_ocel | 0.083 | 0.2 |
| ocel2-p2p | 14,671 | CCDFG.from_ocel | 0.008 | 0.1 |
| order-management | 21,008 | import_ocel | 3.803 | 94.81 |
| order-management | 21,008 | totemDiscovery | 7.987 | 74.13 |
| order-management | 21,008 | totemDiscovery_db | 0.821 | 0.08 |
| order-management | 21,008 | mlpaDiscovery | 0.032 | 0.04 |
| order-management | 21,008 | discover_oc_petri_net_polars | 4.967 | 92.28 |
| order-management | 21,008 | discover_occn | 434.734 | 253.73 |
| order-management | 21,008 | OCDFG.from_ocel | 0.118 | 0.61 |
| order-management | 21,008 | CCDFG.from_ocel | 0.014 | 0.14 |
| container_logistics | 35,372 | import_ocel | 3.759 | 70.44 |
| container_logistics | 35,372 | totemDiscovery | 6.912 | 75.24 |
| container_logistics | 35,372 | totemDiscovery_db | 0.332 | 0.1 |
| container_logistics | 35,372 | mlpaDiscovery | 0.035 | 0.04 |
| container_logistics | 35,372 | discover_oc_petri_net_polars | 5.189 | 54.82 |
| container_logistics | 35,372 | discover_occn | 37.487 | 217.99 |
| container_logistics | 35,372 | OCDFG.from_ocel | 0.105 | 0.79 |
| container_logistics | 35,372 | CCDFG.from_ocel | 0.006 | 0.04 |
