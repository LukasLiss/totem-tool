import React, { useEffect, useRef, useState } from 'react';
import { Filter, Calendar, Layers, Zap, X, ChevronRight } from 'lucide-react';
import axios from 'axios';
import { FilterConfigDialog } from '@/components/FilterConfigDialog';
import { buildFilterParams } from '@/store/filterStore';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type {
  FilterRule,
  FilterType,
  TimeRangeParams,
  ObjectTypesParams,
  ActivityParams,
} from '@/contexts/FilterStackContext';

type OptionItem = { name: string; count: number };

// Matches GlobalFilterToggle button style
const BUTTON_BASE: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 2,
  padding: '3px 7px', borderRadius: 9999,
  cursor: 'pointer', border: '1px solid',
  background: 'transparent',
  transition: 'background 120ms, border-color 120ms, color 120ms',
  fontSize: 12, lineHeight: 1,
} as const;

const stopPointerDown = (e: React.PointerEvent) => e.stopPropagation();

type TypeMeta = { type: FilterType; label: string; icon: React.ReactElement };

const FILTER_TYPES: TypeMeta[] = [
  { type: 'time_range',   label: 'Date Range',   icon: <Calendar size={16} /> },
  { type: 'object_types', label: 'Object Types', icon: <Layers   size={16} /> },
  { type: 'activity',     label: 'Activities',   icon: <Zap      size={16} /> },
];

