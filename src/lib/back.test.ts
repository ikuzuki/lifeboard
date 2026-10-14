// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let useCloseOnBack: typeof import('./back').useCloseOnBack;

beforeEach(async () => {
  vi.resetModules();
  ({ useCloseOnBack } = await import('./back'));
});

/**
 * Renders a host that owns some state, so a rerender hands the hook a brand new `onClose`
 * exactly the way `App` does. `bump` forces that rerender from outside.
 */
function mount(onClose: () => void, active = true) {
  let bump = () => {};
  function Host() {
    const [, setN] = useState(0);
    bump = () => setN((n) => n + 1);
    // Inline, to reproduce the fresh identity every render that callers really pass.
    useCloseOnBack(active, () => onClose());
    return null;
  }

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(createElement(Host)));
  return { bump: () => act(() => bump()), unmount: () => act(() => root.unmount()) };
}

describe('useCloseOnBack', () => {
  it('does not re-run its effect when a rerender passes a fresh onClose', async () => {
    // The shipped bug: with `onClose` in the dependency list, every parent render tore the
    // effect down and rebuilt it. The teardown ran history.back(), so the overlay closed
    // itself the moment anything underneath it changed state, and pushing a date from the
    // item detail dismissed the detail.
    //
    // Asserting on the effect re-running rather than on the overlay closing is deliberate.
    // jsdom queues history traversals and drops them when a pushState lands first, so the
    // close is not reproducible here, while the wasted setup is exact.
    const pushes: unknown[] = [];
    const real = history.pushState.bind(history);
    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      pushes.push(args[0]);
      real(...args);
    };

    try {
      const view = mount(() => {});
      expect(pushes).toHaveLength(1);

      for (let n = 0; n < 5; n++) view.bump();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(pushes).toHaveLength(1);
      view.unmount();
    } finally {
      history.pushState = real;
    }
  });

  it('closes on a back gesture', () => {
    let closes = 0;
    const view = mount(() => void closes++);

    act(() => void window.dispatchEvent(new PopStateEvent('popstate')));

    expect(closes).toBe(1);
    view.unmount();
  });

  it('does not let a closing overlay shut the one that opens next', () => {
    // Closing overlay A programmatically queues a history.back(). That pop can land after
    // overlay B has pushed its own entry, and B used to read it as a back gesture and
    // close. Opening an item right after using the add menu did exactly that.
    let bClosed = 0;
    const a = mount(() => {});
    a.unmount();

    const b = mount(() => void bClosed++);
    // The pop belonging to A's queued back, arriving late.
    act(() => void window.dispatchEvent(new PopStateEvent('popstate')));
    expect(bClosed).toBe(0);

    // A genuine back gesture still closes B.
    act(() => void window.dispatchEvent(new PopStateEvent('popstate')));
    expect(bClosed).toBe(1);
    b.unmount();
  });

  it('dismisses only the topmost overlay', () => {
    // One Escape press used to close Settings and the Categories sheet stacked on it
    // together, because each overlay listened on document with no notion of depth.
    let outer = 0;
    let inner = 0;
    const a = mount(() => void outer++);
    const b = mount(() => void inner++);

    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect({ outer, inner }).toEqual({ outer: 0, inner: 1 });

    // With the inner one gone, the next press reaches the outer one.
    b.unmount();
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect({ outer, inner }).toEqual({ outer: 1, inner: 1 });
    a.unmount();
  });

  it('stays out of the way while inactive', () => {
    let closes = 0;
    const view = mount(() => void closes++, false);

    act(() => void window.dispatchEvent(new PopStateEvent('popstate')));

    expect(closes).toBe(0);
    view.unmount();
  });
});
