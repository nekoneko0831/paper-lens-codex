export type Mode = "speed-read" | "deep-learn" | "present" | "chat";

export interface Paper {
  name: string;
  files: string[];
  has_pdf: boolean;
  has_speed_read: boolean;
  has_deep_learn: boolean;
  has_slides: boolean;
}

export interface PaperFile {
  name: string;
  size: number;
  mtime: number;
  is_markdown: boolean;
  is_html: boolean;
  is_pdf: boolean;
}

export interface PaperDetail {
  name: string;
  files: PaperFile[];
  subdirs: string[];
}

export interface QuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export interface Question {
  id?: string;
  question: string;
  header: string;
  options?: QuestionOption[] | null;
  multiSelect?: boolean;
  isOther?: boolean;
  isSecret?: boolean;
}

/* ---------- SSE event shapes from server.py ---------- */
export type SSEEvent =
  | { type: "text_delta"; content: string }
  | { type: "question"; questions: Question[] }
  | { type: "file_saved"; data: { path: string; tool: string } }
  | { type: "tool_use"; data: { tool: string; input?: Record<string, unknown>; id?: string } }
  | { type: "tool_result"; data: { id?: string; content: string; is_error?: boolean } }
  | { type: "thinking_delta"; content: string }
  | { type: "usage"; data: { input_tokens: number; output_tokens: number } }
  | { type: "status"; data: { status: string; [k: string]: unknown } }
  | { type: "error"; data: string }
  | { type: "turn_done"; data: { result_preview?: string; cost_usd?: number } }
  | { type: "done" };

/* ---------- Internal message models ---------- */
export type MessageKind =
  | "user"
  | "assistant-text"
  | "thinking"
  | "tool"
  | "question"
  | "file-saved"
  | "error";

export interface BaseMessage {
  id: string;
  kind: MessageKind;
  createdAt: number;
}

export interface UserMessage extends BaseMessage {
  kind: "user";
  text: string;
}

export interface AssistantTextMessage extends BaseMessage {
  kind: "assistant-text";
  text: string;
  streaming: boolean;
}

export interface ThinkingMessage extends BaseMessage {
  kind: "thinking";
  text: string;
  streaming: boolean;
}

export interface ToolMessage extends BaseMessage {
  kind: "tool";
  toolName: string;
  toolId?: string;
  input?: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  status: "running" | "success" | "error";
  startedAt: number;
  endedAt?: number;
}

export interface QuestionMessage extends BaseMessage {
  kind: "question";
  questions: Question[];
  answered: boolean;
}

export interface FileSavedMessage extends BaseMessage {
  kind: "file-saved";
  path: string;
  tool: string;
}

export interface ErrorMessage extends BaseMessage {
  kind: "error";
  text: string;
}

export type Message =
  | UserMessage
  | AssistantTextMessage
  | ThinkingMessage
  | ToolMessage
  | QuestionMessage
  | FileSavedMessage
  | ErrorMessage;

/* ---------- Plan tasks (parsed from TaskCreate/TaskUpdate tool calls) ---------- */
export interface PlanTask {
  id: string;
  subject: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  startedAt?: number;
  completedAt?: number;
}

/* ---------- Session status ---------- */
//  idle      — no session or never started
//  starting  — session created, waiting for first event
//  streaming — assistant is producing output right now
//  waiting   — assistant needs user input (question card or turn ended)
//  done      — session fully ended (CLI exit / stop)
//  error     — session failed
export type SessionStatus = "idle" | "starting" | "streaming" | "waiting" | "done" | "error";
