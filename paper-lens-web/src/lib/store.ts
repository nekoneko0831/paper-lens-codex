import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import {
  Message,
  Paper,
  PaperDetail,
  PlanTask,
  SessionStatus,
  SSEEvent,
  AssistantTextMessage,
  ThinkingMessage,
  ToolMessage,
} from "./types";

/* ------------------------------------------------------------------
 * Multi-session architecture (v3 → round 5)
 *
 * Each paper gets its own ActiveSession. The store holds
 * `sessions: Record<paperName, ActiveSession>` so the user can run several
 * papers in parallel (e.g. start a present mode on paper A, switch to
 * paper B and run speed-read, come back to A and see its progress).
 *
 * `currentPaper` determines which session is shown in the UI. Events
 * routed via `handleEvent(paper, ev)` update the target session regardless
 * of which paper is currently in view, so background papers keep streaming.
 * ------------------------------------------------------------------ */

let msgCounter = 0;
function nextId(prefix = "m") {
  msgCounter += 1;
  return `${prefix}-${Date.now()}-${msgCounter}`;
}

export interface ActiveSession {
  sessionId: string | null;
  sessionStatus: SessionStatus;
  sessionStartedAt: number | null;
  sessionEndedAt: number | null;
  messages: Message[];
  tasks: PlanTask[];
  inputTokens: number;
  outputTokens: number;
  currentAssistantId: string | null;
  currentThinkingId: string | null;
  toolByRunningId: Record<string, string>;
}

export const emptySession = (): ActiveSession => ({
  sessionId: null,
  sessionStatus: "idle",
  sessionStartedAt: null,
  sessionEndedAt: null,
  messages: [],
  tasks: [],
  inputTokens: 0,
  outputTokens: 0,
  currentAssistantId: null,
  currentThinkingId: null,
  toolByRunningId: {},
});

interface StoreState {
  // papers
  papers: Paper[];
  currentPaper: string | null;
  currentDetail: PaperDetail | null;

  // Per-paper sessions
  sessions: Record<string, ActiveSession>;

  // preview panel
  previewOpen: boolean;
  previewPaper: string | null;
  previewTabs: string[];
  activeTab: string | null;
  splitTab: string | null;
  sidebarCollapsed: boolean;

  // actions
  setPapers: (p: Paper[]) => void;
  setCurrentPaper: (name: string | null) => void;
  setCurrentDetail: (d: PaperDetail | null) => void;

  // Session mutators — always operate on a specific paper
  startSession: (paper: string, sessionId: string) => void;
  endSession: (paper: string) => void;
  resetSession: (paper: string) => void;
  clearCurrentPaperSession: () => void;
  clearAllHistory: () => void;

  pushUserMessage: (paper: string, text: string) => void;
  handleEvent: (paper: string, ev: SSEEvent) => void;
  answerQuestion: (paper: string, msgId: string) => void;

  // UI
  togglePreview: () => void;
  openPreview: (paperName: string) => void;
  closePreview: () => void;
  setActiveTab: (file: string) => void;
  setPreviewTabs: (tabs: string[]) => void;
  setSplitTab: (file: string | null) => void;
  toggleSidebar: () => void;
}

const SKIP_TOOL_CARD = new Set([
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "TaskGet",
  "AskUserQuestion",
]);

/* Update one paper's session with a partial diff. */
function updateSession(
  sessions: Record<string, ActiveSession>,
  paper: string,
  patch: Partial<ActiveSession> | ((s: ActiveSession) => Partial<ActiveSession>)
): Record<string, ActiveSession> {
  const prev = sessions[paper] ?? emptySession();
  const delta = typeof patch === "function" ? patch(prev) : patch;
  return { ...sessions, [paper]: { ...prev, ...delta } };
}

