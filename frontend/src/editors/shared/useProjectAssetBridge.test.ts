import { describe, expect, it, vi } from 'vitest';

import type { ProjectAsset } from '@/api/assetsApi';

import { openProjectAsset } from './useProjectAssetBridge';

const asset: ProjectAsset = {
  id: 42,
  project: 7,
  name: 'Reviewed model',
  asset_type: 'TOTEM',
  content_json: { schema: 'totem', version: 1 },
  metadata: {},
  created_by: 1,
  created_at: '2026-07-22T10:00:00Z',
  updated_at: '2026-07-22T10:00:00Z',
};

describe('openProjectAsset', () => {
  it('returns the opened-asset identity only after the editor accepts the content', async () => {
    const onOpen = vi.fn().mockResolvedValue(undefined);

    await expect(openProjectAsset(asset, onOpen)).resolves.toEqual({
      id: asset.id,
      name: asset.name,
    });
    expect(onOpen).toHaveBeenCalledWith(asset.content_json, asset.name);
  });

  it('propagates editor load failures instead of marking the asset as opened', async () => {
    const onOpen = vi.fn().mockRejectedValue(new Error('Invalid canonical model'));

    await expect(openProjectAsset(asset, onOpen)).rejects.toThrow('Invalid canonical model');
  });
});
