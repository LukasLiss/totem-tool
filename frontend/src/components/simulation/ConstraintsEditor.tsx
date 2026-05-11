import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VariantDetail, VariantConstraints } from "@/api/simulationApi";

const CONSTRAINT_TYPES = ["same_resource", "subset", "superset", "disjoint"];

type Props = {
  variants: VariantDetail[];
  editedConstraints: Record<number, VariantConstraints>;
  activities: string[];
  onAdd: (variantId: number, act1: string, act2: string, type: string) => void;
  onRemove: (variantId: number, act1: string, act2: string) => void;
};

export const ConstraintsEditorPanel: React.FC<Props> = ({
  variants,
  editedConstraints,
  activities,
  onAdd,
  onRemove,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Resource Constraints</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Constraints define relationships between resource usage across activities within each variant.
          They are applied across all resource types (not per-type).
        </p>
        {variants.map((variant) => (
          <SingleVariantConstraints
            key={variant.id}
            variant={variant}
            constraints={editedConstraints[variant.id] || {}}
            activities={activities}
            onAdd={(act1, act2, type) => onAdd(variant.id, act1, act2, type)}
            onRemove={(act1, act2) => onRemove(variant.id, act1, act2)}
          />
        ))}
      </CardContent>
    </Card>
  );
};

const SingleVariantConstraints: React.FC<{
  variant: VariantDetail;
  constraints: VariantConstraints;
  activities: string[];
  onAdd: (act1: string, act2: string, type: string) => void;
  onRemove: (act1: string, act2: string) => void;
}> = ({ variant, constraints, activities, onAdd, onRemove }) => {
  const [showAdd, setShowAdd] = useState(false);
  const [newAct1, setNewAct1] = useState("");
  const [newAct2, setNewAct2] = useState("");
  const [newType, setNewType] = useState("same_resource");

  // Flatten constraints for display
  const flatConstraints: { act1: string; act2: string; type: string }[] = [];
  for (const [act1, targets] of Object.entries(constraints)) {
    for (const [act2, type] of Object.entries(targets)) {
      flatConstraints.push({ act1, act2, type });
    }
  }

  const constraintColor = (type: string) => {
    switch (type) {
      case "same_resource": return "bg-blue-100 text-blue-800 border-blue-200";
      case "subset": return "bg-green-100 text-green-800 border-green-200";
      case "superset": return "bg-purple-100 text-purple-800 border-purple-200";
      case "disjoint": return "bg-red-100 text-red-800 border-red-200";
      default: return "";
    }
  };

  return (
    <div className="border rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline">Variant {variant.id + 1}</Badge>
          <span className="text-xs text-muted-foreground">
            {flatConstraints.length} constraint{flatConstraints.length !== 1 ? "s" : ""}
          </span>
          <span className="text-xs text-muted-foreground">
            [{variant.activity_sequence.slice(0, 3).join(" > ")}{variant.activity_sequence.length > 3 ? "..." : ""}]
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? "Cancel" : "+ Add"}
        </Button>
      </div>

      {flatConstraints.length > 0 ? (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {flatConstraints.map(({ act1, act2, type }, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs bg-muted/30 rounded px-2 py-1.5">
              <span className="font-medium truncate max-w-[160px]" title={act1}>{act1}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] border ${constraintColor(type)}`}>
                {type.replace("_", " ")}
              </span>
              <span className="font-medium truncate max-w-[160px]" title={act2}>{act2}</span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => onRemove(act1, act2)}
              >
                x
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">No constraints discovered for this variant</p>
      )}

      {showAdd && (
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
            onClick={() => {
              onAdd(newAct1, newAct2, newType);
              setNewAct1("");
              setNewAct2("");
              setShowAdd(false);
            }}
          >
            Add Constraint
          </Button>
        </div>
      )}
    </div>
  );
};

export default ConstraintsEditorPanel;
