# Benchmark Results

Generated 2026-09-10 09:14, 3 repeat(s) per algorithm

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
| ocel2-p2p | 14,671 | import_ocel | 2.904 | 87.45 |
| ocel2-p2p | 14,671 | import_ocel_db | 6.119 | 87.33 |
| ocel2-p2p | 14,671 | totemDiscovery | 3.28 | 38.4 |
| ocel2-p2p | 14,671 | totemDiscovery_db | 0.291 | 0.09 |
| ocel2-p2p | 14,671 | mlpaDiscovery | 0.12 | 0.08 |
| ocel2-p2p | 14,671 | discover_oc_petri_net_polars | 2.669 | 29.01 |
| ocel2-p2p | 14,671 | discover_occn | 18.354 | 116.31 |
| ocel2-p2p | 14,671 | OCDFG.from_ocel | 0.089 | 0.2 |
| ocel2-p2p | 14,671 | CCDFG.from_ocel | 0.008 | 0.1 |
| order-management | 21,008 | import_ocel | 3.521 | 94.81 |
| order-management | 21,008 | import_ocel_db | 8.576 | 94.8 |
| order-management | 21,008 | totemDiscovery | 7.418 | 74.13 |
| order-management | 21,008 | totemDiscovery_db | 0.803 | 0.09 |
| order-management | 21,008 | mlpaDiscovery | 0.025 | 0.04 |
| order-management | 21,008 | discover_oc_petri_net_polars | 4.824 | 92.32 |
| order-management | 21,008 | discover_occn | 415.166 | 253.58 |
| order-management | 21,008 | OCDFG.from_ocel | 0.126 | 0.61 |
| order-management | 21,008 | CCDFG.from_ocel | 0.014 | 0.14 |
| container_logistics | 35,372 | import_ocel | 3.461 | 70.44 |
| container_logistics | 35,372 | import_ocel_db | 4.399 | 70.43 |
| container_logistics | 35,372 | totemDiscovery | 6.525 | 75.24 |
| container_logistics | 35,372 | totemDiscovery_db | 0.396 | 0.1 |
| container_logistics | 35,372 | mlpaDiscovery | 0.024 | 0.04 |
| container_logistics | 35,372 | discover_oc_petri_net_polars | 4.92 | 54.83 |
| container_logistics | 35,372 | discover_occn | 36.567 | 217.98 |
| container_logistics | 35,372 | OCDFG.from_ocel | 0.104 | 0.79 |
| container_logistics | 35,372 | CCDFG.from_ocel | 0.006 | 0.04 |
