import { SSEEvent } from "./types";
import { BACKEND_BASE } from "./api";

/**
 * Stream session events using native EventSource.
 *
 * We prefer native EventSource over fetch-based libraries because the
 * Next.js Turbopack dev proxy buffers SSE responses for the browser
 * (curl shows chunks in real time, but the browser gets nothing through
 * the proxy). Direct backend connection via NEXT_PUBLIC_BACKEND_URL +
 * CORS works reliably in dev, and same-origin works in production.
 */
export function streamSession(
  sessionId: string,
  onEvent: (ev: SSEEvent) => void,
  onSessionExpired: () => void,
  onError: (err: unknown) => void
): () => void {
  const url = `${BACKEND_BASE}/api/stream/${sessionId}`;
  const es = new EventSource(url);
  let closed = false;

  es.onmessage = (ev) => {
    if (!ev.data) return;
    try {
      const parsed = JSON.parse(ev.data) as SSEEvent;
      onEvent(parsed);
      // Only close on explicit end-of-session. TURN_DONE keeps the stream
      // open so multi-turn conversations can continue without reconnecting.
      if (parsed.type === "done" || parsed.type === "error") {
        closed = true;
        es.close();
      }
    } catch (e) {
      console.error("SSE parse error", e, ev.data);
    }
  };

  es.onerror = () => {
    // EventSource auto-retries on transient failures. We only treat the
    // error as fatal when the connection is fully closed without ever
    // having received a message — that usually means the session id is
    // unknown to the backend (404) or the server restarted.
    if (es.readyState === EventSource.CLOSED) {
      if (!closed) {
        closed = true;
        onSessionExpired();
      } else {
        onError(new Error("SSE closed"));
      }
    }
  };

  return () => {
    closed = true;
    es.close();
  };
}
