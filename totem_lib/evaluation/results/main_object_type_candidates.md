# Main object types for OCCN conformance: candidates per log

OCCN conformance checks only a log's *main* object types (`MAIN_OBJECT_TYPES` in
`evaluation/algorithms.py`). For each log, every object type with its MLPA level
(0 = lowest, the most short-lived types), its number of objects, and the number of
events it takes part in. **MLPA pick** marks what the automatic rule (the biggest
area on the lowest level) chose. Type names are as the DuckDB importer stores them,
which for some logs differs from the original (spaces or colons removed): use them
exactly as listed here.

Not listed: `p2p` (SAP) and `angular-github-commits`, which do not load into DuckDB
correctly yet.

## github-pm4py (GitHub, 1,798 events)

| Object type | MLPA level | Objects | Events | MLPA pick |
|---|---|---|---|---|
| `Orgresource` | 0 | 178 | 1,798 | yes |
| `Caseconceptname` | 0 | 353 | 1,798 | yes |
| `Caserepo` | 1 | 1 | 1,798 |  |

## recruiting (Recruiting, 6,980 events)

| Object type | MLPA level | Objects | Events | MLPA pick |
|---|---|---|---|---|
| `Offers` | 0 | 135 | 270 | yes |
| `Applications` | 1 | 916 | 6,607 |  |
| `Recruiters` | 2 | 20 | 5,233 |  |
| `Applicants` | 2 | 288 | 2,859 |  |
| `Vacancies` | 2 | 140 | 2,451 |  |
| `Managers` | 2 | 6 | 1,492 |  |

## transfer-order (Transfer, 10,319 events)

| Object type | MLPA level | Objects | Events | MLPA pick |
|---|---|---|---|---|
| `Nlqnr` | 0 | 1,413 | 10,319 | yes |
| `Matnr` | 0 | 437 | 10,319 | yes |
| `Nlpla` | 1 | 597 | 10,319 |  |
| `Werks` | 1 | 17 | 10,319 |  |
| `Qname` | 1 | 36 | 10,298 |  |

## ocel2-p2p (P2P, 14,671 events)

| Object type | MLPA level | Objects | Events | MLPA pick |
|---|---|---|---|---|
| `payment` | 0 | 927 | 1,166 | yes |
| `invoice receipt` | 1 | 927 | 5,048 |  |
| `goods receipt` | 2 | 1,941 | 9,090 |  |
| `material` | 2 | 2,296 | 1,458 |  |
| `purchase_order` | 3 | 1,598 | 8,404 |  |
| `quotation` | 3 | 927 | 4,123 |  |
| `purchase_requisition` | 3 | 927 | 2,385 |  |

## order-management (OrderMgmt, 21,008 events)

| Object type | MLPA level | Objects | Events | MLPA pick |
|---|---|---|---|---|
| `orders` | 0 | 2,000 | 6,566 | yes |
| `packages` | 0 | 1,128 | 3,695 |  |
| `items` | 1 | 7,659 | 21,008 |  |
| `products` | 2 | 20 | 21,008 |  |
| `employees` | 2 | 18 | 16,442 |  |
| `customers` | 2 | 15 | 4,000 |  |

## lrms-reasoning-steps (ReasonBM, 31,709 events)

| Object type | MLPA level | Objects | Events | MLPA pick |
|---|---|---|---|---|
| `MODQUE` | 0 | 1,610 | 31,709 | yes |
| `MOD` | 1 | 35 | 31,709 |  |

## container_logistics (ContLog, 35,372 events)

| Object type | MLPA level | Objects | Events | MLPA pick |
|---|---|---|---|---|
| `Handling Unit` | 0 | 10,553 | 21,106 | yes |
| `Container` | 1 | 1,999 | 23,029 |  |
| `Transport Document` | 1 | 594 | 1,944 |  |
| `Customer Order` | 1 | 600 | 1,194 |  |
| `Truck` | 2 | 6 | 12,542 |  |
| `Vehicle` | 2 | 127 | 2,692 |  |
| `Forklift` | 3 | 3 | 7,738 |  |

## hinge-production (Hinge, 38,528 events)

| Object type | MLPA level | Objects | Events | MLPA pick |
|---|---|---|---|---|
| `SteelSheet` | 0 | 5,911 | 17,733 | yes |
| `SteelPin` | 0 | 2,907 | 2,907 |  |
| `HingePack` | 0 | 290 | 290 |  |
| `FormedPart` | 1 | 5,911 | 17,651 |  |
| `FemalePart` | 1 | 2,915 | 8,737 |  |
| `MalePart` | 1 | 2,914 | 8,735 |  |
| `SteelCoil` | 1 | 4 | 5,911 |  |
| `Hinge` | 1 | 2,907 | 3,197 |  |
| `Machine` | 2 | 7 | 32,670 |  |
| `Workstation` | 3 | 3 | 38,499 |  |
| `Facility` | 3 | 1 | 29 |  |
| `Worker` | 4 | 1 | 5,858 |  |

