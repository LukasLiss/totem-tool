/**
 * The process area widget's settings popup body: the discovery algorithm and,
 * for the advanced one, its five parameters (the settings the edit form
 * always had) beside a draft of the visualizer. It works on a draft of the
 * settings, mounted on every open, and only hands it over on Apply.
 */

import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  PROCESS_AREA_ALGORITHM_LABELS,
  PROCESS_AREA_PARAM_RANGES,
  type ProcessAreaAlgorithm,
  type ProcessAreaParams,
} from "@/react_component/processAreaParams";
import { ChartSettingsLayout } from "./sql-widgets/chartSettings";
import ProcessAreaSketch from "./ProcessAreaSketch";

const PROCESS_AREA_PARAM_FIELDS: Array<{
  nodeKey: 'w_temporal' | 'w_cardinality' | 'w_divergence' | 'alpha' | 'beta';
  paramKey: keyof ProcessAreaParams;
  label: string;
}> = [
  { nodeKey: 'w_temporal', paramKey: 'wTemporal', label: 'Temporal weight' },
  { nodeKey: 'w_cardinality', paramKey: 'wCardinality', label: 'Cardinality weight' },
  { nodeKey: 'w_divergence', paramKey: 'wDivergence', label: 'Divergence weight' },
  { nodeKey: 'alpha', paramKey: 'alpha', label: 'Separation (α)' },
  { nodeKey: 'beta', paramKey: 'beta', label: 'Cohesion (β)' },
];

type ProcessAreaSettings = { algorithm: ProcessAreaAlgorithm; params: ProcessAreaParams };

const ProcessAreaSettingsBody: React.FC<{
  id: string;
  initial: ProcessAreaSettings;
  /** Explanation of the draft, the same as in the edit tile. */
  sketchHint: string;
  onApply: (settings: ProcessAreaSettings) => void;
  onCancel: () => void;
}> = ({ id, initial, sketchHint, onApply, onCancel }) => {
  const [algorithm, setAlgorithm] = useState(initial.algorithm);
  const [params, setParams] = useState(initial.params);

  return (
    <ChartSettingsLayout
      heading="Process area settings"
      idPrefix={id}
      onApply={() => onApply({ algorithm, params })}
      onCancel={onCancel}
      dataTab={
        <div className="space-y-4 text-left">
          <p className="text-sm text-muted-foreground">
            The Process Area visualizes the object-type hierarchy of your event log.
            Select an event log file to see the visualization.
          </p>
          <div className="flex items-center justify-between">
            <Label>Discovery algorithm</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-[240px] justify-between font-normal">
                  <span className="truncate">{PROCESS_AREA_ALGORITHM_LABELS[algorithm]}</span>
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[240px]">
                <DropdownMenuRadioGroup
                  value={algorithm}
                  onValueChange={(value) => setAlgorithm(value as ProcessAreaAlgorithm)}
                >
                  {(Object.keys(PROCESS_AREA_ALGORITHM_LABELS) as ProcessAreaAlgorithm[]).map(
                    (value) => (
                      <DropdownMenuRadioItem key={value} value={value}>
                        {PROCESS_AREA_ALGORITHM_LABELS[value]}
                      </DropdownMenuRadioItem>
                    ),
                  )}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {algorithm === 'advanced' &&
            PROCESS_AREA_PARAM_FIELDS.map(({ nodeKey, paramKey, label }) => (
              <div className="space-y-2" key={nodeKey}>
                <div className="flex items-center justify-between">
                  <Label htmlFor={`${id}-${nodeKey}`}>{label}</Label>
                  <span className="text-sm text-muted-foreground">
                    {params[paramKey].toFixed(2)}
                  </span>
                </div>
                <Slider
                  id={`${id}-${nodeKey}`}
                  {...PROCESS_AREA_PARAM_RANGES[paramKey]}
                  value={[params[paramKey]]}
                  onValueChange={(values) =>
                    setParams({ ...params, [paramKey]: values?.[0] ?? 0 })
                  }
                />
              </div>
            ))}
        </div>
      }
      sketch={<ProcessAreaSketch className="w-full max-w-xs md:max-w-md" />}
      sketchHint={sketchHint}
    />
  );
};

export default ProcessAreaSettingsBody;
