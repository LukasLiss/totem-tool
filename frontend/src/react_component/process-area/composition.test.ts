import { describe, expect, it } from 'vitest';

import {
  allAreas,
  autoAreaName,
  compositionFromLayers,
  compositionProblems,
  compositionToLayers,
  defaultActivitiesForArea,
  findArea,
  fromAssetContent,
  hasBlockingProblems,
  insertLevel,
  locateObjectType,
  moveArea,
  moveObjectType,
  removeLevel,
  renameArea,
  renameComposition,
  resetAreaActivities,
  sameComposition,
  setAreaActivities,
  toAssetContent,
  type ProcessAreaComposition,
} from './composition';

const ACTIVITIES: Record<string, string[]> = {
  order: ['place order', 'pay order', 'pick item'],
  item: ['pick item', 'pack item'],
  package: ['pack item', 'ship package'],
  employee: ['place order', 'pick item', 'pack item', 'ship package'],
  truck: ['ship package'],
};

function discovered(): ProcessAreaComposition {
  return compositionFromLayers(
    [
      {
        level: 0,
        areas: [
          { objectTypes: ['order', 'item'], eventTypes: ['place order', 'pay order', 'pick item', 'pack item'] },
          { objectTypes: ['package'], eventTypes: ['ship package'] },
        ],
      },
      { level: 2, areas: [{ objectTypes: ['employee', 'truck'], eventTypes: [] }] },
    ],
    { name: 'Discovered', allObjectTypes: ['order', 'item', 'package', 'employee', 'truck', 'customer'] },
  );
}

function areaByTypes(c: ProcessAreaComposition, ...types: string[]) {
  const area = allAreas(c).find((a) => types.every((t) => a.objectTypes.includes(t)));
  if (!area) throw new Error(`no area with ${types.join(', ')}`);
  return area;
}

describe('compositionFromLayers', () => {
  it('compacts levels bottom-up, names areas after their types, and tracks unassigned types', () => {
    const c = discovered();
    expect(c.levels).toHaveLength(2);
    expect(c.levels[0].areas.map((a) => a.name)).toEqual(['item & order', 'package']);
    expect(c.levels[1].areas.map((a) => a.objectTypes)).toEqual([['employee', 'truck']]);
    expect(c.unassigned).toEqual(['customer']);
    // Ids match the scheme of the discovered snapshot so selections carry over.
    expect(c.levels[0].areas[1].id).toBe('level-0-area-1-package');
  });
});

describe('moveObjectType', () => {
  it('adds a type to an area, carrying its activities and following the auto name', () => {
    const c = discovered();
    const target = areaByTypes(c, 'package');
    const next = moveObjectType(c, 'truck', { kind: 'area', areaId: target.id }, ACTIVITIES);
    const moved = findArea(next, target.id)!.area;
    expect(moved.objectTypes).toEqual(['package', 'truck']);
    expect(moved.name).toBe('package & truck');
    expect(moved.activities).toContain('ship package');
    // The source area lost the type and kept its user-visible name in step.
    expect(areaByTypes(next, 'employee').name).toBe('employee');
  });

  it('moving a type out onto a level creates a separate area there', () => {
    const c = discovered();
    const next = moveObjectType(c, 'item', { kind: 'newArea', levelIndex: 0 }, ACTIVITIES);
    expect(next.levels[0].areas.map((a) => a.objectTypes)).toEqual([['order'], ['package'], ['item']]);
    const order = areaByTypes(next, 'order');
    // "pack item" was only there because of item; "pick item" order shares.
    expect(order.activities).toEqual(['pay order', 'pick item', 'place order']);
    // The new area does not re-claim what is already claimed on lower levels;
    // on its own level it takes the type's activities.
    expect(areaByTypes(next, 'item').activities).toEqual(['pack item', 'pick item']);
  });

  it('moves a type to another level and removes the then-empty area', () => {
    const c = discovered();
    const next = moveObjectType(c, 'package', { kind: 'newArea', levelIndex: 1 }, ACTIVITIES);
    expect(next.levels[0].areas).toHaveLength(1);
    expect(next.levels[1].areas.map((a) => a.objectTypes)).toEqual([['employee', 'truck'], ['package']]);
    expect(locateObjectType(next, 'package')).toMatchObject({ kind: 'area', levelIndex: 1 });
  });

  it('keeps a name the user chose', () => {
    let c = discovered();
    const area = areaByTypes(c, 'order');
    c = renameArea(c, area.id, 'Order handling');
    c = moveObjectType(c, 'package', { kind: 'area', areaId: area.id }, ACTIVITIES);
    expect(findArea(c, area.id)!.area.name).toBe('Order handling');
  });

  it('takes types in and out of the unassigned tray', () => {
    let c = discovered();
    const target = areaByTypes(c, 'order');
    c = moveObjectType(c, 'customer', { kind: 'area', areaId: target.id }, ACTIVITIES);
    expect(c.unassigned).toEqual([]);
    c = moveObjectType(c, 'employee', { kind: 'unassigned' }, ACTIVITIES);
    expect(c.unassigned).toEqual(['employee']);
  });

  it('is a no-op for a lone type dropped on a new area of its own level', () => {
    const c = discovered();
    expect(moveObjectType(c, 'package', { kind: 'newArea', levelIndex: 0 }, ACTIVITIES)).toBe(c);
  });

  it('gives new areas unique names', () => {
    let c = discovered();
    const pkg = areaByTypes(c, 'package');
    c = renameArea(c, pkg.id, 'truck');
    c = moveObjectType(c, 'truck', { kind: 'newArea', levelIndex: 0 }, ACTIVITIES);
    expect(areaByTypes(c, 'truck').name).toBe('truck (2)');
    expect(hasBlockingProblems(c)).toBe(false);
  });
});

