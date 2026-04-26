import { SSEEvent } from "./types";
import { streamSession } from "./stream";

/**
 * Singleton SSE connection manager.
 *
 * Keeps one EventSource per active (paper → sessionId) pair. Use
 * `sync(desired, ...)` to diff the current active set against the target
 * set: connections that are no longer in `desired` are closed, new ones
 * are opened, and existing connections with the same sessionId are left
 * alone.
 *
 * This lets us stream multiple papers simultaneously — e.g. paper A doing
 * present mode in the background while the user reads paper B — without
 * React effect churn tearing down connections on every store update.
 */

type DesiredEntry = { paper: string; sessionId: string };

type Handlers = {
  onEvent: (paper: string, ev: SSEEvent) => void;
  onExpired: (paper: string) => void;
};

class SseManager {
  private active = new Map<string, { sessionId: string; stop: () => void }>();

  sync(desired: DesiredEntry[], handlers: Handlers) {
    const wanted = new Map<string, string>(desired.map((d) => [d.paper, d.sessionId]));

    // Drop connections that are no longer wanted or whose sessionId changed.
    for (const [paper, entry] of this.active.entries()) {
      const wantedSid = wanted.get(paper);
      if (wantedSid !== entry.sessionId) {
        entry.stop();
        this.active.delete(paper);
      }
    }

    // Open new connections for anything not yet connected.
    for (const { paper, sessionId } of desired) {
      if (this.active.has(paper)) continue;
      const stop = streamSession(
        sessionId,
        (ev) => handlers.onEvent(paper, ev),
        () => handlers.onExpired(paper),
        (err) => {
          console.error(`[sse ${paper}]`, err);
        }
      );
      this.active.set(paper, { sessionId, stop });
    }
  }

  stop(paper: string) {
    const entry = this.active.get(paper);
    if (entry) {
      entry.stop();
      this.active.delete(paper);
    }
  }

  stopAll() {
    for (const entry of this.active.values()) entry.stop();
    this.active.clear();
  }

  size(): number {
    return this.active.size;
  }
}

export const sseManager = new SseManager();
