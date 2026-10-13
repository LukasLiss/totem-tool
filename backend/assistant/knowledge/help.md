# TOTEM Process Mining Documentation

## 1. Overview & Core Architecture
TOTEM is an advanced Object-Centric Process Mining (OCPM) platform designed to discover, analyze, and visualize complex multi-object business processes from Object-Centric Event Logs (OCEL). Unlike traditional process mining which assumes a single case identifier, TOTEM supports multiple interacting object types simultaneously (such as orders, items, packages, and invoices), preventing divergence and convergence anomalies.

Key capabilities include:
- Object-Centric Directly-Follows Graph (OC-DFG) discovery
- Object-Centric C-Net (OCCN) formal modeling
- Multi-Level Process Architecture (MLPA) decomposition
- Trace variant extraction with graph isomorphism
- Temporal dotted chart inspection for bottleneck analysis
- Customizable drag-and-drop dashboards with GridStack
- AI Assistant with dual-channel Teach Mode and Act Mode

---

## 2. Process Graph & Model Discovery

### Object-Centric Directly-Follows Graphs (OC-DFG)
The OC-DFG visualizes the execution flow of activities across multiple object types. Nodes represent process activities, while directed edges represent execution transitions between activities for specific object types.
- **Node Frequencies**: Displays total execution count for each activity.
- **Edge Frequencies / Thresholds**: Edges can be filtered using the `dfg_threshold` (0.0 to 1.0) to eliminate infrequent transitions and simplify the graph view.
- **Activity Threshold**: Filter out rare activities using `act_threshold`.
- **Leading Type Selection**: Choose the primary object type to focus the discovery view.

### Object-Centric C-Nets (OCCN)
Object-Centric C-Nets (C-Nets) provide formal semantics for object-centric process behavior, capturing input/output bindings, concurrent object synchronization, and routing choices.
- **Discovery Parameters**: Configure `threshold` (0.0 to 1.0) for relation occurrence and select specific `object_types` to include.
- **Bindings**: Visualizes obligate and optional synchronization sets for multi-object transitions.

### Multi-Level Process Architecture (MLPA) / Process Areas
MLPA automatically clusters related activities into modular process areas based on shared object interactions.
- **Threshold**: Adjust the clustering threshold to control the granularity of process areas.
- **Process Areas**: High-level architectural view allowing hierarchical drill-down into specific subprocess domains.

### Graph Layouts & Navigation (ELK / Graphviz)
Process models can be rendered using automatic layout engines (ELK or Graphviz):
- **Layout Direction**: Top-to-Bottom (`TB`) or Left-to-Right (`LR`).
- **Interactive Controls**: Zooming, panning, minimap navigation, and node locking.

---

## 3. Variants Explorer & Trace Clustering

### Leading Object Types
In object-centric logs, cases can be defined relative to a "leading object type". Variants represent distinct sub-graph or sequence execution patterns for instances of the selected leading type.

### Trace Extraction Strategies
TOTEM provides three distinct methods for extracting instance subgraphs from the overall log:
1. **`leading_1hop`**: Extracts the leading object's direct events and all immediately adjacent 1-hop events. Fast and highly interpretable.
2. **`leading_bfs`**: Performs a full Breadth-First Search traversal to capture the complete transitive closure of related events.
3. **`connected`**: Extracts all weakly connected event components across all object relations.

### Graph Isomorphism Algorithms
Extracted trace subgraphs are clustered into equivalence classes (variants) using graph isomorphism algorithms:
1. **`wl+vf2`** (Default): Weisfeiler-Lehman graph hashing followed by exact VF2 isomorphism verification. Fast and 100% accurate.
2. **`wl`**: Fast Weisfeiler-Lehman subtree kernel hashing.
3. **`signature` / `db_signature`**: Structural hash signatures for instant clustering on large logs.
4. **`trace`**: Sequence-based trace equality (ignores cross-object concurrency).
5. **`exact`**: Full strict graph isomorphism checking.
- **Timeout**: Configurable timeout (`timeout_s`, default 10s) to prevent long computations on complex subgraphs.

---

## 4. Temporal Analytics & Bottlenecks (OC Dotted Chart)

### Time-Series Inspection & Axes Configuration
The Object-Centric Dotted Chart plots each event as a discrete point along time and categorization axes to reveal temporal patterns:
- **X-Axis**: Time (absolute calendar time or relative time since instance start).
- **Y-Axis**: Activity, Case/Object ID, Resource, or Process Area.
- **Color By**: Activity, Object Type, Resource, or Performance Metric.
- **Max Points**: Subsampling limit (default 10,000) for smooth rendering.

### Bottleneck Identification & Duration Metrics
The dotted chart exposes:
- **Batch Processing**: Horizontal alignments of identical activities indicate batch execution.
- **Waiting Times & Bottlenecks**: Vertical gaps between successive activities highlight lead time delays.
- **Throughput Deviations**: Variations in point density reveal peak workload periods.

---

## 5. Dashboard Builder & Visualization Cards

