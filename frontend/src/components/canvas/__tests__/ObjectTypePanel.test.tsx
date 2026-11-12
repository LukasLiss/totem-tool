// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectTypePanel, type ObjectTypePanelProps } from '../ObjectTypePanel';

const TYPES = [
  { type: 'order', color: '#f00' },
  { type: 'item', color: '#0f0' },
  { type: 'package', color: '#00f', available: false },
];

/** The panel with its visibility and collapsed state held like a visualizer would. */
function Harness(props: Partial<ObjectTypePanelProps> & { initial?: Record<string, boolean> }) {
  const [visibility, setVisibility] = useState<Record<string, boolean>>(
    props.initial ?? { order: true, item: true, package: false },
  );
  const [collapsed, setCollapsed] = useState(false);
  return (
    <>
      <output data-testid="visibility">{JSON.stringify(visibility)}</output>
      <ObjectTypePanel
        types={TYPES}
        visibility={visibility}
        onVisibilityChange={setVisibility}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        {...props}
      />
    </>
  );
}

const visibility = (utils: ReturnType<typeof render>) => JSON.parse(utils.getByTestId('visibility').textContent!);

afterEach(() => cleanup());

describe('ObjectTypePanel', () => {
  it('toggles a type with a click on its line', () => {
    const utils = render(<Harness />);
    const item = utils.getByRole('switch', { name: 'Show item' });
    expect(item.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(item);
    expect(visibility(utils)).toEqual({ order: true, item: false, package: false });
    expect(utils.getByRole('switch', { name: 'Show item' }).getAttribute('aria-checked')).toBe('false');
  });

  it('shows only one type on Alt-click, and all again on a second Alt-click', () => {
    const utils = render(<Harness />);
    fireEvent.click(utils.getByRole('switch', { name: 'Show order' }), { altKey: true });
    expect(visibility(utils)).toEqual({ order: true, item: false, package: false });
    fireEvent.click(utils.getByRole('switch', { name: 'Show order' }), { altKey: true });
    // Unavailable types stay off.
    expect(visibility(utils)).toEqual({ order: true, item: true, package: false });
  });

  it('greys out types without anything to show', () => {
    const utils = render(<Harness />);
    expect((utils.getByRole('switch', { name: 'Show package' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('highlights shown types on hover only', () => {
    const onHighlight = vi.fn();
    const utils = render(<Harness onHighlight={onHighlight} initial={{ order: true, item: false, package: false }} />);
    const line = (type: string) => utils.container.querySelector(`[data-object-type="${type}"]`)!;
    fireEvent.mouseEnter(line('order'));
    expect(onHighlight).toHaveBeenLastCalledWith('order');
    fireEvent.mouseLeave(line('order'));
    expect(onHighlight).toHaveBeenLastCalledWith(null);
    onHighlight.mockClear();
    fireEvent.mouseEnter(line('item'));
    expect(onHighlight).not.toHaveBeenCalledWith('item');
  });

  it('folds per-type details away, with their value on the line', () => {
    const utils = render(
      <Harness
        renderDetail={(type) => (type === 'order' ? <span>order slider</span> : null)}
        detailSummary={(type) => (type === 'order' ? { text: '≥ 12', active: true } : null)}
      />,
    );
    expect(utils.queryByText('order slider')).toBeNull();
    expect(utils.getByText('≥ 12')).not.toBeNull();
    expect(utils.queryByRole('button', { name: 'Unfold item settings' })).toBeNull();
    fireEvent.click(utils.getByRole('button', { name: 'Unfold order settings' }));
    expect(utils.getByText('order slider')).not.toBeNull();
    // The value stays on the line while unfolded.
    expect(utils.getByText('≥ 12')).not.toBeNull();
    fireEvent.click(utils.getByRole('button', { name: 'Fold order settings' }));
    expect(utils.queryByText('order slider')).toBeNull();
  });

  it('shows an inactive value only while unfolded', () => {
    const utils = render(
      <Harness
        renderDetail={() => <span>slider</span>}
        detailSummary={() => ({ text: '≥ 0', active: false })}
      />,
    );
    expect(utils.queryByText('≥ 0')).toBeNull();
    fireEvent.click(utils.getByRole('button', { name: 'Unfold order settings' }));
    expect(utils.getAllByText('≥ 0')).toHaveLength(1);
  });

  it('collapses to a chip with the type count and the hidden ones', () => {
    const utils = render(<Harness initial={{ order: true, item: false, package: false }} />);
    fireEvent.click(utils.getByRole('button', { name: 'Hide object types' }));
    const chip = utils.getByRole('button', { name: 'Show object types' });
    expect(chip.textContent).toContain('3 object types · 1 hidden');
    fireEvent.click(chip);
    expect(utils.getByRole('switch', { name: 'Show order' })).not.toBeNull();
  });

  it('shows all and hides all from its menu', async () => {
    const utils = render(<Harness initial={{ order: false, item: false, package: false }} />);
    await act(async () => {
      fireEvent.pointerDown(utils.getByRole('button', { name: 'Object types options' }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    });
    await act(async () => {
      fireEvent.click(utils.getByRole('menuitem', { name: 'Show all' }));
    });
    expect(visibility(utils)).toEqual({ order: true, item: true, package: false });
  });

  it('offers a search field for many types', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ type: `type ${i}`, color: '#000' }));
    const utils = render(<Harness types={many} initial={{}} />);
    fireEvent.change(utils.getByRole('searchbox', { name: 'Find an object type' }), { target: { value: 'type 1' } });
    // "type 1", "type 10", "type 11"
    expect(utils.getAllByRole('switch')).toHaveLength(3);
  });

  it('has no search field for a few types', () => {
    expect(render(<Harness />).queryByRole('searchbox')).toBeNull();
  });

  it('has no height cap of its own, so it can grow as far as its container lets it', () => {
    const panel = render(<Harness testId="panel" />).getByTestId('panel');
    expect(panel.style.maxHeight).toBe('');
    expect(['0', '0px']).toContain(panel.style.minHeight);
  });

  it('stays left-aligned inside a text-centred container (dashboard widgets)', () => {
    const utils = render(
      <div style={{ textAlign: 'center' }}>
        <Harness testId="panel" />
      </div>,
    );
    expect(utils.getByTestId('panel').style.textAlign).toBe('left');
    fireEvent.click(utils.getByRole('button', { name: 'Hide object types' }));
    expect(utils.getByTestId('panel').style.textAlign).toBe('left');
  });

  it('is a plain list without visibility', () => {
    const utils = render(<ObjectTypePanel types={TYPES} collapsed={false} onCollapsedChange={() => undefined} />);
    expect(utils.queryAllByRole('switch')).toHaveLength(0);
    expect(utils.queryByRole('button', { name: 'Object types options' })).toBeNull();
    expect(utils.getByText('order')).not.toBeNull();
  });
});
