// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import TotemMiner from './TotemMiner';

afterEach(() => cleanup());

describe('TotemMiner', () => {
  it('puts the title on the canvas and τ, relayout and save into the shared pill', () => {
    const { container } = render(<TotemMiner fileId={null} height="100%" onToggleFilter={() => undefined} />);
    expect(screen.getByText('TOTeM Model')).toBeTruthy();
    const pill = screen.getByRole('button', { name: 'Fit to view' }).closest('[data-pill-spot]') as HTMLElement;
    expect(pill.dataset.pillSpot).toBe('bottom-right');
    expect(pill.querySelector('[aria-label="τ"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Relayout' })).toBeTruthy();
    // No header bar above the canvas any more.
    expect(container.querySelector('[data-testid="widget-header"]')).toBeNull();
  });

  it('starts in the fit mode and leaves it when zooming, until fit is pressed', () => {
    render(<TotemMiner fileId={null} height="100%" />);
    const fit = () => screen.getByRole('button', { name: 'Fit to view' });
    expect(fit().getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTitle('Zoom in'));
    expect(fit().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(fit());
    expect(fit().getAttribute('aria-pressed')).toBe('true');
  });
});
