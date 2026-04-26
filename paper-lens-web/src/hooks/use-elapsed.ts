"use client";

import { useEffect, useState } from "react";

/**
 * Returns a live-updating elapsed time (ms) from `start` until `end` or now.
 * Updates at ~10Hz while still running.
 */
export function useElapsed(start: number | null | undefined, end?: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  const running = start != null && end == null;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [running]);

  if (start == null) return 0;
  const endAt = end ?? now;
  return Math.max(0, endAt - start);
}
