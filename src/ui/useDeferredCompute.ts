import { useEffect, useRef, useState } from 'react';

/**
 * Runs an expensive synchronous computation without freezing the first paint.
 *
 * The simulations take from ~70ms to about a second. Inside `useMemo` that
 * work happens before React can paint, so the UI simply locks up with no
 * indication anything is happening. Deferring it to an effect lets the page
 * render first and say so.
 *
 * The previous result is kept while the next one computes, so switching a
 * checkbox updates in place rather than blanking the screen and reflowing —
 * flicker reads as breakage even when it is faster.
 */
export function useDeferredCompute<T>(compute: () => T, deps: unknown[]): {
  value: T | null;
  pending: boolean;
} {
  const [value, setValue] = useState<T | null>(null);
  const [pending, setPending] = useState(true);
  const latest = useRef(0);

  useEffect(() => {
    const run = ++latest.current;
    setPending(true);

    // A timer, deliberately not requestAnimationFrame. rAF does not fire while
    // the page is hidden or backgrounded, so the computation would never run
    // and the screen would sit on "working…" forever — which is exactly what
    // happened the first time this was tested in a hidden tab. A macrotask is
    // enough to let the browser paint the pending state first.
    const handle = setTimeout(() => {
      const result = compute();
      // A later run may have started while this one was working.
      if (latest.current !== run) return;
      setValue(result);
      setPending(false);
    }, 16);

    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { value, pending };
}
