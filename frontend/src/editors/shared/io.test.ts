// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadJson } from './io';

type Stub = (options?: unknown) => Promise<unknown>;

/** `showSaveFilePicker` is optional and absent from happy-dom, so stub it in. */
function stubPicker(impl: Stub) {
  (window as unknown as Record<string, unknown>).showSaveFilePicker = impl;
}

function clearPicker() {
  delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
}

function namedError(name: string) {
  return Object.assign(new Error(name), { name });
}

/** A picker that resolves, capturing the options it got and the bytes written. */
function acceptingPicker() {
  const write = vi.fn();
  const close = vi.fn();
  const seen: { suggestedName?: string }[] = [];
  const picker = async (options: { suggestedName?: string }) => {
    seen.push(options);
    return { createWritable: async () => ({ write, close }) };
  };
  stubPicker(picker as unknown as Stub);
  return { seen, write, close };
}

describe('downloadJson', () => {
  /** The `download` attribute of every anchor the fallback path clicked. */
  let clicked: string[];

  beforeEach(() => {
    clicked = [];
    // Assigned rather than spied on: happy-dom does not guarantee either.
    URL.createObjectURL = vi.fn(() => 'blob:stub') as never;
    URL.revokeObjectURL = vi.fn() as never;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      function (this: HTMLAnchorElement) {
        clicked.push(this.download);
      },
    );
  });

  afterEach(() => {
    clearPicker();
    vi.restoreAllMocks();
  });

  it('reports a save only once the bytes are written', async () => {
    const { seen, write, close } = acceptingPicker();

    const outcome = await downloadJson('alpha', { a: 1 });

    expect(outcome).toBe('saved');
    expect(JSON.parse(String(write.mock.calls[0][0]))).toEqual({ a: 1 });
    expect(close).toHaveBeenCalled();
    expect(seen[0].suggestedName).toBe('alpha.json');
    // The picker wrote the file; the browser was never handed a download.
    expect(clicked).toEqual([]);
  });

  it('does not double the extension on a name that already has one', async () => {
    const { seen } = acceptingPicker();

    await downloadJson('alpha.json', {});

    expect(seen[0].suggestedName).toBe('alpha.json');
  });

  it('reports a dismissed dialog as cancelled, having written nothing', async () => {
    stubPicker(vi.fn(() => Promise.reject(namedError('AbortError'))) as unknown as Stub);

    expect(await downloadJson('alpha', {})).toBe('cancelled');
    expect(clicked).toEqual([]);
  });

  it('falls back to a download where there is no picker', async () => {
    clearPicker();

    expect(await downloadJson('alpha', {})).toBe('downloaded');
    expect(clicked).toEqual(['alpha.json']);
  });

  it('falls back to a download when the picker is refused', async () => {
    // What a caller that fetched its data first meets: the picker needs recent
    // user activation and the request outlived it.
    stubPicker(vi.fn(() => Promise.reject(namedError('SecurityError'))) as unknown as Stub);

    expect(await downloadJson('alpha', {})).toBe('downloaded');
    expect(clicked).toEqual(['alpha.json']);
  });

  it('lets a failure after a chosen location reach the caller', async () => {
    stubPicker(
      vi.fn(async () => ({
        createWritable: async () => {
          throw new Error('disk full');
        },
      })) as unknown as Stub,
    );

    await expect(downloadJson('alpha', {})).rejects.toThrow('disk full');
    // Not also downloaded elsewhere: the user picked a place, and that write
    // failing is theirs to hear about.
    expect(clicked).toEqual([]);
  });
});
