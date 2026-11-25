// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import LabCanvas from '../LabCanvas';
import { fromTraces } from '../graph';
import { computeLayout } from '../layout';
import { DEFAULT_OPTIONS } from '../options';

// order: place → pay → ship; item: place → pick → ship; "pick" belongs to item only.
const graph = fromTraces({
  order: [[['place', 'pay', 'ship'], 5]],
  item: [[['place', 'pick', 'ship'], 8]],
});
const colors = { order: '#2563EB', item: '#10B981' };

function setup(options = DEFAULT_OPTIONS) {
  const result = computeLayout(graph, options);
  const view = render(<LabCanvas result={result} options={options} colors={colors} />);
  const node = (id: string) => view.container.querySelector(`[data-node-id="${CSS.escape(id)}"]`)!;
  const arc = (id: string) => view.container.querySelector(`[data-arc-id="${CSS.escape(id)}"]`)!;
  const opacity = (el: Element) => Number(el.getAttribute('opacity'));
  return { view, node, arc, opacity };
}

afterEach(cleanup);

describe('LabCanvas hover highlighting', () => {
  it('highlights only the arcs and activities of a type while its lane title is hovered', () => {
    const { view, node, arc, opacity } = setup();
    const title = view.getByTestId('lane-title-item');

    fireEvent.mouseEnter(title);
    expect(opacity(arc('pick→ship@item'))).toBeGreaterThan(0.5);
    expect(opacity(arc('pay→ship@order'))).toBeLessThan(0.2);
    expect(opacity(node('pick'))).toBe(1);
    expect(opacity(node('place'))).toBe(1); // shared with item
    expect(opacity(node('pay'))).toBeLessThan(1); // order only
    expect(opacity(node('__start__:order'))).toBeLessThan(1);

    fireEvent.mouseLeave(title);
    expect(opacity(arc('pay→ship@order'))).toBeGreaterThan(0.5);
    expect(opacity(node('pay'))).toBe(1);
  });

  it('fades activities that are not connected to the hovered activity', () => {
    const { node, arc, opacity } = setup();
    fireEvent.mouseEnter(node('pay'));
    // pay is connected to place (before) and ship (after), not to pick.
    expect(opacity(node('pay'))).toBe(1);
    expect(opacity(node('place'))).toBe(1);
    expect(opacity(node('ship'))).toBe(1);
    expect(opacity(node('pick'))).toBeLessThan(1);
    expect(opacity(node('__start__:item'))).toBeLessThan(1);
    expect(opacity(arc('place→pay@order'))).toBeGreaterThan(0.5);
    expect(opacity(arc('pick→ship@item'))).toBeLessThan(0.2);

    fireEvent.mouseLeave(node('pay'));
    expect(opacity(node('pick'))).toBe(1);
  });

  it('dims merge-point trunks of arcs that are not highlighted', () => {
    const options = { ...DEFAULT_OPTIONS, mergePoints: true };
    const result = computeLayout(graph, options);
    expect(result.trunks.every((t) => t.arcs.length > 0 && t.node)).toBe(true);
    const { view, opacity } = setup(options);
    fireEvent.mouseEnter(view.getByTestId('lane-title-order'));
    const trunks = [...view.container.querySelectorAll('g[opacity]')].filter((g) => g.getAttribute('opacity') === '0.08');
    expect(trunks.length).toBeGreaterThan(0);
    expect(trunks.every((g) => opacity(g) < 0.2)).toBe(true);
  });
});
