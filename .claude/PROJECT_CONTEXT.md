# Totem-Tool: Process Mining Software - Project Context

**DO NOT MODIFY THIS FILE** - It serves as automatic context for Claude Code

## Project Overview

Totem-Tool is a web-based process mining application for analyzing Object-Centric Event Logs (OCEL). The project has **3 student assistants working on it with a 2-week deadline**, so the software needs to be presentable and stable.

**Current State**: The software feels buggy with several issues that need fixing.

**Out of Scope**: Electron build - focus only on frontend and backend.

---

## Architecture: Three-Layer Pattern

```
┌─────────────────────────────────────────────────────────────┐
│           FRONTEND (React + TypeScript)                     │
│  Location: ./frontend/                                      │
│  - UI components for visualization                          │
│  - Dashboard grid system (GridStack)                        │
│  - File upload and management                               │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP/REST API
                         ↓
┌─────────────────────────────────────────────────────────────┐
│         BACKEND (Django REST Framework)                     │
│  Location: ./backend/                                       │
│  - HTTP API layer on top of totem_lib                       │
│  - User authentication (JWT)                                │
│  - File/project/dashboard management                        │
│  - Caching of OCEL objects                                  │
└────────────────────────┬────────────────────────────────────┘
                         │ Direct function calls
                         ↓
┌─────────────────────────────────────────────────────────────┐
│         TOTEM_LIB (Python - Core Analysis)                  │
│  Location: ./totem_lib/                                     │
│  - ALL computation and analysis logic                       │
│  - DuckDB SQLite connection and query backend               │
│  - Process mining algorithms (variants, TOTEM, OCDFG, OCCN) │
│  - NO web/HTTP concerns                                     │
└─────────────────────────────────────────────────────────────┘
```

**Key Principle**: Django is ONLY a thin HTTP layer. All analysis computation lives in totem_lib.

---

## User Flow: Loading Data & Creating Dashboards

1. **Upload Event Log** (OCEL file: .sqlite, .json, or .xml)
   - File stored in `backend/user_files/{projectName}/{filename}`
   - Creates a Project and EventLog record in Django DB

2. **View Initial Dashboard**
   - Navigate to `/overview` route
   - See analysis results (Number of Events, etc.)

3. **Create Custom Dashboards**
   - Add new dashboard for specialized analysis
   - Drag components from sidebar (TextBox, NumberOfEvents, Image)
   - Save layout to backend

4. **Analyze Variants**
   - Navigate to `/variantsview` route
   - Select object type as "leading type"
   - View chevron diagrams showing execution patterns

---

## Backend Structure (Django)

**Location**: `./backend/`

### Key Files
- [backend/totem_backend/settings.py](backend/totem_backend/settings.py) - Django config, CORS, JWT settings
- [backend/api/models.py](backend/api/models.py) - Data models (Project, EventLog, Dashboard, Components)
- [backend/api/views.py](backend/api/views.py) - API endpoints (1507 lines - main business logic)
- [backend/api/urls.py](backend/api/urls.py) - URL routing
- [backend/api/serializers.py](backend/api/serializers.py) - API serialization

### Main Models
```python
User (Django built-in)
Project - users (ManyToMany), name, created_at
EventLog - project (FK), file (FileField), uploaded_at
ProjectAsset - project (FK), name, asset_type (TOTEM/OCCN), content_json, metadata, created_by
Dashboard - project (FK), name, order_in_project, created_at
DashboardComponent (base) - dashboard (FK), x, y, w, h, component_name, order
  ├─ NumberofEventsComponent - color
  ├─ TextBoxComponent - text, font_size
  ├─ ImageComponent - image (ImageField)
  ├─ VariantsComponent - automatic_loading, leading_object_type, extraction, iso, timeout_s
  ├─ ProcessAreaComponent
  ├─ LogStatisticsComponent - show_num_events, show_num_activities, show_num_objects, etc.
  ├─ OCDFGComponent - show_controls, initial_interaction_locked
  ├─ OCDottedChartComponent - file_id, x_axis, y_axis, color_by, max_points, etc.
  ├─ NewOCDFGComponent - show_controls, initial_interaction_locked, layout_direction
  └─ OCCNComponent - relative_occurrence_threshold, layout_direction, object_types
```

### Key API Endpoints

**File & Asset Management**:
- `GET /api/files/` - List user's event log files
- `POST /api/files/` - Upload new OCEL file (.sqlite, .json, .xml)
- `GET /api/assets/` - List project assets (TOTeM / OCCN JSON)
- `POST /api/assets/` - Upload or create project asset