### Drag-and-Drop Grid Layout (GridStack)
TOTEM features a flexible dashboard builder powered by GridStack.js:
- Move and resize cards dynamically on a responsive 12-column grid.
- Toggle between **View Mode** (interactive exploration) and **Edit Mode** (card repositioning, resizing, and configuration).
- Save, load, and rename dashboards per project.

### Component Catalog (`componentMap`)
The following visualization cards can be added to any dashboard:
1. **`LogStatisticsComponent`**: Displays key metrics (events, activities, objects, object types, date ranges).
2. **`OCDFGComponent` / `NewOCDFGComponent`**: Embedded interactive OC-DFG visualizer with zoom/pan.
3. **`VariantsComponent`**: Embedded Variants Explorer with variant frequency charts and graph previews.
4. **`OCDottedChartComponent`**: Time-series dotted chart with interactive axis controls.
5. **`OCCNComponent`**: Object-Centric C-Net visualizer with binding inspection.
6. **`ProcessAreaComponent`**: MLPA process area architectural overview.
7. **`TextBoxComponent`**: Markdown notes, annotations, and explanatory text cards.
8. **`ImageComponent`**: Uploaded diagrams, flowcharts, or documentation images.

---

## 6. Dual-Channel AI Assistant (Teach Mode vs. Act Mode)

### Teach Mode (Guided Tours & Spotlight Highlighting)
Teach Mode acts as an interactive coach:
- Answers conceptual questions about process mining and TOTEM features.
- Provides step-by-step instructions.
- Uses the `highlight_element` tool to trigger visual spotlights and callout tooltips on specific UI elements using their `data-tour-id`.
- Guides the user safely without making unexpected state changes.

### Act Mode (Autonomous Execution & Safety Confirmations)
Act Mode acts as an autonomous co-pilot:
- Executes read-only analysis tools immediately (`get_statistics`, `find_variants`, `discover_totem`, etc.).
- When a mutating tool (`create_dashboard`, `add_component`, `remove_component`, `update_component`, `rename_dashboard`) or frontend navigation is invoked, the assistant surfaces a **Pending Action Confirmation Chip**.
- The action is only executed once the user explicitly clicks "Confirm" / "Approve".

---

## 7. Filters & Thresholds
- **DFG Threshold (`dfg_threshold`)**: Range [0.0, 1.0]. Filters out low-frequency directly-follows edges.
- **Activity Threshold (`act_threshold`)**: Range [0.0, 1.0]. Prunes rare activities from discovery.
- **OCCN Occurrence Threshold (`threshold`)**: Range [0.0, 1.0]. Minimum support for causal relations in C-Nets.
- **MLPA Threshold (`threshold`)**: Range [0.0, 1.0]. Clustering threshold for process area grouping.
- **Leading Object Type**: Sets the focal perspective for variant extraction and single-case projection.

---

## 8. Metrics & Event Log Statistics
- **Total Events**: Total number of recorded event instances in the log.
- **Distinct Activities**: Number of unique activity types executed.
- **Total Objects**: Count of distinct object instances tracked across all types.
- **Object Types Count**: Number of distinct object classes (e.g., Order, Item, Delivery).
- **Time Range**: Earliest timestamp, latest timestamp, and total log duration.

---

## 9. Log Management & Asset Storage
- **OCEL Log Upload**: Upload event logs in JSON, XML, SQLite, or CSV formats via the `/upload` view.
- **File Selector (`file-selector`)**: Switch between uploaded logs; updates active `file_id` across all views.
- **Project Switcher (`project-switcher`)**: Organize logs and dashboards into distinct project workspaces.
- **Model Assets (`/analysis`)**: Save discovered TOTeM and OCCN models as reusable assets for playout simulation.
- **Data Deletion (`/userdatadelete`)**: Manage and delete uploaded logs and user files.

---

## 10. UI Navigation & Tour Identifier Catalog
When using Teach Mode, visual spotlights target the following synchronized `data-tour-id` elements:
- `nav-overview`: Navigation button for Process Overview.
- `nav-analysis`: Navigation button for Model Assets and Analysis.
- `nav-conformance`: Navigation button for Conformance Checking.
- `nav-playout`: Navigation button for Playout & Simulation.
- `nav-dashboard`: Navigation button for Dashboard Builder.
- `nav-project`: Project management navigation.
- `upload-button`: File upload trigger button.
- `file-selector`: Active event log dropdown selector.
- `project-switcher`: Project workspace switcher.
- `view-mode-selector`: Tab selector for switching between OCDFG, OCCN, and Variants views.
- `dashboard-grid`: Main GridStack dashboard canvas.
- `dashboard-add-card`: Button to open the Add Component modal.
- `chat-toggle`: Toggle button to open/close the AI Assistant drawer.
- `chat-drawer`: Main AI Chat Assistant panel.
- `chat-input`: Chat text input field.
- `chat-mode-teach`: Switch to Teach Mode (guided tours).
- `chat-mode-act`: Switch to Act Mode (tool execution co-pilot).
