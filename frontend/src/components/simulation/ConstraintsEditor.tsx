import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { VariantDetail, VariantConstraints } from "@/api/simulationApi";

const CONSTRAINT_TYPES = ["same_resource", "subset", "superset", "disjoint"];

type Props = {
  variants: VariantDetail[];
  editedConstraints: Record<number, VariantConstraints>;
  activities: string[];
  onAdd: (variantId: number, act1: string, act2: string, type: string) => void;
  onRemove: (variantId: number, act1: string, act2: string) => void;
  globalConstraints?: VariantConstraints;
  onAddGlobal?: (act1: string, act2: string, type: string) => void;
  onRemoveGlobal?: (act1: string, act2: string) => void;
  fallbackConstraints?: VariantConstraints;
  onAddFallback?: (act1: string, act2: string, type: string) => void;
  onRemoveFallback?: (act1: string, act2: string) => void;
};

export const ConstraintsEditorPanel: React.FC<Props> = ({
  variants,
  editedConstraints,
  activities,
  onAdd,
  onRemove,
  globalConstraints,
  onAddGlobal,
  onRemoveGlobal,
  fallbackConstraints,
  onAddFallback,
  onRemoveFallback,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Resource Constraints</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Constraints define relationships between resource usage across activity pairs.
          Global constraints apply to all variants that contain both activities. The
          fallback pool applies to variants too infrequent to be mined on their own.
        </p>

        {/* Global Constraints */}
        {onAddGlobal && onRemoveGlobal && (
          <>
            <EditableConstraintsSection
              label="Global"
              hint="apply to all variants"
              badgeVariant="secondary"
              emptyText="No global constraints set"
              constraints={globalConstraints || {}}
              activities={activities}
              onAdd={onAddGlobal}
              onRemove={onRemoveGlobal}
            />
            <Separator />
          </>
        )}

        {/* Fallback Pool */}
        {onAddFallback && onRemoveFallback && (
          <>
            <EditableConstraintsSection
              label="Fallback pool"
              hint="used for infrequent variants"
              badgeVariant="outline"
              emptyText="No fallback constraints discovered"
              constraints={fallbackConstraints || {}}
              activities={activities}
              onAdd={onAddFallback}
              onRemove={onRemoveFallback}
            />
            <Separator />
          </>
        )}

        {/* Per-Variant Constraints */}
        {variants.map((variant) => (
          <SingleVariantConstraints
            key={variant.id}
            variant={variant}
            constraints={editedConstraints[variant.id] || {}}
            customized={editedConstraints[variant.id] !== undefined}
            fallbackConstraints={fallbackConstraints || {}}
            onAdd={(act1, act2, type) => onAdd(variant.id, act1, act2, type)}
            onRemove={(act1, act2) => onRemove(variant.id, act1, act2)}
          />
        ))}
      </CardContent>
    </Card>
  );
};

const constraintColor = (type: string) => {
  switch (type) {
    case "same_resource": return "bg-blue-100 text-blue-800 border-blue-200";
    case "subset": return "bg-green-100 text-green-800 border-green-200";
    case "superset": return "bg-purple-100 text-purple-800 border-purple-200";
    case "disjoint": return "bg-red-100 text-red-800 border-red-200";
    default: return "";
  }
};

function flattenConstraints(constraints: VariantConstraints) {
  const flat: { act1: string; act2: string; type: string }[] = [];
  for (const [act1, targets] of Object.entries(constraints)) {
    for (const [act2, type] of Object.entries(targets)) {
      flat.push({ act1, act2, type });
    }
  }
  return flat;
}

// --- Editable (non-variant) constraint sections: Global + Fallback pool ---

const EditableConstraintsSection: React.FC<{
  label: string;
  hint: string;
  badgeVariant: "secondary" | "outline";
  emptyText: string;
  constraints: VariantConstraints;
  activities: string[];
  onAdd: (act1: string, act2: string, type: string) => void;
  onRemove: (act1: string, act2: string) => void;
}> = ({ label, hint, badgeVariant, emptyText, constraints, activities, onAdd, onRemove }) => {
  const [showAdd, setShowAdd] = useState(false);
  const [newAct1, setNewAct1] = useState("");
  const [newAct2, setNewAct2] = useState("");
  const [newType, setNewType] = useState("same_resource");

  const flat = flattenConstraints(constraints);

  return (
    <div className="border rounded p-3 border-dashed">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge variant={badgeVariant}>{label}</Badge>
          <span className="text-xs text-muted-foreground">
            {flat.length} constraint{flat.length !== 1 ? "s" : ""} — {hint}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? "Cancel" : "+ Add"}
        </Button>
      </div>

      {flat.length > 0 ? (
        <ConstraintList constraints={flat} onRemove={onRemove} />
      ) : (
        <p className="text-xs text-muted-foreground italic">{emptyText}</p>
      )}

      {showAdd && (
        <AddConstraintForm
          activities={activities}
          newAct1={newAct1} setNewAct1={setNewAct1}
          newAct2={newAct2} setNewAct2={setNewAct2}
          newType={newType} setNewType={setNewType}
          onAdd={() => {
            onAdd(newAct1, newAct2, newType);
            setNewAct1(""); setNewAct2(""); setShowAdd(false);
          }}
        />
      )}
    </div>
  );
};