**Analysis & Visualization**:
- `GET /api/variants/?file_id={id}&leading_type={type}` - Discover process variants
- `GET /api/ocdfg/?file_id={id}` - Object-Centric DFG discovery
- `GET /api/new-ocdfg/?file_id={id}` - Enhanced OCDFG with variant frequencies
- `GET /api/occn/?file_id={id}` - Object-Centric Causal Network discovery
- `GET /api/oc-dotted-chart/?file_id={id}` - OC-Dotted Chart sampling data
- `GET /api/statistics/?file_id={id}` - Event log summary statistics
- `POST /api/playout/` - Playout execution engine for OCPN/OCCN/TOTeM models
- `POST /api/playout/export-ocel/` - Export playout runs as OCEL 2.0 JSON

**Dashboard Management**:
- `GET /api/dashboard/` - List dashboards
- `POST /api/dashboard/` - Create dashboard
- `PATCH /api/dashboard/{id}/rename/` - Rename dashboard
- `DELETE /api/dashboard/{id}/` - Delete dashboard
- `GET /api/dashboard/{id}/get_layout/` - Get dashboard components (polymorphic)
- `POST /api/dashboard/{id}/save_layout/` - Save component layout

**Authentication & Health**:
- `POST /token/` - Obtain JWT access/refresh tokens
- `POST /token/refresh/` - Refresh access token
- `POST /logout/` - Blacklist refresh token
- `GET /api/health-check/` - Unauthenticated health check endpoint

### Important Backend Functions

**`_with_ocel_db(file_id, request_user)` context manager in views.py**:
- Verifies user ownership/permission for `file_id`.
- Ensures thread-safe worker connection to DuckDB OCEL storage (`_ocel_dbs` connection pool guarded by `_ocel_db_lock`).
- Grants exclusive DuckDB access during query execution to prevent race conditions.

**`variants(request)` view**:
- Uses `_with_ocel_db` to acquire DuckDB connection.
- Calls `totem_lib` discovery routines.
- For each variant, calls `totem_lib.calculate_layout(variant, db)`.
- Returns variant graphs with nodes, edges, and objects for frontend rendering.

### Caching Strategy

- **DuckDB Worker Connections**: `_ocel_dbs` holds worker-bound DuckDB connections initialized from SQLite OCEL files. Double-checked locking via `_ocel_db_lock` ensures single connection setup per worker.
- **OCCN Base Net Cache**: `_occn_base_cache` (LRU OrderedDict, max 4 entries) caches raw threshold-0 base nets keyed by `(file_id, object_types_tuple)` to avoid costly discovery on slider changes. `apply_relative_occurrence_threshold()` filters network on demand.

---

## Totem Lib Structure (Core Analysis)

**Location**: `./totem_lib/src/totem_lib/`

### Key Files
- [totem_lib/src/totem_lib/ocel.py](totem_lib/src/totem_lib/ocel.py) - OCEL data structure (uses Polars)
- [totem_lib/src/totem_lib/ocvariants.py](totem_lib/src/totem_lib/ocvariants.py) - Variant discovery & layout
- [totem_lib/src/totem_lib/totem.py](totem_lib/src/totem_lib/totem.py) - Temporal graph discovery
- [totem_lib/src/totem_lib/ocdfg.py](totem_lib/src/totem_lib/ocdfg.py) - OCDFG representation

### Core Data Structure: ObjectCentricEventLog

```python
class ObjectCentricEventLog:
    events: pl.DataFrame  # _eventId, _activity, _timestampUnix, _objects, _qualifiers
    objects: pl.DataFrame  # _objId, _objType, _targetObjects, _qualifiers
    o2o_graph_edges: Dict[str, Set[str]]  # Object-to-object relationships
    event_cache: Dict[str, Event]  # Fast event lookup
    obj_type_map: Dict[str, str]  # objId -> objType
```

Uses **Polars DataFrames** for efficient columnar storage.

### Supported File Formats
- `.sqlite` / `.db` - SQLite OCEL database
- `.json` - JSON-based OCEL
- `.xml` - XML-based OCEL

Loaders auto-detect format: `import_ocel(path)`

### Key Algorithms

**`find_variants(ocel: ObjectCentricEventLog, leading_type: str) -> Variants`**:
- Discovers execution patterns for a specific object type
- Groups executions by activity sequence
- Returns `Variants` container with:
  - `id`: VariantId
  - `support`: frequency count
  - `executions`: List of event sequences
  - `graph`: NetworkX DiGraph

**`calculate_layout(variant, ocel) -> Dict`**:
- Converts abstract variant to visualization-ready layout
- X-coordinates: topological depth in DAG
- Y-coordinates: lane per object type
- Returns:
```python
{
  "nodes": [
    {
      "id": str,
      "activity": str,
      "x": int,  # topological position
      "y_lane": int,  # lane for this object type
      "y_lanes": List[int],  # all lanes (multi-object events)
      "types": List[str],  # object types
      "objectIds": List[str],
      "timestamp": int
    }
  ],
  "edges": [{"from": str, "to": str}, ...],
  "objects": [{"id": str, "type": str}, ...]
}
```