## bundestag (Bundestag, 62,719 events)

| Object type | MLPA level | Objects | Events | MLPA pick |
|---|---|---|---|---|
| `Schriftliche Frage` | 0 | 20,467 | 20,545 |  |
| `Kleine Anfrage` | 0 | 4,569 | 9,153 |  |
| `EU-Vorlage` | 0 | 3,521 | 6,284 | yes |
| `Mündliche Frage` | 0 | 2,888 | 5,772 |  |
| `Petition` | 0 | 762 | 1,527 |  |
| `Unterrichtung durch das Europäische Parlament` | 0 | 381 | 511 |  |
| `Besetzung externer Gremien durch BR` | 0 | 133 | 426 |  |
| `Ansprache/Erklärung/Mitteilung` | 0 | 356 | 356 |  |
| `Besetzung interner Gremien des BT` | 0 | 109 | 183 |  |
| `Über- und außerplanmäßige Haushaltsausgaben` | 0 | 45 | 151 |  |
| `Allgemeine Verwaltungsvorschrift` | 0 | 29 | 133 |  |
| `Aktuelle Stunde` | 0 | 129 | 129 |  |
| `Regierungserklärung` | 0 | 24 | 64 |  |
| `Befragung der Bundesregierung` | 0 | 57 | 57 |  |
| `Immunitätsangelegenheit` | 0 | 22 | 44 |  |
| `Entlastung der Bundesregierung` | 0 | 4 | 42 |  |
| `Wahl der Ausschussvorsitzenden BR` | 0 | 13 | 39 |  |
| `Rechtsverordnung (Außenwirtschaftsrecht)` | 0 | 4 | 31 |  |
| `Bestellung und Abberufung von MdBR und stellv. MdBR` | 0 | 24 | 24 |  |
| `Entlastung des Bundesrechnungshofes` | 0 | 3 | 21 |  |
| `Enquete-Kommission` | 0 | 6 | 20 |  |
| `Wahl der Richter des Bundesverfassungsgerichts ` | 0 | 7 | 17 |  |
| `Wahlprüfungsverfahren` | 0 | 8 | 16 |  |
| `Verordnungsantrag der Länder` | 0 | 5 | 14 |  |
| `Wahl der Schriftführer BR` | 0 | 4 | 12 |  |
| `Wahl des Präsidiums BR` | 0 | 6 | 12 |  |
| `Parlamentarische Sonderkommission` | 0 | 2 | 9 |  |
| `Vertrauensantrag des Bundeskanzlers` | 0 | 1 | 5 |  |
| `Wahlperiodenwechsel` | 0 | 2 | 3 |  |
| `Wahl des Bundespräsidenten` | 0 | 1 | 1 |  |
| `Anmerkung zur Plenarsitzung` | 1 | 55 | 69 |  |
| `Vereinbarte Debatte` | 1 | 39 | 59 |  |
| `Bericht, Gutachten, Programm` | 2 | 739 | 1,975 |  |
| `Entschließungsantrag BT` | 2 | 223 | 761 |  |
| `Wahl im BT` | 2 | 36 | 73 |  |
| `Besetzung externer Gremien durch BT` | 3 | 116 | 171 |  |
| `Verfahren vor dem Bundesverfassungsgericht` | 3 | 53 | 151 |  |
| `Gesetzgebung` | 4 | 696 | 7,716 |  |
| `Antrag` | 4 | 1,392 | 4,514 |  |
| `Rechtsverordnung` | 4 | 315 | 1,847 |  |
| `Selbständiger Antrag von Ländern auf Entschließung` | 4 | 212 | 787 |  |
| `Geschäftsordnung` | 4 | 163 | 279 |  |
| `Große Anfrage` | 4 | 37 | 91 |  |
| `Untersuchungsausschuss` | 5 | 7 | 32 |  |

## windows-events (Windows, 98,128 events)

| Object type | MLPA level | Objects | Events | MLPA pick |
|---|---|---|---|---|
| `Sourcename` | 0 | 97 | 98,128 | yes |
| `Eventidentifier` | 0 | 280 | 94,495 | yes |
| `Eventtype` | 1 | 4 | 98,128 |  |
| `Categorystring` | 1 | 18 | 98,128 |  |
| `User` | 1 | 4 | 9,712 |  |
| `Computername` | 2 | 1 | 98,128 |  |

