// @vitest-environment happy-dom

import { createElement, type ReactNode } from 'react';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAsset, type ProjectAsset } from '@/api/assetsApi';
import { DashboardContext } from '@/contexts/DashboardContext';
import { SelectedFileContext } from '@/contexts/SelectedFileContext';

import { useProjectAssetBridge } from './useProjectAssetBridge';

vi.mock('@/api/assetsApi', async () => {
  const actual = await vi.importActual<typeof import('@/api/assetsApi')>(
    '@/api/assetsApi',
  );
  return {
    ...actual,
    getAsset: vi.fn(),
  };
});

const getAssetMock = vi.mocked(getAsset);

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

describe('useProjectAssetBridge auto-open', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('loads the asset carried by editor navigation into the editor', async () => {
    getAssetMock.mockResolvedValue(asset);
    const onOpen = vi.fn().mockResolvedValue(undefined);

    renderHook(
      () =>
        useProjectAssetBridge({
          assetType: 'TOTEM',
          modelName: 'Current model',
          serializeAsset: () => ({}),
          onOpen,
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(
            SelectedFileContext.Provider,
            {
              value: {
                selectedFile: { id: 12, project: 7, file: 'event-log.xml' },
                setSelectedFile: vi.fn(),
              },
            },
            createElement(
              DashboardContext.Provider,
              {
                value: {
                  viewMode: {
                    type: 'editor',
                    component: 'totem',
                    openAssetId: asset.id,
                  },
                  setViewMode: vi.fn(),
                },
              },
              children,
            ),
          ),
      },
    );

    await waitFor(() => expect(onOpen).toHaveBeenCalled());

    expect(getAssetMock).toHaveBeenCalledWith(asset.id);
    expect(onOpen).toHaveBeenCalledWith(asset.content_json, asset.name);
  });
});
