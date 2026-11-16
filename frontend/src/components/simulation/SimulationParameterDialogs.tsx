import React, { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type {
  DiscoveryParams,
  PlayoutParams,
  SimulationMode,
  ViolationCostWeights,
} from "@/api/simulationApi";

// A numeric parameter as shown in a dialog. `symbol` is the notation of the
// thesis, so the dialog and Table "Parameters" can be read side by side.
type FieldSpec<K extends string> = {
  key: K;
  label: string;
  symbol?: string;
  hint: string;
  min: number;
  max?: number;
  integer?: boolean;
  step?: number;
};

type Group<K extends string> = {
  title: string;
  description: string;
  advancedOnly?: boolean;
  fields: FieldSpec<K>[];
};

const DISCOVERY_GROUPS: Group<keyof DiscoveryParams>[] = [
  {
    title: "Resource calendars",
    description: "Individual calendars, reliability of a resource and shift pattern clustering.",
    fields: [
      { key: "calendar_min_slot_support", symbol: "θ_sup", label: "Min. weeks with demand per slot",
        hint: "A slot with fewer weeks of demand gets availability 0.", min: 1, integer: true },
      { key: "calendar_min_resource_events", symbol: "θ_ev", label: "Min. events per resource",
        hint: "Fewer events: the resource is not reliably observed.", min: 1, integer: true },
      { key: "calendar_min_resource_weeks", symbol: "θ_wk", label: "Min. observation window (weeks)",
        hint: "Shorter window: the resource is not reliably observed.", min: 1, integer: true },
      { key: "calendar_min_span_share", symbol: "θ_sp", label: "Min. share of the log span",
        hint: "Share of the log span the observation window must cover.", min: 0, max: 1, step: 0.05 },
      { key: "calendar_smoothing_hours", symbol: "ς", label: "Smoothing kernel (hours)",
        hint: "Standard deviation of the kernel of the calendar distance.", min: 0, step: 0.5 },
      { key: "calendar_cluster_threshold", symbol: "θ_cl", label: "Clustering threshold",
        hint: "Max. average distance of calendars in one shift pattern.", min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: "Resource constraints",
    description: "Arrival units below either eligibility threshold use the pooled fallback.",
    fields: [
      { key: "constraint_support_threshold", symbol: "θ_con", label: "Min. support of a constraint",
        hint: "Share of the observed comparisons the relation must hold for.", min: 0, max: 1, step: 0.05 },
      { key: "constraint_min_variant_executions", symbol: "m_var", label: "Min. executions of an arrival unit",
        hint: "Fewer executions: the arrival unit uses the fallback.", min: 1, integer: true },
      { key: "constraint_min_variant_frequency", symbol: "q_var", label: "Min. relative frequency",
        hint: "Share of all executions an arrival unit must cover.", min: 0, max: 1, step: 0.01 },
      { key: "constraint_min_pair_executions", symbol: "m_ex", label: "Min. executions per pair (arrival unit)",
        hint: "Executions in which an activity pair must be compared.", min: 1, integer: true },
      { key: "constraint_fallback_min_pair_executions", symbol: "m_ex", label: "Min. executions per pair (fallback)",
        hint: "Same floor for the pooled fallback constraints.", min: 1, integer: true },
    ],
  },
  {
    title: "Resource allocation strategy",
    description: "FIFO or LIFO is chosen only with enough evidence; otherwise random.",
    fields: [
      { key: "allocation_busy_quantile", label: "Cooldown quantile for idle time",
        hint: "Quantile of the cooldown samples used to decide whether a resource is idle.",
        min: 0, max: 1, step: 0.05 },
      { key: "allocation_min_absolute_support", symbol: "m_min", label: "Min. absolute support",
        hint: "Min. number of assignments matching the strategy.", min: 1, integer: true },
      { key: "allocation_min_relative_support", symbol: "q_min", label: "Min. relative support",
        hint: "Min. share of the informative assignments.", min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: "State space",
    description: "Only used by the advanced play-out.",
    advancedOnly: true,
    fields: [
      { key: "state_suffix_length", symbol: "k_suf", label: "Length of the activity history",
        hint: "Number of preceding activities in the state.", min: 1, integer: true },
      { key: "state_group_cap", symbol: "k_cap", label: "Cap on objects per object group",
        hint: "Larger counts are capped to this value.", min: 1, integer: true },
      { key: "state_min_support", symbol: "θ_ss", label: "Min. support of a backoff level",
        hint: "Min. observations before a less specific level is used.", min: 1, integer: true },
    ],
  },
];

const COST_WEIGHT_FIELDS: FieldSpec<keyof ViolationCostWeights>[] = [
  { key: "same_resource", label: "same", hint: "", min: 0, step: 0.5 },
  { key: "subset", label: "subset", hint: "", min: 0, step: 0.5 },
  { key: "superset", label: "superset", hint: "", min: 0, step: 0.5 },
  { key: "disjoint", label: "disjoint", hint: "", min: 0, step: 0.5 },
];

type Drafts = Record<string, string>;

const toDrafts = (values: Record<string, number | null>): Drafts =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v == null ? "" : String(v)]));

// Parse one draft value against its spec; returns the number or an error text.
const parseField = (spec: FieldSpec<string>, raw: string): number | string => {
  const v = Number(raw);
  if (raw.trim() === "" || Number.isNaN(v)) return `${spec.label}: enter a number`;
  if (spec.integer && !Number.isInteger(v)) return `${spec.label}: enter a whole number`;
  if (v < spec.min) return `${spec.label}: must be at least ${spec.min}`;
  if (spec.max !== undefined && v > spec.max) return `${spec.label}: must be at most ${spec.max}`;
  return v;
};

const NumberField: React.FC<{
  id: string;
  spec: FieldSpec<string>;
  value: string;
  defaultValue?: number | null;
  onChange: (v: string) => void;
}> = ({ id, spec, value, defaultValue, onChange }) => (
  <div>
    <Label htmlFor={id} className="text-xs">
      {spec.label}
      {spec.symbol && <span className="text-muted-foreground font-normal"> ({spec.symbol})</span>}
    </Label>
    <Input id={id} type="number" className="mt-1" min={spec.min} max={spec.max}
      step={spec.step ?? (spec.integer ? 1 : "any")}
      value={value} onChange={(e) => onChange(e.target.value)} />
    {(spec.hint || defaultValue != null) && (
      <p className="text-[10px] text-muted-foreground mt-0.5">
        {spec.hint}
        {defaultValue != null && ` Default: ${defaultValue}.`}
      </p>
    )}
  </div>
);

const TriggerButton = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button> & { label: string }>(
  ({ label, ...props }, ref) => (
    <Button ref={ref} type="button" variant="outline" size="lg" {...props}>
      <SlidersHorizontal className="size-4" />
      {label}
    </Button>
  ),
);
TriggerButton.displayName = "TriggerButton";

/** Button + dialog for all parameters of the model discovery. */
export const DiscoveryParametersDialog: React.FC<{
  value: DiscoveryParams | null;
  defaults: DiscoveryParams | null;
  mode: SimulationMode;
  disabled?: boolean;
  onChange: (params: DiscoveryParams) => void;
}> = ({ value, defaults, mode, disabled, onChange }) => {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [error, setError] = useState("");

  const handleOpenChange = (next: boolean) => {
    if (next && value) {
      setDrafts(toDrafts(value));
      setError("");
    }
    setOpen(next);
  };

  const apply = () => {
    const parsed: Record<string, number> = {};
    for (const group of DISCOVERY_GROUPS) {
      for (const spec of group.fields) {
        const result = parseField(spec, drafts[spec.key] ?? "");
        if (typeof result === "string") {
          setError(result);
          return;
        }
        parsed[spec.key] = result;
      }
    }
    onChange(parsed as DiscoveryParams);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <TriggerButton label="Discovery parameters" disabled={disabled || !value} />
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Discovery parameters</DialogTitle>
          <DialogDescription>
            Thresholds used to discover the simulation model from the event log.
            Changing them takes effect the next time the model is discovered.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {DISCOVERY_GROUPS.map((group, gi) => {
            const inactive = group.advancedOnly && mode !== "advanced";
            return (
              <div key={group.title}>
                {gi > 0 && <Separator className="mb-4" />}
                <p className="text-sm font-medium">{group.title}</p>
                <p className="text-xs text-muted-foreground mb-3">
                  {group.description}
                  {inactive && " The current mode is simple, so these values have no effect."}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {group.fields.map((spec) => (
                    <NumberField key={spec.key} id={`dp-${spec.key}`} spec={spec}
                      value={drafts[spec.key] ?? ""}
                      defaultValue={defaults?.[spec.key]}
                      onChange={(v) => setDrafts((d) => ({ ...d, [spec.key]: v }))} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={!defaults}
            onClick={() => defaults && setDrafts(toDrafts(defaults))}>
            Reset to defaults
          </Button>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" onClick={apply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const VIOLATION_DEGREE: FieldSpec<"resource_constraint_violation_degree"> = {
  key: "resource_constraint_violation_degree", symbol: "γ", label: "Constraint violation degree",
  hint: "0 = all applicable constraints are enforced, 1 = violations are not limited.",
  min: 0, max: 1, step: 0.05,
};
const LOOKBACK: FieldSpec<"constraint_lookback_length"> = {
  key: "constraint_lookback_length", symbol: "ℓ", label: "Constraint lookback length",
  hint: "Number of preceding events checked for constraints. Empty = complete history.",
  min: 1, integer: true,
};

/** Button + dialog for the parameters of the play-out (γ, ℓ, cost weights). */
export const PlayoutParametersDialog: React.FC<{
  value: PlayoutParams | null;
  defaults: PlayoutParams | null;
  disabled?: boolean;
  size?: "default" | "lg";
  onChange: (params: PlayoutParams) => void;
}> = ({ value, defaults, disabled, size = "lg", onChange }) => {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [error, setError] = useState("");

  const flatten = (p: PlayoutParams): Drafts =>
    toDrafts({
      resource_constraint_violation_degree: p.resource_constraint_violation_degree,
      constraint_lookback_length: p.constraint_lookback_length,
      ...p.violation_cost_weights,
    });

  const handleOpenChange = (next: boolean) => {
    if (next && value) {
      setDrafts(flatten(value));
      setError("");
    }
    setOpen(next);
  };

  const apply = () => {
    const degree = parseField(VIOLATION_DEGREE, drafts[VIOLATION_DEGREE.key] ?? "");
    if (typeof degree === "string") return setError(degree);
    const rawLookback = (drafts[LOOKBACK.key] ?? "").trim();
    let lookback: number | null = null;
    if (rawLookback !== "") {
      const parsed = parseField(LOOKBACK, rawLookback);
      if (typeof parsed === "string") return setError(parsed);
      lookback = parsed;
    }
    const weights: Record<string, number> = {};
    for (const spec of COST_WEIGHT_FIELDS) {
      const parsed = parseField(spec, drafts[spec.key] ?? "");
      if (typeof parsed === "string") return setError(`Cost weight ${parsed}`);
      weights[spec.key] = parsed;
    }
    onChange({
      resource_constraint_violation_degree: degree,
      constraint_lookback_length: lookback,
      violation_cost_weights: weights as ViolationCostWeights,
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <TriggerButton label="Play-out parameters" size={size} disabled={disabled || !value} />
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Play-out parameters</DialogTitle>
          <DialogDescription>
            Control how the play-out handles the resource constraints. They do not
            change the discovered model.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <NumberField id="pp-degree" spec={VIOLATION_DEGREE}
              value={drafts[VIOLATION_DEGREE.key] ?? ""}
              defaultValue={defaults?.resource_constraint_violation_degree}
              onChange={(v) => setDrafts((d) => ({ ...d, [VIOLATION_DEGREE.key]: v }))} />
            <div>
              <Label htmlFor="pp-lookback" className="text-xs">
                {LOOKBACK.label}
                <span className="text-muted-foreground font-normal"> ({LOOKBACK.symbol})</span>
              </Label>
              <Input id="pp-lookback" type="number" className="mt-1" min={1} step={1}
                placeholder="Complete history"
                value={drafts[LOOKBACK.key] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [LOOKBACK.key]: e.target.value }))} />
              <p className="text-[10px] text-muted-foreground mt-0.5">{LOOKBACK.hint}</p>
            </div>
          </div>

          <Separator />
          <div>
            <p className="text-sm font-medium">Violation cost weights</p>
            <p className="text-xs text-muted-foreground mb-3">
              Cost of violating one constraint of each type, in units of the violation
              budget. A higher weight makes violations of that type rarer.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {COST_WEIGHT_FIELDS.map((spec) => (
                <NumberField key={spec.key} id={`pp-w-${spec.key}`} spec={spec}
                  value={drafts[spec.key] ?? ""}
                  defaultValue={defaults?.violation_cost_weights[spec.key]}
                  onChange={(v) => setDrafts((d) => ({ ...d, [spec.key]: v }))} />
              ))}
            </div>
          </div>
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={!defaults}
            onClick={() => defaults && setDrafts(flatten(defaults))}>
            Reset to defaults
          </Button>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" onClick={apply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
