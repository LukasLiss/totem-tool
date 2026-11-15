// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaybackPanel, type PlaybackPanelProps } from '../PlaybackPanel';

afterEach(() => cleanup());

function panel(props: Partial<PlaybackPanelProps> = {}) {
  const handlers = { onClose: vi.fn(), onPlay: vi.fn(), onPause: vi.fn(), onLoopChange: vi.fn(), onStop: vi.fn(), onSpeedChange: vi.fn() };
  const utils = render(
    <PlaybackPanel
      open
      status={{ kind: 'ready' }}
      renderChart={(height) => <div data-testid="chart" data-height={height} />}
      playing={false}
      loop={false}
      speed={100}
      sizeKey="test.playbackPanelSize"
      {...handlers}
      {...props}
    />,
  );
  return { ...utils, ...handlers };
}

describe('PlaybackPanel', () => {
  it('draws the chart and plays, loops and stops', () => {
    const utils = panel();
    expect(utils.getByTestId('chart')).not.toBeNull();
    fireEvent.click(utils.getByTitle('Play'));
    expect(utils.onPlay).toHaveBeenCalled();
    fireEvent.click(utils.getByTitle('Loop off'));
    expect(utils.onLoopChange).toHaveBeenCalledWith(true);
    fireEvent.click(utils.getByTitle('Stop'));
    expect(utils.onStop).toHaveBeenCalled();
    expect(utils.getByText('100×')).not.toBeNull();
  });

  it('pauses while playing', () => {
    const utils = panel({ playing: true });
    fireEvent.click(utils.getByTitle('Pause'));
    expect(utils.onPause).toHaveBeenCalled();
  });

  it('shows the loading line, and a message with Stop, instead of the chart', () => {
    let utils = panel({ status: { kind: 'loading', text: 'Loading the handovers…' } });
    expect(utils.getByText('Loading the handovers…')).not.toBeNull();
    expect(utils.queryByTestId('chart')).toBeNull();
    cleanup();
    utils = panel({ status: { kind: 'message', text: 'Nothing to animate.' } });
    fireEvent.click(utils.getByTitle('Stop'));
    expect(utils.onStop).toHaveBeenCalled();
  });

  it('shows the extra row below the playback row', () => {
    const utils = panel({ extraRow: <span>Connectors</span> });
    expect(utils.getByText('Connectors')).not.toBeNull();
  });

  it('renders nothing while closed', () => {
    const utils = panel({ open: false });
    expect(utils.container.innerHTML).toBe('');
  });
});
