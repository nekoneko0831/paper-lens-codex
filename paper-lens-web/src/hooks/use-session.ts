"use client";

import * as React from "react";
import { useStore } from "@/lib/store";
import { sseManager } from "@/lib/sse-manager";
import { toast } from "sonner";

/**
 * Drives the SSE manager from the store. For every paper whose session is
 * in a streamable state (starting / streaming / waiting), an EventSource
 * is kept open.
 *
 * IMPORTANT: the selector below MUST return a primitive (string) so Zustand
 * can compare by value instead of reference. Returning an array from a
 * selector creates a fresh object every render and causes an infinite
 * loop: render → selector → new array → state change → render.
 */
export function useSession() {
  // Stable string key: "paperA:sid1|paperB:sid2" for all streamable sessions.
  const desiredKey = useStore((s) => {
    const entries: string[] = [];
    for (const [paper, sess] of Object.entries(s.sessions)) {
      if (!sess.sessionId) continue;
      if (
        sess.sessionStatus === "done" ||
        sess.sessionStatus === "error" ||
        sess.sessionStatus === "idle"
      )
        continue;
      entries.push(`${paper}:${sess.sessionId}`);
    }
    entries.sort();
    return entries.join("|");
  });

  const handleEvent = useStore((s) => s.handleEvent);
  const endSession = useStore((s) => s.endSession);

  React.useEffect(() => {
    const desired = desiredKey
      ? desiredKey.split("|").map((x) => {
          const [paper, sessionId] = x.split(":");
          return { paper, sessionId };
        })
      : [];
    sseManager.sync(desired, {
      onEvent: (paper, ev) => handleEvent(paper, ev),
      onExpired: (paper) => {
        toast.info(`${paper} 的会话已过期，继续对话会自动恢复`, { duration: 3000 });
        endSession(paper);
      },
    });
  }, [desiredKey, handleEvent, endSession]);

  React.useEffect(() => {
    return () => sseManager.stopAll();
  }, []);
}