describe('moveArea', () => {
  it('moves an area to another level and merges two areas', () => {
    const c = discovered();
    const pkg = areaByTypes(c, 'package');
    const up = moveArea(c, pkg.id, { kind: 'newArea', levelIndex: 1 });
    expect(up.levels[1].areas.map((a) => a.id)).toContain(pkg.id);

    const order = areaByTypes(c, 'order');
    const merged = moveArea(c, pkg.id, { kind: 'area', areaId: order.id });
    expect(findArea(merged, order.id)!.area.objectTypes).toEqual(['item', 'order', 'package']);
    expect(findArea(merged, pkg.id)).toBeNull();
  });
});

describe('levels', () => {
  it('inserts levels anywhere and removes them, freeing their object types', () => {
    let c = discovered();
    c = insertLevel(c, 1);
    expect(c.levels.map((l) => l.areas.length)).toEqual([2, 0, 1]);
    c = insertLevel(c, 99);
    expect(c.levels).toHaveLength(4);
    c = removeLevel(c, 2);
    expect(c.levels.map((l) => l.areas.length)).toEqual([2, 0, 0]);
    expect(c.unassigned).toEqual(['customer', 'employee', 'truck']);
  });

  it('never removes the last level', () => {
    const c = compositionFromLayers([], { name: 'x' });
    expect(removeLevel(c, 0)).toBe(c);
  });
});

describe('activities', () => {
  it('derives defaults from types, skipping activities claimed on lower levels', () => {
    const c = discovered();
    const staff = areaByTypes(c, 'employee');
    expect(defaultActivitiesForArea(c, staff.id, ACTIVITIES)).toEqual([]);
    const reset = resetAreaActivities(
      setAreaActivities(c, areaByTypes(c, 'order').id, ['pay order']),
      areaByTypes(c, 'order').id,
      ACTIVITIES,
    );
    expect(areaByTypes(reset, 'order').activities).toEqual(['pack item', 'pay order', 'pick item', 'place order']);
  });
});

describe('validation', () => {
  it('requires a composition name and unique, non-empty area names', () => {
    let c = renameComposition(discovered(), '  ');
    expect(compositionProblems(c).filter((p) => p.severity === 'error').map((p) => p.message)).toEqual([
      'Give the composition a name.',
    ]);
    c = renameComposition(c, 'Mine');
    const [a, b] = allAreas(c);
    c = renameArea(renameArea(c, a.id, 'Same'), b.id, 'same');
    expect(hasBlockingProblems(c)).toBe(true);
    c = renameArea(c, b.id, '');
    expect(compositionProblems(c).some((p) => p.message === 'Every process area needs a name.')).toBe(true);
  });

  it('warns about empty levels and unassigned types without blocking', () => {
    const c = insertLevel(discovered(), 0);
    const problems = compositionProblems(c);
    expect(problems.every((p) => p.severity === 'warning')).toBe(true);
    expect(problems.map((p) => p.message)).toEqual(
      expect.arrayContaining([
        '1 empty level will be dropped when the composition is applied.',
        '1 object type is in no process area.',
      ]),
    );
  });
});

describe('conversions', () => {
  it('round-trips through the asset format, dropping empty levels', () => {
    let c = insertLevel(discovered(), 1);
    c = renameArea(c, areaByTypes(c, 'order').id, 'Order handling');
    const content = toAssetContent(c);
    expect(content.schema).toBe('process-areas');
    expect(content.levels.map((l) => l.level)).toEqual([0, 1]);
    expect(content.unassignedObjectTypes).toEqual(['customer']);

    const back = fromAssetContent(content, { name: 'Discovered', assetId: 7 });
    expect(back.source).toEqual({ kind: 'asset', assetId: 7 });
    expect(sameComposition(back, c)).toBe(true);
    expect(areaByTypes(back, 'order').id).toBe(areaByTypes(c, 'order').id);
  });

  it('adds object types of the log that the stored composition does not know', () => {
    const back = fromAssetContent(toAssetContent(discovered()), {
      name: 'x',
      allObjectTypes: ['order', 'invoice'],
    });
    expect(back.unassigned).toEqual(['customer', 'invoice']);
  });

  it('produces visualizer layers top-down with names as labels', () => {
    let c = discovered();
    c = renameArea(c, areaByTypes(c, 'employee').id, 'Staff & fleet');
    const layers = compositionToLayers(c);
    expect(layers.map((l) => l.level)).toEqual([1, 0]);
    expect(layers[0].areas[0]).toMatchObject({ label: 'Staff & fleet', level: 1 });
  });

  it('keeps empty levels for the editable canvas, numbered by their index', () => {
    const c = insertLevel(discovered(), 1);
    expect(compositionToLayers(c).map((l) => l.level)).toEqual([1, 0]);
    const editing = compositionToLayers(c, { keepEmptyLevels: true });
    expect(editing.map((l) => [l.level, l.areas.length])).toEqual([[2, 1], [1, 0], [0, 2]]);
  });

  it('names areas after their object types by default', () => {
    expect(autoAreaName(['b', 'a'])).toBe('a & b');
  });
});
