# TOTeM-Tool System Documentation & User Guide

## Overview of TOTeM-Tool
TOTeM-Tool is an interactive, web-based platform for Object-Centric Process Mining (OCPM). Unlike traditional process mining tools that assume a single case identifier, TOTeM-Tool natively handles event logs with multiple interconnected object types (e.g., Orders, Items, Packages, Customers) where events can involve zero, one, or multiple objects simultaneously.

---

## Event Log Upload & Management
- **Supported Formats**: OCEL 2.0 JSON (`.jsonocel`), OCEL XML (`.xmlocel`), and DuckDB/SQLite relational event logs.
- **Upload Area**: Navigate to `/upload` or use the file upload dropzone (`upload-area`). You can drag and drop event log files directly onto the dropzone.
- **Projects**: Each event log belongs to a Project. You can create multiple projects and switch between active logs.

---

## Process Overview & Variants
- **Process Overview (`/overview`)**: Displays summary metrics including total events, total objects, object types, and activity breakdown.
- **Variants Table (`variants-table`)**: Shows discovered object-centric trace variants sorted by frequency/support.
- **Process Area (`process-area-canvas`)**: Visualizes the spatial relationships and interactions between different object types across the process lifecycle.
- **Filtering**: You can filter variants by leading object type, minimum support threshold, or specific activities.

---

## Analysis Tools (`/variantsview` / Analysis Section)
- **Object-Centric Dotted Chart (`dotted-chart-canvas`)**: Plots events over time along the X-axis against activities or objects on the Y-axis. Supports color-coding by activity or object type, and handles large logs via intelligent sampling.
- **Object-Centric Directly-Follows Graph / OC-DFG (`ocdfg-canvas`)**: Illustrates direct-follows dependencies partitioned by object type, annotated with frequency counts or execution performance durations.
- **Multi-Level Process Abstraction / MLPA (`mlpa-canvas`)**: Provides hierarchical abstraction of process models into distinct abstraction levels and granularities.
- **Object-Centric Causal Nets / OCCN (`occn-canvas`)**: Discovers causal dependency structures and input/output marker groups across multiple object types.

---

## Conformance Checking
- **TOTeM Conformance**: Computes alignment and conformance metrics between discovered TOTeM models and recorded event logs.
- **OCCN Conformance & Replay Fitness**: Replays multi-object traces against OCCN models to compute fitness, detect missing/remaining tokens, and identify deviations.

---

## Model Editors (`sidebar-editor`)
- **Visual Model Editors (`editor-canvas`, `editor-toolbar`)**: Create and edit TOTeM models, OCCNs, and OCPNs using an interactive drag-and-drop canvas.
- **Model Assets**: Save models to the Project Asset Store and import/export stable JSON representations.

---

## Playout Simulation (`sidebar-playout`, `playout-controls`)
- **Playout Engine**: Simulates execution paths on process models to generate synthetic object-centric event logs and trace variants for what-if scenario testing.

---

## Custom Dashboards (`sidebar-dashboard`, `dashboard-grid`)
- **Dashboard Grid (`dashboard-grid`)**: A flexible, draggable grid layout where users can assemble customized analytics views.
- **Adding Components (`dashboard-add-component`)**: Available components include:
  - `NumberofEventsComponent`: Total event counter metric card.
  - `TextBoxComponent`: Markdown/rich text notes and annotations.
  - `ImageComponent`: External or uploaded image display.
  - `VariantsComponent`: Embedded variants table and frequency distribution.
  - `ProcessAreaComponent`: Embedded process area interaction diagram.
  - `LogStatisticsComponent`: Comprehensive log metrics table.
  - `OCDFGComponent` / `NewOCDFGComponent`: Directly-follows graph widget.
  - `OCDottedChartComponent`: Interactive dotted chart widget.
  - `OCCNComponent`: Object-centric causal net widget.
- **Dashboard Management**: Users can create multiple dashboards, rename them, configure component dimensions, and delete them.

---

## Mining Settings & Algorithms
- **Extraction Strategy (`settings-extraction`)**:
  - `leading_1hop`: Extracts subgraphs within 1 hop of the leading object.
  - `leading_bfs`: Breadth-first traversal from the leading object.
  - `connected`: Extracts all connected components without requiring a leading object.
- **Isomorphism Strategy (`settings-iso`)**:
  - `wl+vf2`: Fast Weisfeiler-Lehman coloring with VF2 graph isomorphism verification (recommended).
  - `db_signature`: Database-level relational signature hashing.
  - `exact`: Exact graph isomorphism test.
- **Timeout (`settings-timeout`)**: Maximum calculation timeout in seconds (default 10s, max 120s).

---

## AI Assistant Dual-Channel Modes
- **Teach Mode**: Natural language guidance with automated UI spotlight highlights (`highlighter`) and step-by-step tours. When asked "How do I...", the assistant demonstrates the steps directly on the user's screen.
- **Act Mode**: Autonomous agent execution using MCP tools. Read-only queries execute instantly, while mutating actions (creating dashboards, modifying layout) require user approval via interactive confirmation chips.
