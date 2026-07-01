# Skill: Create Dev Dashboard Component

This skill guides you through creating a React component that fetches backend data and displays results, following the VariantsExplorer pattern. These components can be used on the dev dashboard and receive `fileId` and authentication token to interact with backend APIs.

## Reference Implementation
See `frontend/src/react_component/VariantsExplorer.tsx` for the complete reference.

---

## Component Structure

### 1. Define Type Exports

Export types that represent backend data structures for type-safe integration:

```typescript
export type MyDataItem = {
  id: string;
  // ... fields matching backend response
};

export type MyComponentData = {
  items: MyDataItem[];
  // ... other response fields
};
```

### 2. Define Props Interface

```typescript
type MyComponentProps = {
  fileId?: number;                    // Event log file ID (required for data fetching)
  automaticLoading?: boolean;         // Auto-load data vs manual trigger (default: false)
  onDataLoad?: (data: MyData[]) => void;  // Optional callback when data loads
  embedded?: boolean;                 // When true, removes outer Card wrapper
  // Add other optional configuration props
};
```

### 3. Authentication Pattern

Never pass tokens as props. Retrieve from localStorage at request time:

```typescript
const token = localStorage.getItem("access_token");
if (!token) {
  throw new Error("Not authenticated");
}

// Use in fetch headers:
headers: {
  "Authorization": `Bearer ${token}`,
  "Content-Type": "application/json",
},
```

### 4. Status Machine Pattern

Use a status state to track component state:

```typescript
const [status, setStatus] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
const [errorMsg, setErrorMsg] = useState<string>("");
```

- `idle`: Initial state or no file selected
- `loading`: Fetching data from backend
- `ready`: Data loaded and ready to display
- `empty`: File has no data
- `error`: Error during fetch

### 5. Stale Closure Prevention (Critical!)

When fileId can change during async operations, prevent race conditions:

```typescript
// Track current fileId with ref
const fileIdRef = useRef<number | undefined>(fileId);

// Update ref when fileId changes
useEffect(() => {
  fileIdRef.current = fileId;
}, [fileId]);

// Inside async operations - check BEFORE and AFTER:
const fetchData = async () => {
  const currentFileId = fileId;
  if (!currentFileId) return;

  // Check before setting loading state
  if (fileIdRef.current !== currentFileId) return;

  setStatus("loading");

  try {
    const response = await fetch(`/api/endpoint/${currentFileId}/`);
    const data = await response.json();

    // Check again after async work - file may have changed
    if (fileIdRef.current !== currentFileId) return;

    setData(data);
    setStatus("ready");
  } catch (err) {
    if (fileIdRef.current !== currentFileId) return;
    setStatus("error");
    setErrorMsg(err.message);
  }
};
```

### 6. Two-Phase Fetch Pattern

When you need to load options first, then load data based on selection:

```typescript
// Phase 1: Load options when fileId changes
useEffect(() => {
  if (!fileId) {
    setOptions([]);
    setSelectedOption("");
    setStatus("idle");
    return;
  }

  const fetchOptions = async () => {
    // ... fetch options, auto-select first one
    setOptions(result);
    setSelectedOption(result[0] || "");
  };

  fetchOptions();
}, [fileId]);

// Phase 2: Load data when option is selected
useEffect(() => {
  if (!selectedOption) return;
  if (!automaticLoading && !hasStartedLoading) return;

  const fetchData = async () => {
    // ... fetch data based on selectedOption
  };

  fetchData();
}, [selectedOption, automaticLoading, hasStartedLoading]);
```

### 7. Manual Loading Support

Allow components to support both automatic and manual loading:

```typescript
const [hasStartedLoading, setHasStartedLoading] = useState(false);

// In useEffect dependency check:
if (!automaticLoading && !hasStartedLoading) return;

// Manual trigger button:
{!automaticLoading && status === "idle" && (
  <Button onClick={() => setHasStartedLoading(true)}>
    Start Loading
  </Button>
)}
```

---

## Component Template

```typescript
import React, { useState, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Type exports
export type MyItem = {
  id: string;
  name: string;
};

type MyComponentProps = {
  fileId?: number;
  automaticLoading?: boolean;
  onDataLoad?: (items: MyItem[]) => void;
  embedded?: boolean;
};

const MyComponent: React.FC<MyComponentProps> = ({
  fileId,
  automaticLoading = false,
  onDataLoad,
  embedded = false,
}) => {
  // State
  const [items, setItems] = useState<MyItem[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [hasStartedLoading, setHasStartedLoading] = useState(false);

  // Stale closure prevention
  const fileIdRef = useRef<number | undefined>(fileId);
  useEffect(() => {
    fileIdRef.current = fileId;
  }, [fileId]);

  // Reset when fileId changes
  useEffect(() => {
    setItems([]);
    setStatus("idle");
    setHasStartedLoading(false);
  }, [fileId]);

  // Fetch data
  useEffect(() => {
    if (!fileId) return;
    if (!automaticLoading && !hasStartedLoading) return;

    const currentFileId = fileId;

    const fetchData = async () => {
      if (fileIdRef.current !== currentFileId) return;
      setStatus("loading");

      const token = localStorage.getItem("access_token");
      if (!token) {
        setStatus("error");
        setErrorMsg("Not authenticated");
        return;
      }

      try {
        const res = await fetch(`/api/my-endpoint/?file_id=${currentFileId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          credentials: "include",
        });

        if (fileIdRef.current !== currentFileId) return;

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();

        if (fileIdRef.current !== currentFileId) return;

        if (!data || data.length === 0) {
          setStatus("empty");
          return;
        }

        setItems(data);
        setStatus("ready");
        onDataLoad?.(data);
      } catch (err: any) {
        if (fileIdRef.current !== currentFileId) return;
        setStatus("error");
        setErrorMsg(err.message || "Failed to load data");
      }
    };

    fetchData();
  }, [fileId, automaticLoading, hasStartedLoading, onDataLoad]);

  // Render based on status
  const Wrapper = embedded ? "div" : Card;

  return (
    <Wrapper className="w-full h-full">
      {status === "idle" && !fileId && (
        <div className="p-4 text-muted-foreground">Select a file to view data</div>
      )}

      {status === "idle" && fileId && !automaticLoading && (
        <div className="p-4">
          <Button onClick={() => setHasStartedLoading(true)}>Load Data</Button>
        </div>
      )}

      {status === "loading" && (
        <div className="p-4">Loading...</div>
      )}

      {status === "error" && (
        <div className="p-4 text-destructive">
          Error: {errorMsg}
          <Button onClick={() => setHasStartedLoading(true)} className="ml-2">
            Retry
          </Button>
        </div>
      )}

      {status === "empty" && (
        <div className="p-4 text-muted-foreground">No data found</div>
      )}

      {status === "ready" && (
        <div className="p-4">
          {/* Render your data here */}
          {items.map((item) => (
            <div key={item.id}>{item.name}</div>
          ))}
        </div>
      )}
    </Wrapper>
  );
};

export default MyComponent;
```

---

## Best Practices

1. **Always check `fileIdRef.current` before and after async operations** to prevent stale closure bugs
2. **Use `useMemo` for expensive computations** (filtering, sorting, derived data)
3. **Export types** so parent components can work with your data structures
4. **Support both automatic and manual loading** for flexibility
5. **Use the Card wrapper pattern** with `embedded` prop for reusability
6. **Reset state when fileId changes** to avoid showing stale data
7. **Provide clear status messages** for each state (idle, loading, error, empty, ready)