export const useStore = create<StoreState>()(
  devtools(
    persist<StoreState>(
      (set, get) => ({
        papers: [],
        currentPaper: null,
        currentDetail: null,
        sessions: {},

        previewOpen: false,
        previewPaper: null,
        previewTabs: [],
        activeTab: null,
        splitTab: null,
        sidebarCollapsed: false,

        setPapers: (p) => set({ papers: p }),
        setCurrentPaper: (name) => set({ currentPaper: name }),
        setCurrentDetail: (d) => set({ currentDetail: d }),

        startSession: (paper, sessionId) =>
          set((st) => ({
            sessions: updateSession(st.sessions, paper, {
              sessionId,
              sessionStatus: "starting",
              sessionStartedAt: Date.now(),
              sessionEndedAt: null,
            }),
          })),

        endSession: (paper) =>
          set((st) => ({
            sessions: updateSession(st.sessions, paper, (s) => ({
              sessionStatus: s.sessionStatus === "error" ? "error" : "done",
              sessionEndedAt: Date.now(),
              currentAssistantId: null,
              currentThinkingId: null,
            })),
          })),

        resetSession: (paper) =>
          set((st) => ({
            sessions: { ...st.sessions, [paper]: emptySession() },
          })),

        clearCurrentPaperSession: () =>
          set((st) => {
            if (!st.currentPaper) return {};
            const { [st.currentPaper]: _, ...rest } = st.sessions;
            return { sessions: rest };
          }),

        clearAllHistory: () => {
          if (typeof window !== "undefined") {
            try {
              localStorage.removeItem("paper-lens-session-v3");
              localStorage.removeItem("paper-lens-session-v2");
              localStorage.removeItem("paper-lens-session-v1");
            } catch {}
          }
          set({
            sessions: {},
            currentPaper: null,
            previewOpen: false,
            previewPaper: null,
            previewTabs: [],
            activeTab: null,
            splitTab: null,
          });
        },

        pushUserMessage: (paper, text) =>
          set((st) => ({
            sessions: updateSession(st.sessions, paper, (s) => ({
              messages: [
                ...s.messages,
                { id: nextId("u"), kind: "user", text, createdAt: Date.now() },
              ],
              currentAssistantId: null,
              currentThinkingId: null,
              sessionStatus: "streaming",
              // Reset the per-turn timer when the user starts a new turn
              // after the session was waiting or done.
              sessionStartedAt:
                s.sessionStatus === "waiting" || s.sessionStatus === "done"
                  ? Date.now()
                  : s.sessionStartedAt,
              sessionEndedAt: null,
            })),
          })),

        handleEvent: (paper, ev) => {
          const st = get();
          const prev = st.sessions[paper] ?? emptySession();

          switch (ev.type) {
            case "text_delta": {
              if (!ev.content) return;
              set((s) => ({
                sessions: updateSession(s.sessions, paper, (cur) => {
                  if (cur.currentAssistantId) {
                    return {
                      messages: cur.messages.map((m) =>
                        m.id === cur.currentAssistantId && m.kind === "assistant-text"
                          ? { ...m, text: m.text + ev.content }
                          : m
                      ),
                      sessionStatus: "streaming",
                    };
                  }
                  const id = nextId("a");
                  const newMsg: AssistantTextMessage = {
                    id,
                    kind: "assistant-text",
                    text: ev.content,
                    streaming: true,
                    createdAt: Date.now(),
                  };
                  return {
                    messages: [...cur.messages, newMsg],
                    currentAssistantId: id,
                    currentThinkingId: null,
                    sessionStatus: "streaming",
                  };
                }),
              }));
              return;
            }

            case "thinking_delta": {
              if (!ev.content) return;
              set((s) => ({
                sessions: updateSession(s.sessions, paper, (cur) => {
                  if (cur.currentThinkingId) {
                    return {
                      messages: cur.messages.map((m) =>
                        m.id === cur.currentThinkingId && m.kind === "thinking"
                          ? { ...m, text: m.text + ev.content }
                          : m
                      ),
                    };
                  }
                  const id = nextId("t");
                  const msg: ThinkingMessage = {
                    id,
                    kind: "thinking",
                    text: ev.content,
                    streaming: true,
                    createdAt: Date.now(),
                  };
                  return {
                    messages: [...cur.messages, msg],
                    currentThinkingId: id,
                  };
                }),
              }));
              return;
            }

            case "tool_use": {
              const { tool, input, id: toolId } = ev.data;

              if (tool === "TaskCreate" && input) {
                const subject = (input.subject as string) ?? "(untitled task)";
                const description = input.description as string | undefined;
                set((s) => ({
                  sessions: updateSession(s.sessions, paper, (cur) => ({
                    tasks: [
                      ...cur.tasks,
                      {
                        id: `task-${cur.tasks.length + 1}`,
                        subject,
                        description,
                        status: "pending",
                      },
                    ],
                  })),
                }));
                return;
              }
              if (tool === "TaskUpdate" && input) {
                const taskId = input.taskId as string;
                const status = input.status as PlanTask["status"] | undefined;
                set((s) => ({
                  sessions: updateSession(s.sessions, paper, (cur) => ({
                    tasks: cur.tasks.map((t) =>
                      t.id === taskId && status
                        ? {
                            ...t,
                            status,
                            startedAt: status === "in_progress" ? Date.now() : t.startedAt,
                            completedAt: status === "completed" ? Date.now() : t.completedAt,
                          }
                        : t
                    ),
                  })),
                }));
                return;
              }

              if (SKIP_TOOL_CARD.has(tool)) return;

              // If this tool_use id already has a card, just update its input.
              if (toolId && prev.toolByRunningId[toolId]) {
                const existingId = prev.toolByRunningId[toolId];
                set((s) => ({
                  sessions: updateSession(s.sessions, paper, (cur) => ({
                    messages: cur.messages.map((m) =>
                      m.id === existingId && m.kind === "tool"
                        ? { ...m, input: input ?? m.input }
                        : m
                    ),
                  })),
                }));
                return;
              }

              const id = nextId("tool");
              const msg: ToolMessage = {
                id,
                kind: "tool",
                toolName: tool,
                toolId,
                input,
                status: "running",
                startedAt: Date.now(),
                createdAt: Date.now(),
              };
              set((s) => ({
                sessions: updateSession(s.sessions, paper, (cur) => ({
                  messages: [...cur.messages, msg],
                  currentAssistantId: null,
                  currentThinkingId: null,
                  toolByRunningId: toolId
                    ? { ...cur.toolByRunningId, [toolId]: id }
                    : cur.toolByRunningId,
                })),
              }));
              return;
            }

            case "tool_result": {
              const { id: toolId, content, is_error } = ev.data;
              if (!toolId) return;
              const msgId = prev.toolByRunningId[toolId];
              if (!msgId) return;
              set((s) => ({
                sessions: updateSession(s.sessions, paper, (cur) => ({
                  messages: cur.messages.map((m) =>
                    m.id === msgId && m.kind === "tool"
                      ? {
                          ...m,
                          status: is_error ? "error" : "success",
                          result: content,
                          isError: is_error,
                          endedAt: Date.now(),
                        }
                      : m
                  ),
                })),
              }));
              return;
            }

            case "file_saved": {
              const { path, tool } = ev.data;
              set((s) => ({
                sessions: updateSession(s.sessions, paper, (cur) => ({
                  messages: [
                    ...cur.messages,
                    {
                      id: nextId("f"),
                      kind: "file-saved",
                      path,
                      tool,
                      createdAt: Date.now(),
                    },
                  ],
                })),
              }));
              return;
            }

            case "question": {
              set((s) => ({
                sessions: updateSession(s.sessions, paper, (cur) => ({
                  messages: [
                    ...cur.messages,
                    {
                      id: nextId("q"),
                      kind: "question",
                      questions: ev.questions,
                      answered: false,
                      createdAt: Date.now(),
                    },
                  ],
                  sessionStatus: "waiting",
                  currentAssistantId: null,
                  currentThinkingId: null,
                })),
              }));
              maybeNotify({
                title: `Paper Lens · ${paper}`,
                body: ev.questions[0]?.question ?? "等待用户回复",
              });
              return;
            }

            case "usage": {
              set((s) => ({
                sessions: updateSession(s.sessions, paper, (cur) => ({
                  inputTokens: cur.inputTokens + (ev.data.input_tokens ?? 0),
                  outputTokens: cur.outputTokens + (ev.data.output_tokens ?? 0),
                })),
              }));
              return;
            }

            case "status":
              return;

            case "error": {
              set((s) => ({
                sessions: updateSession(s.sessions, paper, (cur) => ({
                  messages: [
                    ...cur.messages,
                    { id: nextId("e"), kind: "error", text: String(ev.data), createdAt: Date.now() },
                  ],
                  sessionStatus: "error",
                  sessionEndedAt: Date.now(),
                })),
              }));
              return;
            }

            case "turn_done": {
              set((s) => ({
                sessions: updateSession(s.sessions, paper, (cur) => ({
                  messages: cur.messages.map((m) =>
                    (m.kind === "assistant-text" || m.kind === "thinking") && m.streaming
                      ? { ...m, streaming: false }
                      : m
                  ),
                  sessionStatus: "waiting",
                  sessionEndedAt: Date.now(),
                  currentAssistantId: null,
                  currentThinkingId: null,
                })),
              }));
              maybeNotifyDone(paper);
              return;
            }

            case "done": {
              set((s) => ({
                sessions: updateSession(s.sessions, paper, (cur) => ({
                  messages: cur.messages.map((m) =>
                    (m.kind === "assistant-text" || m.kind === "thinking") && m.streaming
                      ? { ...m, streaming: false }
                      : m
                  ),
                  sessionStatus: "done",
                  sessionEndedAt: Date.now(),
                  currentAssistantId: null,
                  currentThinkingId: null,
                })),
              }));
              maybeNotifyDone(paper);
              return;
            }
          }
        },

        answerQuestion: (paper, msgId) =>
          set((s) => ({
            sessions: updateSession(s.sessions, paper, (cur) => ({
              messages: cur.messages.map((m) =>
                m.id === msgId && m.kind === "question" ? { ...m, answered: true } : m
              ),
              sessionStatus: "streaming",
            })),
          })),

        togglePreview: () =>
          set((s) => ({
            previewOpen: !s.previewOpen,
            previewPaper: !s.previewOpen ? s.currentPaper : s.previewPaper,
          })),

        openPreview: (paperName) =>
          set({ previewOpen: true, previewPaper: paperName }),

        closePreview: () => set({ previewOpen: false }),

        setActiveTab: (file) =>
          set((s) => ({
            activeTab: file,
            splitTab: s.splitTab === file ? null : s.splitTab,
          })),

        setPreviewTabs: (tabs) =>
          set((s) => ({
            previewTabs: tabs,
            activeTab: tabs.includes(s.activeTab ?? "") ? s.activeTab : tabs[0] ?? null,
            splitTab: tabs.includes(s.splitTab ?? "") ? s.splitTab : null,
          })),

        setSplitTab: (file) =>
          set((s) => ({
            splitTab: file === s.activeTab ? null : file,
          })),

        toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      }),
      {
        // v3: multi-session architecture
        name: "paper-lens-session-v3",
        version: 3,
        storage: createJSONStorage(() => {
          if (typeof window === "undefined") {
            return {
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
            };
          }
          return localStorage;
        }),
        partialize: (state) => {
          // Persist sessions but normalise in-flight statuses to "done"
          // so a refresh doesn't try to reconnect to a stream that has
          // already ended server-side.
          const normalisedSessions: Record<string, ActiveSession> = {};
          for (const [paper, s] of Object.entries(state.sessions)) {
            normalisedSessions[paper] = {
              ...s,
              sessionStatus:
                s.sessionStatus === "streaming" || s.sessionStatus === "starting"
                  ? "done"
                  : s.sessionStatus,
              messages: s.messages.map((m) =>
                (m.kind === "assistant-text" || m.kind === "thinking") && (m as { streaming?: boolean }).streaming
                  ? { ...m, streaming: false }
                  : m
              ) as Message[],
            };
          }
          return {
            currentPaper: state.currentPaper,
            sessions: normalisedSessions,
            previewOpen: state.previewOpen,
            previewPaper: state.previewPaper,
            activeTab: state.activeTab,
            splitTab: state.splitTab,
            sidebarCollapsed: state.sidebarCollapsed,
          } as StoreState;
        },
      }
    )
  )
);

/* ---------- Selector hooks ---------- */

// Stable singleton returned when no session exists — re-creating a fresh
// object every render would break Zustand's strict-equal reference check
// and cause infinite re-render loops.
const EMPTY_SESSION_SINGLETON: ActiveSession = Object.freeze(emptySession()) as ActiveSession;

export const useCurrentSession = (): ActiveSession => {
  return useStore((s) => {
    const p = s.currentPaper;
    return (p && s.sessions[p]) || EMPTY_SESSION_SINGLETON;
  });
};

/* ---------- Browser notification helper ---------- */
function maybeNotify(args: { title: string; body: string }) {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (!document.hidden) return;
  try {
    const n = new Notification(args.title, { body: args.body, icon: "/favicon.ico" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {}
}

function maybeNotifyDone(paper: string) {
  const s = useStore.getState().sessions[paper];
  if (!s || !s.sessionStartedAt) return;
  const elapsed = Date.now() - s.sessionStartedAt;
  if (elapsed < 10000) return;
  maybeNotify({
    title: `Paper Lens · ${paper} 完成`,
    body: `用时 ${formatElapsed(elapsed)}`,
  });
}

function formatElapsed(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m ${sec}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
