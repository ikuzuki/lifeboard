import { useEffect, useRef } from 'react';

/**
 * Makes the platform back gesture and the Escape key close the topmost overlay instead of
 * leaving the app.
 *
 * In an installed PWA there is no browser chrome, so Android's back button and iOS's
 * back-swipe act on history directly. With a single history entry, backing out of a
 * full-screen editor exits the app entirely and the user loses their place, which is the
 * clearest way an installed web app gives itself away as a web page.
 *
 * The fix is to give the overlay a history entry of its own. Opening pushes one; a back
 * gesture pops it and we close instead of navigating. Closing by any other route (the X,
 * Escape, Save) has to remove that entry again, or the entry accumulates and the next
 * back press appears to do nothing.
 *
 * iOS gets the same behaviour from the same code: Safari's edge-swipe is a history
 * traversal and fires `popstate` identically. The difference is that iOS has no
 * hardware button, so the gesture is the only route and this matters more, not less.
 */
/**
 * Programmatic `history.back()` calls we are still waiting on. Traversal is asynchronous,
 * so the pop from closing one overlay can arrive after the next overlay has pushed its own
 * entry, and that overlay would read the stale pop as a back gesture and shut itself.
 * Opening an item straight after using the add menu did exactly that. Each pending back
 * consumes one pop as its own acknowledgement instead.
 *
 * The credit expires on its own. A traversal that never lands would otherwise leave a
 * credit sitting here to swallow the user's next real back press, which is a worse failure
 * than the one this exists to prevent.
 */
let pendingBacks = 0;

/**
 * Every overlay currently mounted, innermost last. Escape and the back gesture act on the
 * top one only. Each overlay used to attach its own `document` keydown listener with no
 * notion of depth, so one Escape press closed Settings and the Categories sheet on top of
 * it together.
 */
const stack: object[] = [];
const ACK_WINDOW_MS = 500;

function expectPop(): void {
  pendingBacks += 1;
  setTimeout(() => {
    pendingBacks = Math.max(0, pendingBacks - 1);
  }, ACK_WINDOW_MS);
}

export function useCloseOnBack(active: boolean, onClose: () => void): void {
  // Held in a ref, and deliberately out of the dependency list. Callers pass an inline
  // arrow, so a new identity arrives on every parent render; with `onClose` as a
  // dependency the cleanup ran on each of those renders, popped the overlay's own history
  // entry and closed it. Any edit made from inside an overlay dismissed the overlay.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!active) return;
    const token = {};
    stack.push(token);
    const topmost = () => stack.at(-1) === token;

    // Marked, so a pop can be told apart from arriving here by any other means.
    history.pushState({ lifeboardOverlay: true }, '');
    let closedByBack = false;

    const onPop = () => {
      if (pendingBacks > 0) {
        pendingBacks -= 1;
        return;
      }
      if (!topmost()) return;
      closedByBack = true;
      close.current();
    };
    window.addEventListener('popstate', onPop);

    // Escape lives here too, so depth is decided once rather than in every overlay.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !topmost()) return;
      e.stopPropagation();
      close.current();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      const at = stack.lastIndexOf(token);
      if (at !== -1) stack.splice(at, 1);
      // Closed by the X, Escape or Save: our entry is still on the stack, so take it off.
      // Guarded, because after a back gesture the browser has already removed it and
      // calling back() again would leave the app.
      if (!closedByBack && history.state?.lifeboardOverlay) {
        expectPop();
        history.back();
      }
    };
  }, [active]);
}