function slotLabel(rule: FilterRule): string {
  switch (rule.type) {
    case 'time_range': {
      const p = rule.params as TimeRangeParams;
      const fmt = (u: number) => new Date(u * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      if (p.after != null && p.before != null) return `${fmt(p.after)} – ${fmt(p.before)}`;
      if (p.after  != null) return `After ${fmt(p.after)}`;
      if (p.before != null) return `Before ${fmt(p.before)}`;
      return 'Any time';
    }
    case 'object_types': {
      const { include } = rule.params as ObjectTypesParams;
      return include.length === 0 ? 'No types' : `${include.length} type${include.length !== 1 ? 's' : ''}`;
    }
    case 'activity': {
      const { include } = rule.params as ActivityParams;
      return include.length === 0 ? 'No activities' : `${include.length} activit${include.length !== 1 ? 'ies' : 'y'}`;
    }
  }
}

export interface LocalFilterDropdownProps {
  fileId?: number | string | null;
  onFilterChange: (params: Record<string, string>) => void;
  stopPropagation?: boolean;
}

export function LocalFilterDropdown({
  fileId,
  onFilterChange,
  stopPropagation = false,
}: LocalFilterDropdownProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [activeType, setActiveType] = useState<FilterType>('time_range');

  // Pending rules: configured but not yet applied
  const [pending, setPending] = useState<Partial<Record<FilterType, FilterRule>>>({});
  // Applied rules: what's been sent via onFilterChange
  const [applied, setApplied] = useState<Partial<Record<FilterType, FilterRule>>>({});

  const [objectTypes, setObjectTypes] = useState<OptionItem[]>([]);
  const [activities,  setActivities]  = useState<OptionItem[]>([]);
  const [optionsLoaded, setOptionsLoaded] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const appliedRef = useRef(applied);
  appliedRef.current = applied;

  const isActive = Object.keys(applied).length > 0;
  const isDirty  = JSON.stringify(pending) !== JSON.stringify(applied);

  useEffect(() => {
    if (!dropdownOpen || optionsLoaded || !fileId) return;
    setOptionsLoaded(true);
    axios.get<OptionItem[]>(`/api/files/${fileId}/object_types/`, { _skipGlobalFilter: true } as any)
      .then(({ data }) => setObjectTypes(Array.isArray(data) ? data : []))
      .catch(() => setObjectTypes([]));
    axios.get<OptionItem[]>(`/api/files/${fileId}/activities/`, { _skipGlobalFilter: true } as any)
      .then(({ data }) => setActivities(Array.isArray(data) ? data : []))
      .catch(() => setActivities([]));
  }, [dropdownOpen, fileId, optionsLoaded]);

  // Reset loaded options when file changes
  useEffect(() => {
    setOptionsLoaded(false);
    setPending({});
    setApplied({});
    onFilterChange({});
  }, [fileId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset pending to applied whenever the dropdown closes without applying.
  useEffect(() => {
    if (!dropdownOpen) {
      setPending(appliedRef.current);
    }
  }, [dropdownOpen]);

  // Close on outside click, but not while the config dialog is open.
  // If there are unapplied changes, ask for confirmation first.
  useEffect(() => {
    if (!dropdownOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (dialogOpen) return;
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        if (isDirty) {
          setConfirmClose(true);
        } else {
          setDropdownOpen(false);
        }
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [dropdownOpen, dialogOpen, isDirty]);

  function openType(type: FilterType) {
    setActiveType(type);
    setDialogOpen(true);
  }

  function handleDialogSubmit(params: FilterRule['params']) {
    const emptyInclude =
      (activeType === 'object_types' || activeType === 'activity') &&
      (params as { include: string[] }).include.length === 0;
    if (emptyInclude) {
      setPending(prev => { const next = { ...prev }; delete next[activeType]; return next; });
      return;
    }
    const rule: FilterRule = { id: activeType, type: activeType, enabled: true, params };
    setPending(prev => ({ ...prev, [activeType]: rule }));
  }

  function removeFilter(type: FilterType, e: React.MouseEvent) {
    e.stopPropagation();
    setPending(prev => { const next = { ...prev }; delete next[type]; return next; });
  }

  function handleApply() {
    if (!isDirty) return;
    setApplied(pending);
    onFilterChange(buildFilterParams(Object.values(pending) as FilterRule[]));
    setDropdownOpen(false);
  }

  function handleClearAll() {
    setPending({});
    setApplied({});
    onFilterChange({});
    setDropdownOpen(false);
  }

  const activeConfig = FILTER_TYPES.find(f => f.type === activeType)!;

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setDropdownOpen(o => !o)}
        onPointerDown={stopPropagation ? stopPointerDown : undefined}
        title={isActive ? 'Local filter active' : 'Local filter'}
        style={{
          ...BUTTON_BASE,
          background:   isActive ? '#111827' : 'transparent',
          borderColor:  isActive ? '#111827' : '#cbd5e1',
          color:        isActive ? '#ffffff' : '#94a3b8',
        }}
      >
        <Filter size={12} strokeWidth={2.5} />
      </button>

      {dropdownOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            minWidth: 300,
            background: 'var(--background)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            zIndex: dialogOpen ? 40 : 9999,
            overflow: 'hidden',
          }}
        >
          {FILTER_TYPES.map(({ type, label, icon }) => {
            const rule = pending[type];
            return (
              <div
                key={type}
                role="button"
                tabIndex={0}
                onClick={() => openType(type)}
                onKeyDown={e => e.key === 'Enter' && openType(type)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 16px', cursor: 'pointer',
                  borderBottom: '1px solid var(--border)',
                  transition: 'background 0.1s',
                  userSelect: 'none',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <span style={{ color: rule ? 'var(--primary)' : 'var(--muted-foreground)', display: 'flex', flexShrink: 0 }}>
                  {icon}
                </span>
                <span style={{ fontSize: 14, flex: 1, color: 'var(--foreground)' }}>{label}</span>
                {rule && (
                  <span style={{
                    fontSize: 11, color: 'var(--primary)', fontWeight: 600,
                    maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {slotLabel(rule)}
                  </span>
                )}
                {rule && (
                  <button
                    onClick={e => removeFilter(type, e)}
                    title={`Remove ${label} filter`}
                    style={{
                      display: 'flex', alignItems: 'center', flexShrink: 0,
                      background: 'none', border: 'none', padding: 2,
                      cursor: 'pointer', color: 'var(--muted-foreground)',
                    }}
                  >
                    <X size={12} />
                  </button>
                )}
                <ChevronRight size={12} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
              </div>
            );
          })}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px' }}>
            <button
              onClick={handleClearAll}
              style={{
                fontSize: 13, background: 'none', border: 'none', padding: 0,
                color: isActive ? 'var(--foreground)' : 'var(--muted-foreground)',
                cursor: isActive ? 'pointer' : 'default',
              }}
            >
              Clear all
            </button>
            <button
              onClick={handleApply}
              disabled={!isDirty}
              style={{
                fontSize: 13, padding: '6px 18px', borderRadius: 6, border: 'none',
                background: isDirty ? '#111827' : 'var(--muted)',
                color:      isDirty ? '#ffffff'  : 'var(--muted-foreground)',
                cursor:     isDirty ? 'pointer'  : 'not-allowed',
                transition: 'background 0.12s',
              }}
            >
              Apply
            </button>
          </div>
        </div>
      )}

      {/* Confirmation dialog when closing with unapplied changes */}
      <Dialog open={confirmClose} onOpenChange={(o) => { if (!o) setConfirmClose(false); }}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>Apply local filter?</DialogTitle>
          </DialogHeader>
          <p style={{ fontSize: 13, color: 'var(--muted-foreground)', margin: 0 }}>
            You have unapplied filter changes. Would you like to apply them before closing?
          </p>
          <DialogFooter style={{ gap: 8 }}>
            <Button
              variant="default"
              onClick={() => { setConfirmClose(false); setDropdownOpen(false); }}
            >
              No
            </Button>
            <Button
              variant="outline"
              onClick={() => { handleApply(); setConfirmClose(false); }}
            >
              Yes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <FilterConfigDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        filterType={activeType}
        existingRule={pending[activeType]}
        availableObjectTypes={objectTypes}
        availableActivities={activities}
        onSubmit={handleDialogSubmit}
        icon={activeConfig.icon}
        titleLabel={activeConfig.label}
        hasFile={!!fileId}
        fileId={fileId as number | undefined}
      />
    </div>
  );
}
