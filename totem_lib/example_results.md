```
looping through events, start time: 2025-08-17 11:08:17.474339
mergeing o2o and e2o, start time: 2025-08-17 11:13:38.958865
computing log cardinalities, start time: 2025-08-17 11:13:57.516839
building the temporal graph, start time: 2025-08-17 11:13:57.904813
Truck -> Container
LC: 1 - 1..*
EC: 0...1 - 1
TR: Di

Truck -> Handling Unit
LC: 1 - 1..*
EC: 0...1 - 0...1
TR: Di

Container -> Forklift
LC: 1..* - 1..*
EC: 1 - 0...1
TR: D

Container -> Transport Document
LC: 1..* - 1..*
EC: 0...* - 0
TR: P

Vehicle -> Forklift
LC: 1..* - 1..*
EC: 0...1 - 0...1
TR: D

Handling Unit -> Container
LC: 1..* - 1
EC: 0...1 - 0...1
TR: D

Transport Document -> Customer Order
LC: 1..* - 1
EC: 0...1 - 0...1
TR: Ii

Vehicle -> Container
LC: 1 - 1..*
EC: 0 - 0...1
TR: Di

Vehicle -> Transport Document
LC: 1..* - 1..*
EC: 0...1 - 0...1
TR: P

Finished building the temporal graph, end time: 2025-08-17 11:13:57.906388
{'nodes': {'Truck', 'Handling Unit', 'Container', 'Forklift', 'Vehicle', 'Transport Document', 'Customer Order'}, 'P': {('Container', 'Transport Document'), ('Customer Order', 'Transport Document'), ('Vehicle', 'Transport Document')}, 'I': set(), 'D': {('Vehicle', 'Forklift'), ('Handling Unit', 'Truck'), ('Container', 'Truck'), ('Container', 'Vehicle'), ('Handling Unit', 'Container'), ('Container', 'Forklift')}}
```