// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CanvasSearchChip } from './canvas';

afterEach(() => cleanup());

describe('CanvasSearchChip', () => {
  it('widens from the search icon into the field and closes again', () => {
    const utils = render(
      <CanvasSearchChip label="Find resource">{() => <input aria-label="query" />}</CanvasSearchChip>,
    );
    expect(utils.queryByLabelText('query')).toBeNull();
    fireEvent.click(utils.getByRole('button', { name: 'Find resource' }));
    expect(utils.getByLabelText('query')).not.toBeNull();
    fireEvent.click(utils.getByRole('button', { name: 'Close find resource' }));
    expect(utils.queryByLabelText('query')).toBeNull();
  });

  it('hands the field a way to close the chip', () => {
    const utils = render(
      <CanvasSearchChip label="Find resource">
        {(close) => (
          <button type="button" onClick={close}>
            pick
          </button>
        )}
      </CanvasSearchChip>,
    );
    fireEvent.click(utils.getByRole('button', { name: 'Find resource' }));
    fireEvent.click(utils.getByRole('button', { name: 'pick' }));
    expect(utils.getByRole('button', { name: 'Find resource' })).not.toBeNull();
  });
});
