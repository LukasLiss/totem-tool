# Skill: Create Dashboard Component

This skill guides you through making a React component available as a draggable item in the dashboard editor with configurable properties that persist.

## Reference Documentation
See `docs/ADDING_DASHBOARD_COMPONENT.md` for the original documentation.

## Reference Files
- `frontend/src/components/componentMap.tsx` - Component definitions and registry
- `frontend/src/gridstack/lib/gridstackprovider.tsx` - Grid state and layout save/load
- `frontend/src/gridstack/lib/sidepanel.tsx` - Draggable component setup
- `backend/api/models.py` - Django models
- `backend/api/serializers.py` - API serializers
- `backend/api/views.py` - Layout save/load views

---

## Steps Overview

1. Backend: Create Django model
2. Backend: Create serializer
3. Backend: Update views (`get_layout`, `save_layout`)
4. Frontend: Create wrapper component
5. Frontend: Add to `componentMap`
6. Frontend: Add to SidePanel
7. Frontend: Update GridStackProvider (if component has custom properties)
8. Run migrations

---

## Step 1: Backend - Create Model

**File**: `backend/api/models.py`

Create a model extending `DashboardComponent`:

```python
class MyNewComponent(DashboardComponent):
    # Add component-specific fields that need to persist
    my_setting = models.BooleanField(default=False, null=True, blank=True)
    my_option = models.CharField(max_length=100, null=True, blank=True)
```

The base `DashboardComponent` provides: `dashboard`, `x`, `y`, `w`, `h`, `component_name`, `order`

---

## Step 2: Backend - Create Serializer

**File**: `backend/api/serializers.py`

```python
class MyNewComponentSerializer(DashboardComponentSerializer):
    class Meta:
        model = MyNewComponent
        fields = "__all__"
```

Add to the polymorphic serializer mapping:

```python
class DashboardComponentPolymorphicSerializer(PolymorphicSerializer):
    model_serializer_mapping = {
        # ... existing components ...
        MyNewComponent: MyNewComponentSerializer,  # Add this
    }
```

---

## Step 3: Backend - Update Views

**File**: `backend/api/views.py`

### 3a. Update `get_layout` method

```python
@action(detail=True, methods=["GET"])
def get_layout(self, request, pk=None):
    # ... existing code ...
    for comp in base_components:
        # ... existing conditions ...
        elif comp.component_name == 'MyNewComponent':
            components.append(MyNewComponent.objects.get(id=comp.id))
        else:
            components.append(comp)
```

### 3b. Update `save_layout` method

```python
@action(detail=True, methods=["POST"])
def save_layout(self, request, pk=None):
    # ... existing code ...
    for item in layout:
        component_name = item['component_name']
        # ... existing conditions ...
        elif component_name == 'MyNewComponent':
            MyNewComponent.objects.create(
                dashboard=dashboard,
                x=item['x'],
                y=item['y'],
                w=item['w'],
                h=item['h'],
                component_name=component_name,
                my_setting=item.get('my_setting', False),
                my_option=item.get('my_option', ''),
            )
```

Don't forget to import the new model at the top of views.py.

---

## Step 4: Frontend - Create Wrapper Component

**File**: `frontend/src/components/componentMap.tsx`

### 4a. Update ComponentProps interface (if adding new fields)

```typescript
interface ComponentProps {
  node: GridStackNode & {
    component_name?: string;
    // ... existing fields ...
    my_setting?: boolean;     // Add your new fields
    my_option?: string;
  };
  onUpdate?: (updates: Partial<GridStackNode>) => void;
  isEditMode?: boolean;
  selectedFile?: { id: number; [key: string]: any };
}
```

### 4b. Create the component

```typescript
const MyNewComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile,
}) => {
  // Local state initialized from node
  const [mySetting, setMySetting] = useState(node.my_setting ?? false);
  const [myOption, setMyOption] = useState(node.my_option ?? '');

  // Sync with node when it changes (e.g., after loading)
  useEffect(() => {
    setMySetting(node.my_setting ?? false);
    setMyOption(node.my_option ?? '');
  }, [node.my_setting, node.my_option]);

  // Handlers that update local state AND call onUpdate
  const handleSettingChange = (checked: boolean) => {
    setMySetting(checked);
    onUpdate?.({ my_setting: checked } as any);  // Cast needed for custom props
  };

  const handleOptionChange = (value: string) => {
    setMyOption(value);
    onUpdate?.({ my_option: value } as any);
  };

  if (isEditMode) {
    // EDIT MODE: Configuration form
    return (
      <Card className="w-full h-full rounded-none">
        <CardHeader>
          <CardTitle>My Component Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>My Setting</Label>
            <Switch
              checked={mySetting}
              onCheckedChange={handleSettingChange}
            />
          </div>
          {/* Add more form fields as needed */}
        </CardContent>
      </Card>
    );
  }

  // VIEW MODE: Render the actual component
  return (
    <Card className="w-full h-full rounded-none overflow-auto">
      <CardContent className="p-4">
        {/* Your component content here */}
        <p>Setting: {mySetting ? 'On' : 'Off'}</p>
        <p>Option: {myOption || 'None'}</p>
      </CardContent>
    </Card>
  );
};
```