**`totemDiscovery(ocel) -> Totem`**:
- Mines temporal relations between activities
- Returns `Totem` object with:
  - `tempgraph`: Temporal relationships
  - `cardinalities`: Event cardinalities
  - `type_relations`: Object type pairs

**`mlpaDiscovery(totem) -> Dict`**:
- Multi-level process abstraction
- Converts temporal graph to process view

### Dependencies (Key)
- `polars` - Fast DataFrame operations
- `networkx` - Graph algorithms
- `pm4py` - Process mining library
- `pandas` - Data manipulation

---

## Frontend Structure (React + TypeScript)

**Location**: `./frontend/src/`

### Key Files
- [frontend/src/App.tsx](frontend/src/App.tsx) - Root routing
- [frontend/src/ProcessOverview.tsx](frontend/src/ProcessOverview.tsx) - Dashboard view
- [frontend/src/VariantsOverview.tsx](frontend/src/VariantsOverview.tsx) - Variant analysis view
- [frontend/src/UploadView.tsx](frontend/src/UploadView.tsx) - File upload
- [frontend/src/components/grid.tsx](frontend/src/components/grid.tsx) - Dashboard grid
- [frontend/src/components/app-sidebar.tsx](frontend/src/components/app-sidebar.tsx) - Sidebar navigation

### Routes
```
/upload → UploadView (file upload)
/overview → ProcessOverview (dashboard view)
/variantsview → VariantsOverview (variant analysis)
/login → Login
/logout → Logout
/userdatadelete → DeleteView
```

### Context Providers

**SelectedFileContext**:
- Tracks currently selected event log file
- Used across views to know which file to analyze

**DashboardContext**:
- Tracks currently selected dashboard ID
- Triggers grid to load different dashboards

### API Layer

**Location**: `./frontend/src/api/`

- [fileApi.tsx](frontend/src/api/fileApi.tsx) - File upload, list files, process file
- [dashboardApi.tsx](frontend/src/api/dashboardApi.tsx) - Dashboard CRUD operations
- [componentsApi.tsx](frontend/src/api/componentsApi.tsx) - Dashboard component management
- [authApi.tsx](frontend/src/api/authApi.tsx) - Login, logout, token management

All API calls include JWT token in `Authorization: Bearer {token}` header.

### Key React Components

**VariantsExplorer** ([frontend/src/react_component/VariantsExplorer.tsx](frontend/src/react_component/VariantsExplorer.tsx)):
- Renders chevron diagrams for process variants
- Takes variant graph from backend (nodes, edges, objects)
- Chevron shape: polygon with arrow tip
- Lanes for different object types
- Colors by object type
- Supports search/filter by support

**Dashboard Components**:
- **TextBoxComponent**: Editable text display
- **NumberOfEventsComponent**: Calls `/api/files/{id}/NoE/` to show event count
- **ImageComponent**: Upload and display images

**Component Registry** ([frontend/src/components/componentMap.tsx](frontend/src/components/componentMap.tsx)):
Maps `component_name` string to React component:
```typescript
{
  "TextBoxComponent": TextBoxComponent,
  "NumberOfEventsComponent": NumberOfEventsComponent,
  "ImageComponent": ImageComponent
}
```

### Grid/Layout System

**GridStack Integration**:
- [frontend/src/gridstack/GridProvider.tsx](frontend/src/gridstack/GridProvider.tsx) - Manages GridStack instance
- [frontend/src/components/grid.tsx](frontend/src/components/grid.tsx) - Main grid container

**Flow**:
1. User selects dashboard → `setSelectedDashboard(id)`
2. Grid component watches context change
3. Calls `getLayout(dashboardId)` API
4. Backend returns array of components with x, y, w, h, component_name
5. `GridProvider` initializes GridStack with layout
6. For each component, looks up React component in `componentMap`
7. Renders component with saved props

**Edit Mode**:
- Toggle edit mode → show SidePanel with component palette
- Drag components from palette to grid
- Resize/move components
- Click Save → POST to `/api/dashboard/{id}/save_layout/`

### Dependencies (Key)
- `react-router-dom` - Routing
- `gridstack` - Dashboard grid
- `d3` - Graph visualization
- `reactflow` / `xyflow` - Graph rendering
- `tailwindcss` - Styling
- `axios` - HTTP client

---

## How Analysis Components Work

### Pattern: Frontend Component → Backend Endpoint → Totem Lib Function

**Example: Adding a new analysis visualization**

1. **Totem Lib** - Create computation function
   ```python
   # totem_lib/src/totem_lib/my_analysis.py
   def compute_my_analysis(ocel: ObjectCentricEventLog) -> Dict:
       # Analysis logic here
       return {"result": ...}
   ```

