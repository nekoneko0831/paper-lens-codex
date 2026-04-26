import { Paper, PaperDetail, Mode } from "./types";

export const BACKEND_BASE =
  typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_BACKEND_URL ?? "")
    : "";

function url(path: string): string {
  return `${BACKEND_BASE}${path}`;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url(path), init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, `${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export const api = {
  async listPapers(): Promise<{ papers: Paper[] }> {
    return jsonFetch("/api/papers");
  },

  async getPaperDetail(name: string): Promise<PaperDetail> {
    return jsonFetch(`/api/paper/${encodeURIComponent(name)}`);
  },

  async uploadPdf(file: File, name = ""): Promise<{ paper_name: string; pdf_path: string }> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", name);
    return jsonFetch("/api/upload", { method: "POST", body: fd });
  },

  async downloadPdf(paperName: string, url: string): Promise<{ ok: boolean; path: string; size: number }> {
    const fd = new FormData();
    fd.append("paper_name", paperName);
    fd.append("url", url);
    return jsonFetch("/api/download-pdf", { method: "POST", body: fd });
  },

  async renamePaper(oldName: string, newName: string) {
    const fd = new FormData();
    fd.append("old_name", oldName);
    fd.append("new_name", newName);
    return jsonFetch<{ ok: boolean; old_name: string; new_name: string }>("/api/rename-paper", {
      method: "POST",
      body: fd,
    });
  },

  async getFileContent(paperName: string, filePath: string): Promise<{ content: string; path: string }> {
    return jsonFetch(`/api/file-content/${encodeURIComponent(paperName)}/${filePath}`);
  },

  fileUrl(paperName: string, filePath: string): string {
    return url(`/api/files/${encodeURIComponent(paperName)}/${filePath}`);
  },

  async startSession(
    paperName: string,
    mode: Mode,
    opts: { pdf_url?: string; message?: string } = {}
  ): Promise<{ session_id: string }> {
    const fd = new FormData();
    fd.append("paper_name", paperName);
    fd.append("mode", mode);
    fd.append("pdf_url", opts.pdf_url ?? "");
    fd.append("message", opts.message ?? "");
    return jsonFetch("/api/start-session", { method: "POST", body: fd });
  },

  async sendMessage(sessionId: string, text: string) {
    return jsonFetch<{ ok: boolean }>(`/api/answer/${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "message", text }),
    });
  },

  async sendAnswer(sessionId: string, answers: Record<string, string | string[]>) {
    return jsonFetch<{ ok: boolean }>(`/api/answer/${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "answer", data: answers }),
    });
  },

  async openExternal(paperName: string, fileName: string, target: "finder" | "ide") {
    const fd = new FormData();
    fd.append("paper_name", paperName);
    fd.append("file_name", fileName);
    fd.append("target", target);
    return jsonFetch<{ ok: boolean }>("/api/open-external", { method: "POST", body: fd });
  },

  async saveFile(paperName: string, fileName: string, content: string) {
    const fd = new FormData();
    fd.append("paper_name", paperName);
    fd.append("file_name", fileName);
    fd.append("content", content);
    return jsonFetch<{ ok: boolean; path: string; size: number }>("/api/save-file", {
      method: "POST",
      body: fd,
    });
  },
};
