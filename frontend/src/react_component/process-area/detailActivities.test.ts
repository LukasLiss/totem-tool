import { describe, expect, it } from 'vitest';

import { detailActivityRestriction } from './detailActivities';

const area = { activities: ['Weigh', 'PlaceinStock', 'Depart'] };

describe('detailActivityRestriction', () => {
  it('restricts the level-based view to the area activities', () => {
    expect(detailActivityRestriction(area, false)).toEqual(['Weigh', 'PlaceinStock', 'Depart']);
  });

  it('does not restrict the detailed view', () => {
    expect(detailActivityRestriction(area, true)).toBeNull();
  });

  it('intersects with a global activity filter', () => {
    expect(detailActivityRestriction(area, false, 'Depart, LoadTruck')).toEqual(['Depart']);
    expect(detailActivityRestriction(area, true, 'Depart,LoadTruck')).toEqual(['Depart', 'LoadTruck']);
  });

  it('yields an empty restriction for an area without activities of its own', () => {
    expect(detailActivityRestriction({ activities: [] }, false)).toEqual([]);
  });
});