2. **Backend** - Create Django endpoint
   ```python
   # backend/api/views.py
   @api_view(['GET'])
   def my_analysis_view(request):
       file_id = request.query_params.get('file_id')
       eventlog = EventLog.objects.get(pk=file_id)

       ocel = _build_ocel_from_path(eventlog.file.path)  # Cached
       result = compute_my_analysis(ocel)  # Call totem_lib

       return Response(result)
   ```

   ```python
   # backend/api/urls.py
   path('my-analysis/', views.my_analysis_view, name='my-analysis')
   ```

3. **Frontend** - Create React component
   ```typescript
   // frontend/src/react_component/MyAnalysisComponent.tsx
   export function MyAnalysisComponent({ node, isEditMode }) {
       const [data, setData] = useState(null);
       const { selectedFile } = useSelectedFile();

       useEffect(() => {
           fetch(`/api/my-analysis/?file_id=${selectedFile.id}`, {
               headers: { Authorization: `Bearer ${token}` }
           })
           .then(res => res.json())
           .then(setData);
       }, [selectedFile]);

       return <div>{/* Render visualization */}</div>;
   }
   ```

4. **Register Component**
   ```typescript
   // frontend/src/components/componentMap.tsx
   import { MyAnalysisComponent } from '../react_component/MyAnalysisComponent';

   export const componentMap = {
       // ...existing components
       "MyAnalysisComponent": MyAnalysisComponent
   };
   ```

5. **Add to Palette**
   ```typescript
   // frontend/src/components/SidePanel.tsx
   // Add drag-and-drop template for new component
   ```

6. **Backend Model** (if persistence needed)
   ```python
   # backend/api/models.py
   class MyAnalysisComponent(DashboardComponent):
       color = models.CharField(max_length=50)
       # Add any configuration fields
   ```

---

## Authentication Flow

1. **Login**: `POST /token/` with `{username, password}`
   - Returns `{access: "...", refresh: "..."}`
   - Access token expires in **1 minute**
   - Refresh token expires in **2 minutes**

2. **Store Tokens**: `localStorage.setItem("access_token", token)`

3. **API Requests**: Include `Authorization: Bearer {access}` header

4. **Refresh**: `POST /token/refresh/` with `{refresh: token}`
   - Returns new access token

5. **Logout**: `POST /logout/` with `{refresh_token}`
   - Blacklists refresh token

**Data Isolation**: All queries filter by `project__users=request.user`

---

## Common Development Patterns

### Reading Files
**ALWAYS read files before editing**. If user asks to modify a component, read it first to understand the current implementation.

### Finding Code
- **Specific class/function**: Use Glob tool (faster)
- **Concept/keyword**: Use Grep tool
- **Understanding architecture**: Use Task tool with Explore agent

### Git Commits
- Only commit when user explicitly asks
- Follow repository's commit message style
- Include: `Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>`
- Never use `--amend` unless requested

### Testing Changes
- Frontend: `cd frontend && npm run dev`
- Backend: `cd backend && python manage.py runserver`
- Always test in both layers after changes

---

## Current Known Issues

The software "feels quite buggy" with several issues. Common areas to check:
- Authentication flow (JWT expiry, token refresh)
- File upload and OCEL loading
- Dashboard component save/load
- Variant visualization rendering
- API error handling
- CORS configuration

---

## Development Environment

**Backend**:
```bash
cd backend
python manage.py runserver  # Runs on localhost:8000
```

**Frontend**:
```bash
cd frontend
npm run dev  # Runs on localhost:3000
```

**Database**: SQLite (`backend/db.sqlite3`)

**File Storage**: `backend/user_files/{projectName}/`

---

## Team Context

- **3 student assistants** working on the project
- **2-week deadline** for presentable software
- Focus on stability and bug fixes over new features
- Frontend and backend only (ignore Electron)

---

## File Reference Quick Links

### Backend Core
- [backend/api/views.py](backend/api/views.py) - Main API logic
- [backend/api/models.py](backend/api/models.py) - Database models
- [backend/totem_backend/settings.py](backend/totem_backend/settings.py) - Django config

### Totem Lib Core
- [totem_lib/src/totem_lib/ocel.py](totem_lib/src/totem_lib/ocel.py) - OCEL data structure
- [totem_lib/src/totem_lib/ocvariants.py](totem_lib/src/totem_lib/ocvariants.py) - Variant analysis

### Frontend Core
- [frontend/src/App.tsx](frontend/src/App.tsx) - Root app & routing
- [frontend/src/react_component/VariantsExplorer.tsx](frontend/src/react_component/VariantsExplorer.tsx) - Main visualization
- [frontend/src/components/grid.tsx](frontend/src/components/grid.tsx) - Dashboard grid

---

**Last Updated**: 2026-01-21
**Generated by**: Claude Code (Explore agent)