### 4c. Add to componentMap

```typescript
export const componentMap: Record<string, React.FC<ComponentProps>> = {
  TextBoxComponent,
  NumberOfEventsComponent,
  ImageComponent,
  VariantsComponent,
  MyNewComponent,  // Add this
};
```

---

## Step 5: Frontend - Add to SidePanel

**File**: `frontend/src/gridstack/lib/sidepanel.tsx`

### 5a. Add `GridStack.setupDragIn()` in useEffect

```typescript
GridStack.setupDragIn(
  ".sidepanel .my-new-component",
  {
    helper: "clone",
    appendTo: "body",
  },
  [{
    h: 2,                          // Default height
    w: 2,                          // Default width
    content: "My New Component",
    component_name: "MyNewComponent",
    my_setting: false,             // Default values for custom props
    my_option: '',
    order: 0,
  }]
);
```

### 5b. Add draggable UI element

```tsx
<div className="grid-stack-item sidepanel-item my-new-component flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
  <img src="src/images/my-component.png" width="100" height="50"/>
  <div>My New Component</div>
</div>
```

---

## Step 6: Frontend - Update GridStackProvider (Critical for Custom Properties!)

**File**: `frontend/src/gridstack/lib/gridstackprovider.tsx`

### 6a. Update `getLayout()` to extract properties

```typescript
const getLayout = () => {
  // ... existing code ...
  return nodes.map((node, index) => {
    let props: any = {};

    if (component_name === "TextBoxComponent") {
      props = { text: (node as any).text || "", font_size: 14 };
    } else if (component_name === "MyNewComponent") {
      // ADD THIS: Extract your component's properties
      props = {
        my_setting: (node as any).my_setting ?? false,
        my_option: (node as any).my_option ?? '',
      };
    }
    // ... rest of function
  });
};
```

### 6b. Update `loadLayout()` to pass properties to `addWidget()`

```typescript
const widgetEl = gridRef.current?.addWidget({
  x: item.x,
  y: item.y,
  w: item.w,
  h: item.h,
  content,
  component_name: item.component_name,
  // ... existing fields ...
  my_setting: item.my_setting,       // ADD your fields
  my_option: item.my_option,
});
```

### 6c. Update `loadLayout()` to assign properties to node

```typescript
if (node) {
  (node as any).component_name = item.component_name;
  // ... existing assignments ...
  (node as any).my_setting = item.my_setting;       // ADD
  (node as any).my_option = item.my_option;
}
```

---

## Step 7: Run Migrations

```bash
cd backend
python manage.py makemigrations
python manage.py migrate
```

---

## Data Flow Summary

```
SAVE PATH:
User edits setting → onUpdate({ my_prop: value }) → Object.assign(node, updates)
→ User clicks Save → getLayout() extracts props → saveLayout() API
→ Backend creates component → Database

LOAD PATH:
User selects dashboard → getLayout() API → loadLayout() calls addWidget() WITH props
→ GridStack triggers renderCB → Component receives node with props
→ Component initializes state from node → UI displays
```

**Important**: Properties MUST be passed to `addWidget()` because GridStack calls `renderCB` immediately. Properties assigned after `addWidget()` won't be available for the initial render.

---

## Checklist

- [ ] Backend model created with custom fields
- [ ] Backend serializer created and added to polymorphic mapping
- [ ] `get_layout` view updated to cast component
- [ ] `save_layout` view updated to create component with fields
- [ ] Frontend ComponentProps interface updated (if new fields)
- [ ] Frontend wrapper component created with edit/view modes
- [ ] Component added to `componentMap`
- [ ] SidePanel `setupDragIn` added with defaults
- [ ] SidePanel UI element added
- [ ] GridStackProvider `getLayout()` extracts properties
- [ ] GridStackProvider `loadLayout()` passes properties to `addWidget()`
- [ ] GridStackProvider `loadLayout()` assigns properties to node
- [ ] Migrations created and applied
