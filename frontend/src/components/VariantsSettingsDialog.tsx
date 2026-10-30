/**
 * The Variants Explorer widget's settings popup body: the settings its edit
 * form always had beside a draft of the explorer. It works on a draft of the
 * settings, mounted on every open, and only hands it over on Apply.
 */

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MultiSelectPopover } from "@/react_component/variants/MultiSelectPopover";
import {
  EXTRACTION_OPTIONS,
  ISO_OPTIONS,
  type Extraction,
  type IsoStrategy,
} from "@/react_component/variants/types";
import { ChartSettingsLayout } from "./sql-widgets/chartSettings";
import VariantsSketch from "./VariantsSketch";

type VariantsSettings = {
  automaticLoading: boolean;
  leadingType: string;
  extraction: Extraction;
  iso: IsoStrategy;
  timeoutS: number;
  businessObjectTypes: string[];
  businessActivities: string[];
};

const VariantsSettingsBody: React.FC<{
  id: string;
  initial: VariantsSettings;
  availableTypes: string[];
  availableActivities: string[];
  loadingTypes: boolean;
  fileId?: number;
  /** Explanation of the draft, the same as in the edit tile. */
  sketchHint: string;
  onApply: (settings: VariantsSettings) => void;
  onCancel: () => void;
}> = ({ id, initial, availableTypes, availableActivities, loadingTypes, fileId, sketchHint, onApply, onCancel }) => {
  const [automaticLoading, setAutomaticLoading] = useState(initial.automaticLoading);
  const [leadingType, setLeadingType] = useState(initial.leadingType);
  const [extraction, setExtraction] = useState(initial.extraction);
  const [iso, setIso] = useState(initial.iso);
  const [timeoutS, setTimeoutS] = useState(initial.timeoutS);
  const [businessObjectTypes, setBusinessObjectTypes] = useState(initial.businessObjectTypes);
  const [businessActivities, setBusinessActivities] = useState(initial.businessActivities);

  const extractionOpt = EXTRACTION_OPTIONS.find((o) => o.value === extraction);
  const isoOpt = ISO_OPTIONS.find((o) => o.value === iso);
  const leadingTypeIgnored = extraction === 'connected' || extraction === 'resource_aware';
  const resourceAware = extraction === 'resource_aware';

  return (
    <ChartSettingsLayout
      heading="Variants Explorer settings"
      idPrefix={id}
      onApply={() =>
        onApply({ automaticLoading, leadingType, extraction, iso, timeoutS, businessObjectTypes, businessActivities })
      }
      onCancel={onCancel}
      dataTab={
        <div className="space-y-4 text-left">
          {/* Automatic Loading Toggle */}
          <div className="flex items-center justify-between">
            <Label htmlFor={`${id}-auto-loading`}>Automatic variant computation</Label>
            <Switch
              id={`${id}-auto-loading`}
              checked={automaticLoading}
              onCheckedChange={setAutomaticLoading}
            />
          </div>

          {/* Leading Object Type Dropdown */}
          <div className="space-y-2">
            <Label>Leading object type</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-between"
                  disabled={leadingTypeIgnored}
                  title={
                    leadingTypeIgnored
                      ? 'Ignored when extraction is "Connected components"'
                      : undefined
                  }
                >
                  {leadingTypeIgnored
                    ? `— (ignored for ${extractionOpt?.label ?? extraction})`
                    : (leadingType || 'Select object type (optional)')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuRadioGroup value={leadingType} onValueChange={setLeadingType}>
                  <DropdownMenuRadioItem value="">None (use default)</DropdownMenuRadioItem>
                  {availableTypes.map((type) => (
                    <DropdownMenuRadioItem key={type} value={type}>{type}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {loadingTypes && <p className="text-sm text-muted-foreground">Loading types...</p>}
            {!fileId && <p className="text-sm text-muted-foreground">Select a file to see available types</p>}
          </div>

          {/* Extraction strategy */}
          <div className="space-y-2">
            <Label>Extraction strategy</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between font-normal">
                  <span className="truncate">
                    {extractionOpt?.label ?? extraction}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[320px]">
                <DropdownMenuLabel>Extraction</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup value={extraction} onValueChange={(value) => setExtraction(value as Extraction)}>
                  {EXTRACTION_OPTIONS.map((opt) => (
                    <DropdownMenuRadioItem
                      key={opt.value}
                      value={opt.value}
                      className="items-start py-2"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm">{opt.label}</span>
                        <span className="text-xs text-muted-foreground">{opt.hint}</span>
                      </div>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {extractionOpt && (
              <p className="text-xs text-muted-foreground">{extractionOpt.hint}</p>
            )}
          </div>

          {resourceAware && (
            <>
              <div className="space-y-2">
                <Label>Business object types</Label>
                <MultiSelectPopover
                  label="Business object types"
                  options={availableTypes}
                  selected={businessObjectTypes}
                  onChange={setBusinessObjectTypes}
                  placeholder="Select object types"
                  allLabel="All object types"
                  loading={loadingTypes}
                  disabled={!fileId}
                />
                <p className="text-xs text-muted-foreground">
                  Object types left out are treated as resources.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Business activities</Label>
                <MultiSelectPopover
                  label="Business activities"
                  options={availableActivities}
                  selected={businessActivities}
                  onChange={setBusinessActivities}
                  placeholder="All activities"
                  allLabel="All activities"
                  loading={loadingTypes}
                  disabled={!fileId}
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to connect business objects through every activity.
                </p>
              </div>
            </>
          )}

          {/* Isomorphism strategy */}
          <div className="space-y-2">
            <Label>Isomorphism strategy</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between font-normal">
                  <span className="truncate">{isoOpt?.label ?? iso}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[300px]">
                <DropdownMenuLabel>Isomorphism</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup value={iso} onValueChange={(value) => setIso(value as IsoStrategy)}>
                  {ISO_OPTIONS.map((opt) => (
                    <DropdownMenuRadioItem
                      key={opt.value}
                      value={opt.value}
                      className="items-start py-2"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm">{opt.label}</span>
                        <span className="text-xs text-muted-foreground">{opt.hint}</span>
                      </div>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {isoOpt && (
              <p className="text-xs text-muted-foreground">{isoOpt.hint}</p>
            )}
          </div>

          {/* Timeout (seconds) */}
          <div className="space-y-2">
            <Label htmlFor={`${id}-timeout`}>Timeout (seconds)</Label>
            <Input
              id={`${id}-timeout`}
              type="number"
              min={1}
              max={120}
              step={1}
              value={timeoutS}
              onChange={(e) => {
                // The same rule the edit form applied: anything but a positive number is 10.
                const n = Number(e.target.value);
                setTimeoutS(Number.isFinite(n) && n > 0 ? n : 10);
              }}
              className="w-[120px]"
            />
            <p className="text-xs text-muted-foreground">
              Wall-clock budget per computation. The default of 10 s protects
              against runaway runs on hard combinations.
            </p>
          </div>
        </div>
      }
      sketch={<VariantsSketch className="w-full max-w-xs md:max-w-md" />}
      sketchHint={sketchHint}
    />
  );
};

export default VariantsSettingsBody;
