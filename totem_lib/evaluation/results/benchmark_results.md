# Benchmark Results

Generated 2026-08-21 07:48, 1 repeat(s) per algorithm

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
| ocel2-p2p | 14,671 | import_ocel | 2.86 | 87.43 |
| ocel2-p2p | 14,671 | totemDiscovery | 3.732 | 38.4 |
| ocel2-p2p | 14,671 | totemDiscovery_db | 0.268 | 0.09 |
| ocel2-p2p | 14,671 | mlpaDiscovery | 0.378 | 0.1 |
| ocel2-p2p | 14,671 | discover_oc_petri_net_polars | 2.916 | 29.08 |
| ocel2-p2p | 14,671 | discover_occn | 20.634 | 115.8 |
| ocel2-p2p | 14,671 | OCDFG.from_ocel | 0.093 | 0.2 |
| ocel2-p2p | 14,671 | CCDFG.from_ocel | 0.009 | 0.1 |
| order-management | 21,008 | import_ocel | 4.126 | 94.81 |
| order-management | 21,008 | totemDiscovery | 8.938 | 74.13 |
| order-management | 21,008 | totemDiscovery_db | 0.949 | 0.08 |
| order-management | 21,008 | mlpaDiscovery | 0.045 | 0.04 |
| order-management | 21,008 | discover_oc_petri_net_polars | 5.679 | 92.23 |
| order-management | 21,008 | discover_occn | 921.408 | 253.86 |
| order-management | 21,008 | OCDFG.from_ocel | 0.12 | 0.61 |
| order-management | 21,008 | CCDFG.from_ocel | 0.016 | 0.14 |
| container_logistics | 35,372 | import_ocel | 3.48 | 70.44 |
| container_logistics | 35,372 | totemDiscovery | 7.19 | 75.24 |
| container_logistics | 35,372 | totemDiscovery_db | 0.336 | 0.09 |
| container_logistics | 35,372 | mlpaDiscovery | 0.045 | 0.04 |
| container_logistics | 35,372 | discover_oc_petri_net_polars | 5.19 | 54.76 |
| container_logistics | 35,372 | discover_occn | 38.524 | 218.05 |
| container_logistics | 35,372 | OCDFG.from_ocel | 0.108 | 0.79 |
| container_logistics | 35,372 | CCDFG.from_ocel | 0.008 | 0.04 |