## o2c (O2C, 98,350 events)

| Object type | MLPA level | Objects | Events | MLPA pick |
|---|---|---|---|---|
| `Charge` | 0 | 14,734 | 14,734 | yes |
| `Invoicecancel` | 0 | 43 | 43 |  |
| `Creditmemodoc` | 0 | 11 | 11 |  |
| `Debitmemodoc` | 1 | 94 | 97 |  |
| `Returnsdelivery` | 1 | 32 | 59 |  |
| `Creditmemoreq` | 1 | 22 | 23 |  |
| `Returnsdoc` | 2 | 32 | 85 |  |
| `Belnr` | 3 | 33,362 | 33,379 |  |
| `Einkbeleg` | 3 | 26,774 | 26,902 |  |
| `Wmstransfer` | 3 | 4,246 | 4,246 |  |
| `Debitmemoreq` | 3 | 184 | 282 |  |
| `Invoiceproforma` | 3 | 93 | 93 |  |
| `Handlunit` | 4 | 14,439 | 36,389 |  |
| `Verkbeleg` | 4 | 9,490 | 36,207 |  |
| `Infosatz` | 4 | 6 | 10 |  |
| `Itemproposal` | 4 | 3 | 3 |  |
| `Material` | 5 | 4,198 | 45,082 |  |
| `Indipreq` | 5 | 3 | 7 |  |
| `Ordwocharge` | 6 | 1 | 3 |  |

## enron (Enron, 517,891 events)

| Object type | MLPA level | Objects | Events | MLPA pick |
|---|---|---|---|---|
| `Messageid` | 0 | 275,815 | 299,015 | yes |
| `Emailaddress` | 1 | 41,033 | 516,171 |  |

## age-of-empires (AoE, 2,372,505 events)