// --- Per-Variant Constraints ---

const SingleVariantConstraints: React.FC<{
  variant: VariantDetail;
  constraints: VariantConstraints;
  customized: boolean;
  fallbackConstraints: VariantConstraints;
  onAdd: (act1: string, act2: string, type: string) => void;
  onRemove: (act1: string, act2: string) => void;
}> = ({ variant, constraints, customized, fallbackConstraints, onAdd, onRemove }) => {
  const [showAdd, setShowAdd] = useState(false);
  const [newAct1, setNewAct1] = useState("");
  const [newAct2, setNewAct2] = useState("");
  const [newType, setNewType] = useState("same_resource");

  // An infrequent variant inherits the fallback pool (read-only) until the user
  // edits it, which promotes it to its own editable, pool-seeded set.
  const inheritingPool = variant.uses_fallback && !customized;
  const flat = flattenConstraints(inheritingPool ? fallbackConstraints : constraints);
  // Use only activities from this variant's sequence
  const variantActivities = [...new Set(variant.activity_sequence)].sort();

  return (
    <div className="border rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline">Variant {variant.id + 1}</Badge>
          {inheritingPool && (
            <Badge variant="secondary" className="text-[10px]">uses fallback pool</Badge>
          )}
          {variant.uses_fallback && customized && (
            <Badge variant="secondary" className="text-[10px]">customized</Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {flat.length} constraint{flat.length !== 1 ? "s" : ""}
          </span>
          <span className="text-xs text-muted-foreground">
            [{variant.activity_sequence.slice(0, 3).join(" > ")}{variant.activity_sequence.length > 3 ? "..." : ""}]
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? "Cancel" : "+ Add"}
        </Button>
      </div>

      {flat.length > 0 ? (
        // While inheriting, the rows are the pool's; adding or removing any of them
        // promotes this variant to its own pool-seeded set (then diverges from it).
        <ConstraintList constraints={flat} onRemove={onRemove} />
      ) : (
        <p className="text-xs text-muted-foreground italic">
          {inheritingPool ? "No fallback constraints apply to this variant" : "No constraints discovered for this variant"}
        </p>
      )}

      {showAdd && (
        <AddConstraintForm
          activities={variantActivities}
          newAct1={newAct1} setNewAct1={setNewAct1}
          newAct2={newAct2} setNewAct2={setNewAct2}
          newType={newType} setNewType={setNewType}
          onAdd={() => {
            onAdd(newAct1, newAct2, newType);
            setNewAct1(""); setNewAct2(""); setShowAdd(false);
          }}
        />
      )}
    </div>
  );
};

// --- Shared sub-components ---

const ConstraintList: React.FC<{
  constraints: { act1: string; act2: string; type: string }[];
  onRemove?: (act1: string, act2: string) => void;
}> = ({ constraints, onRemove }) => (
  <div className="space-y-1 max-h-48 overflow-y-auto">
    {constraints.map(({ act1, act2, type }, idx) => (
      <div key={idx} className="flex items-center gap-2 text-xs bg-muted/30 rounded px-2 py-1.5">
        <span className="font-medium truncate max-w-[160px]" title={act1}>{act1}</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] border ${constraintColor(type)}`}>
          {type.replace("_", " ")}
        </span>
        <span className="font-medium truncate max-w-[160px]" title={act2}>{act2}</span>
        {onRemove && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(act1, act2)}
          >
            x
          </Button>
        )}
      </div>
    ))}
  </div>
);

const AddConstraintForm: React.FC<{
  activities: string[];
  newAct1: string; setNewAct1: (v: string) => void;
  newAct2: string; setNewAct2: (v: string) => void;
  newType: string; setNewType: (v: string) => void;
  onAdd: () => void;
}> = ({ activities, newAct1, setNewAct1, newAct2, setNewAct2, newType, setNewType, onAdd }) => (
  <div className="mt-3 p-2 border rounded bg-muted/20 space-y-2">
    <div className="grid grid-cols-3 gap-2">
      <select
        className="text-xs border rounded px-2 py-1.5 bg-background"
        value={newAct1}
        onChange={(e) => setNewAct1(e.target.value)}
      >
        <option value="">Activity 1...</option>
        {activities.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <select
        className="text-xs border rounded px-2 py-1.5 bg-background"
        value={newType}
        onChange={(e) => setNewType(e.target.value)}
      >
        {CONSTRAINT_TYPES.map((t) => (
          <option key={t} value={t}>{t.replace("_", " ")}</option>
        ))}
      </select>
      <select
        className="text-xs border rounded px-2 py-1.5 bg-background"
        value={newAct2}
        onChange={(e) => setNewAct2(e.target.value)}
      >
        <option value="">Activity 2...</option>
        {activities.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
    </div>
    <Button
      size="sm"
      disabled={!newAct1 || !newAct2}
      onClick={onAdd}
    >
      Add Constraint
    </Button>
  </div>
);

export default ConstraintsEditorPanel;