| Object type | MLPA level | Objects | Events | MLPA pick |
|---|---|---|---|---|
| `Farm` | 0 | 61,534 | 184,434 |  |
| `House` | 0 | 43,082 | 86,104 |  |
| `LumberCamp` | 0 | 7,130 | 23,529 |  |
| `SiegeWorkshop` | 0 | 1,391 | 22,691 | yes |
| `MiningCamp` | 0 | 6,380 | 20,210 |  |
| `Mill` | 0 | 3,853 | 13,194 |  |
| `Dock` | 0 | 325 | 7,189 |  |
| `Market` | 0 | 1,584 | 3,239 |  |
| `Outpost` | 0 | 1,339 | 2,630 |  |
| `PalisadeGate` | 0 | 1,109 | 1,998 |  |
| `WatchTower` | 0 | 866 | 1,688 |  |
| `Gate` | 0 | 2,133 | 574 |  |
| `BombardTower` | 0 | 67 | 134 |  |
| `None` | 0 | 90 | 132 |  |
| `FishTrap` | 0 | 46 | 92 |  |
| `Feitoria` | 0 | 22 | 44 |  |
| `Krepost` | 0 | 19 | 38 |  |
| `Donjon` | 0 | 10 | 20 |  |
| `Villager` | 1 | 209,589 | 1,323,718 |  |
| `TownCenter` | 1 | 5,347 | 950,253 |  |
| `Stable` | 1 | 5,253 | 315,672 |  |
| `ArcheryRange` | 1 | 3,751 | 221,469 |  |
| `Barracks` | 1 | 4,063 | 195,311 |  |
| `Castle` | 1 | 2,558 | 58,114 |  |
| `Blacksmith` | 1 | 1,895 | 22,154 |  |
| `Monastery` | 1 | 1,300 | 19,106 |  |
| `University` | 1 | 791 | 2,987 |  |
| `Session` | 2 | 2,000 | 2,372,505 |  |
| `Player` | 2 | 1,759 | 1,007,864 |  |
| `Match` | 3 | 1,000 | 2,372,505 |  |
| `ShrivamshaRider` | - | 106 | 0 |  |
| `Genitour` | - | 7 | 0 |  |
| `Konnik` | - | 4 | 0 |  |
| `HorseB` | - | 4 | 0 |  |
| `FireGalley` | - | 234 | 0 |  |
| `Goose` | - | 130 | 0 |  |
| `Petard` | - | 162 | 0 |  |
| `Gateup` | - | 458 | 0 |  |
| `CamelScout` | - | 12,990 | 0 |  |
| `Longbowman` | - | 417 | 0 |  |
| `ShotelWarrior` | - | 1,088 | 0 |  |
| `Militia` | - | 7,477 | 0 |  |
| `Berserk` | - | 446 | 0 |  |
| `Ratha` | - | 4 | 0 |  |
| `PalisadeGateup` | - | 27 | 0 |  |
| `WarElephant` | - | 40 | 0 |  |
| `PalisadeGatedown` | - | 28 | 0 |  |
| `TeutonicKnight` | - | 121 | 0 |  |
| `RattanArcher` | - | 22 | 0 |  |
| `DemolitionRaft` | - | 10 | 0 |  |
| `Kamayuk` | - | 5 | 0 |  |
| `MagyarHuszar` | - | 701 | 0 |  |
| `BatteringRam` | - | 794 | 0 |  |
| `Scorpion` | - | 1,064 | 0 |  |
| `Sheep` | - | 254 | 0 |  |
| `Mangonel` | - | 1,450 | 0 |  |
| `WaterBuffalo` | - | 66 | 0 |  |
| `Huskarl` | - | 89 | 0 |  |
| `SiegeTower` | - | 1 | 0 |  |
| `Archer` | - | 30,186 | 0 |  |
| `EagleScout` | - | 4,279 | 0 |  |
| `ChakramThrower` | - | 143 | 0 |  |
| `CavalryArcher` | - | 8,551 | 0 |  |
| `Samurai` | - | 296 | 0 |  |
| `Obuch` | - | 99 | 0 |  |
| `HandCannoneer` | - | 3,652 | 0 |  |
| `Keshik` | - | 9 | 0 |  |
| `TransportShip` | - | 7 | 0 |  |
| `StoneWall` | - | 15,648 | 0 |  |
| `OrganGun` | - | 578 | 0 |  |
| `Coustillier` | - | 2 | 0 |  |
| `Arambai` | - | 490 | 0 |  |
| `Skirmisher` | - | 23,359 | 0 |  |
| `PalisadeWall` | - | 1,103 | 0 |  |
| `BactrianCamel` | - | 8 | 0 |  |
| `Monk` | - | 3,279 | 0 |  |
| `ElephantArcher` | - | 482 | 0 |  |
| `Turkey` | - | 116 | 0 |  |
| `Trebuchet` | - | 1,845 | 0 |  |
| `Janissary` | - | 608 | 0 |  |
| `JaguarWarrior` | - | 76 | 0 |  |
| `CannonGalleon` | - | 1 | 0 |  |
| `Goat` | - | 522 | 0 |  |
| `GenoeseCrossbowman` | - | 428 | 0 |  |
| `SteppeLancer` | - | 3,258 | 0 |  |
| `Gatedown` | - | 465 | 0 |  |
| `Missionary` | - | 54 | 0 |  |
| `WarriorPriest` | - | 15 | 0 |  |
| `HorseC` | - | 2 | 0 |  |
| `Llama` | - | 157 | 0 |  |
| `Leitis` | - | 935 | 0 |  |
| `Mangudai` | - | 1,634 | 0 |  |
| `BattleElephant` | - | 619 | 0 |  |
| `FishingShip` | - | 1,061 | 0 |  |
| `Conquistador` | - | 1,050 | 0 |  |
| `Cataphract` | - | 265 | 0 |  |
| `Caravel` | - | 2 | 0 |  |
| `ScoutCavalry` | - | 42,400 | 0 |  |
| `CamelArcher` | - | 375 | 0 |  |
| `Spearman` | - | 43,684 | 0 |  |
| `HussiteWagon` | - | 666 | 0 |  |
| `Pig` | - | 252 | 0 |  |
| `WarWagon` | - | 20 | 0 |  |
| `ArmoredElephant` | - | 68 | 0 |  |
| `SeaTower` | - | 34 | 0 |  |
| `BombardCannon` | - | 1,072 | 0 |  |
| `PlumedArcher` | - | 4 | 0 |  |
| `KarambitWarrior` | - | 829 | 0 |  |
| `Gbeto` | - | 406 | 0 |  |
| `HorseA` | - | 4 | 0 |  |
| `TradeCart` | - | 13 | 0 |  |
| `Boyar` | - | 342 | 0 |  |
| `ThrowingAxeman` | - | 344 | 0 |  |
| `Knight` | - | 35,895 | 0 |  |
| `Mameluke` | - | 11 | 0 |  |
| `Galley` | - | 201 | 0 |  |
| `HorseE` | - | 2 | 0 |  |
| `Tarkan` | - | 2 | 0 |  |
| `ChuKoNu` | - | 175 | 0 |  |
| `BallistaElephant` | - | 22 | 0 |  |

