"""Paper-Lens-Codex Backend — FastAPI API server (serves paper-lens-codex-web).

Differences from the Claude paper-lens backend:
  * Uses CodexAppServerAdapter (drives ``codex app-server`` over JSON-RPC)
    instead of SdkUrlAdapter.
  * Default HTTP port is 8766 (paper-lens uses 8765) so both backends can
    coexist on one machine.
  * No /ws/cli/{session_id} endpoint — codex inverts the topology
    (the codex app-server listens, our adapter is the WS client).
"""
from __future__ import annotations

import asyncio
from collections import deque
import json
import logging
import os
import shutil
import time
from dataclasses import asdict
from pathlib import Path
from typing import Optional
from uuid import uuid4

from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form, HTTPException, Body
from fastapi.responses import FileResponse, StreamingResponse
import uvicorn

from adapters import CodexAppServerAdapter, SessionEvent
from adapters.base import EventType, QuestionData

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
logger = logging.getLogger("paper-lens-codex-backend")

# Paths
BASE_DIR = Path(__file__).parent
PROJECT_DIR = BASE_DIR.parent  # The main project directory
PAPER_NOTES_DIR = PROJECT_DIR / "paper-notes"
CODEX_WORKSPACE_LINK = Path(os.environ.get("PAPER_LENS_CODEX_WORKSPACE", "/private/tmp/paper-lens-codex-workspace"))

# Server port — resolved once at startup
SERVER_PORT = int(os.environ.get("PORT", 8766))

# Active sessions: session_id -> (adapter, last_activity_timestamp)
sessions: dict[str, tuple[CodexAppServerAdapter, float]] = {}
hubs: dict[str, "SessionEventHub"] = {}


class SessionEventHub:
    """Fan one adapter event stream out to multiple SSE subscribers.

    The adapter exposes a single async queue. If every EventSource connection
    consumed it directly, refreshes, reconnects, curl probes, or multiple tabs
    would race each other and one subscriber could steal events from another.
    This hub is the only adapter.events() consumer and broadcasts each event to
    per-subscriber queues.
    """

    def __init__(self, session_id: str, adapter: CodexAppServerAdapter):
        self.session_id = session_id
        self.adapter = adapter
        self.subscribers: set[asyncio.Queue[SessionEvent]] = set()
        self.history: deque[SessionEvent] = deque(maxlen=500)
        self.task: asyncio.Task | None = None
        self.closed = False

    def start(self) -> None:
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._pump())

    async def stop(self) -> None:
        self.closed = True
        if self.task and not self.task.done():
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        for q in list(self.subscribers):
            await q.put(SessionEvent(type=EventType.DONE))
        self.subscribers.clear()

    async def subscribe(self) -> asyncio.Queue[SessionEvent]:
        q: asyncio.Queue[SessionEvent] = asyncio.Queue(maxsize=1000)
        for event in self.history:
            await q.put(event)
        self.subscribers.add(q)
        self.adapter._subscribers = len(self.subscribers)
        logger.info(
            "SSE subscriber attached: session=%s subscribers=%s replay=%s",
            self.session_id, len(self.subscribers), len(self.history),
        )
        return q

    def unsubscribe(self, q: asyncio.Queue[SessionEvent]) -> None:
        self.subscribers.discard(q)
        self.adapter._subscribers = len(self.subscribers)
        logger.info(
            "SSE subscriber detached: session=%s subscribers=%s",
            self.session_id, len(self.subscribers),
        )

    async def _pump(self) -> None:
        logger.info("event pump started: session=%s", self.session_id)
        try:
            async for event in self.adapter.events():
                self.history.append(event)
                if self.session_id in sessions:
                    sessions[self.session_id] = (self.adapter, time.time())
                await self._broadcast(event)
                if event.type in (EventType.DONE, EventType.ERROR):
                    self.closed = True
                    break
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.exception("event pump crashed: session=%s error=%s", self.session_id, e)
            await self._broadcast(SessionEvent(type=EventType.ERROR, data=str(e)))
        finally:
            logger.info("event pump stopped: session=%s", self.session_id)

    async def _broadcast(self, event: SessionEvent) -> None:
        msg = _event_to_sse_data(event)
        logger.info(
            "event broadcast: session=%s type=%s subscribers=%s payload=%s",
            self.session_id, event.type, len(self.subscribers),
            _event_payload_preview(msg),
        )
        dead: list[asyncio.Queue[SessionEvent]] = []
        for q in list(self.subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("dropping slow SSE subscriber: session=%s", self.session_id)
                dead.append(q)
        for q in dead:
            self.unsubscribe(q)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    for sid, hub in list(hubs.items()):
        try:
            await hub.stop()
        except Exception as e:
            logger.warning("Error stopping event hub %s: %s", sid, e)
    for sid, (adapter, _) in list(sessions.items()):
        try:
            await adapter.stop()
        except Exception as e:
            logger.warning("Error stopping session %s: %s", sid, e)


app = FastAPI(title="Paper-Lens-Codex Backend", lifespan=lifespan)

# CORS for Next.js frontend (paper-lens-codex-web on port 3001)
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://127.0.0.1:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.get("/")
async def root():
    return {"service": "paper-lens-codex-backend", "frontend": "http://localhost:3001"}


# ── Paper management endpoints ────────────────────────────────────────

@app.get("/api/papers")
async def list_papers():
    """List existing paper-notes directories."""
    if not PAPER_NOTES_DIR.exists():
        return {"papers": []}

    papers = []
    for d in PAPER_NOTES_DIR.iterdir():
        if d.is_dir() and not d.name.startswith(".") and not d.name.startswith("__"):
            files = [f.name for f in d.iterdir() if f.is_file()]
            html_files = [f for f in files if f.endswith('.html')]
            # Viewable note files: analysis outputs (.md), excluding raw/utility files
            _exclude_md = {'extracted-text.md', 'README.md', 'readme.md', 'download-summary.md'}
            note_files = sorted(
                [f for f in files if f.endswith('.md') and f not in _exclude_md],
                key=lambda f: (
                    0 if f.startswith('speed-read') else
                    1 if f.startswith('paper-reading') else
                    2 if f.startswith('deep-learn') else
                    3 if f.startswith('slides-content') else 4,
                    f,
                ),
            )
            # Get most recent modification time from any file in the directory
            mtime = max(
                (f.stat().st_mtime for f in d.iterdir() if f.is_file()),
                default=d.stat().st_mtime,
            )
            papers.append({
                "name": d.name,
                "files": files,
                "note_files": note_files,
                "html_files": html_files,
                "has_speed_read": any(f.startswith('speed-read') and f.endswith('.md') for f in files),
                "has_paper_reading": any(f.startswith('paper-reading') and f.endswith('.md') for f in files),
                "has_deep_learn": any(f.startswith('deep-learn') and f.endswith('.md') for f in files),
                "has_slides": any(f.startswith('slides-content') and f.endswith('.md') for f in files),
                "has_presentation": len(html_files) > 0,
                "presentation_file": html_files[0] if html_files else None,
                "has_pdf": any(f.endswith('.pdf') for f in files),
                "pdf_file": next((f for f in files if f.endswith('.pdf')), None),
                "mtime": mtime,
            })
    # Sort by modification time, most recent first
    papers.sort(key=lambda p: p["mtime"], reverse=True)
    return {"papers": papers}


@app.get("/api/paper/{paper_name}")
async def get_paper_detail(paper_name: str):
    """Get detailed file info for a paper (with metadata for preview loading)."""
    paper_dir = (PAPER_NOTES_DIR / paper_name).resolve()
    if not str(paper_dir).startswith(str(PAPER_NOTES_DIR.resolve())):
        raise HTTPException(403, "Access denied")
    if not paper_dir.exists() or not paper_dir.is_dir():
        raise HTTPException(404, "Paper not found")

    files = []
    for f in sorted(paper_dir.iterdir()):
        if f.is_file() and not f.name.startswith("."):
            stat = f.stat()
            files.append({
                "name": f.name,
                "size": stat.st_size,
                "mtime": stat.st_mtime,
                "is_markdown": f.suffix == ".md",
                "is_html": f.suffix == ".html",
                "is_pdf": f.suffix == ".pdf",
            })

    # Also list subdirectories (images/, figures/)
    subdirs = [d.name for d in paper_dir.iterdir() if d.is_dir() and not d.name.startswith(".")]

    return {
        "name": paper_name,
        "files": sorted(files, key=lambda x: -x["mtime"]),
        "subdirs": subdirs,
    }


@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...), name: str = Form("")):
    """Upload a PDF and save to paper-notes directory."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Please upload a PDF file")

    # Derive paper name from filename if not provided
    paper_name = name.strip() or file.filename.rsplit(".", 1)[0]
    paper_name = paper_name.lower().replace(" ", "-").replace("_", "-")

    paper_dir = PAPER_NOTES_DIR / paper_name
    paper_dir.mkdir(parents=True, exist_ok=True)
    (paper_dir / "images").mkdir(exist_ok=True)

    pdf_path = paper_dir / "paper.pdf"
    content = await file.read()
    pdf_path.write_bytes(content)

    return {"paper_name": paper_name, "pdf_path": str(pdf_path)}


@app.post("/api/rename-paper")
async def rename_paper(old_name: str = Form(...), new_name: str = Form(...)):
    """Rename a paper directory."""
    import re

    # Sanitize new name
    new_name = new_name.strip().lower()
    new_name = re.sub(r'[^a-z0-9\u4e00-\u9fff\-]', '-', new_name)
    new_name = re.sub(r'-+', '-', new_name).strip('-')

    if not new_name:
        raise HTTPException(400, "Invalid name")

    old_dir = (PAPER_NOTES_DIR / old_name).resolve()
    new_dir = (PAPER_NOTES_DIR / new_name).resolve()

    if not str(old_dir).startswith(str(PAPER_NOTES_DIR.resolve())):
        raise HTTPException(403, "Access denied")
    if not old_dir.exists():
        raise HTTPException(404, "Paper not found")
    if new_dir.exists():
        raise HTTPException(409, f"'{new_name}' already exists")

    old_dir.rename(new_dir)
    return {"ok": True, "old_name": old_name, "new_name": new_name}


@app.post("/api/download-pdf")
async def download_pdf(paper_name: str = Form(...), url: str = Form(...)):
    """Download a PDF from URL (supports arXiv abs/pdf URLs)."""
    import subprocess

    # Normalize arXiv URLs
    download_url = url.strip()
    if 'arxiv.org/abs/' in download_url:
        download_url = download_url.replace('/abs/', '/pdf/')
    if 'arxiv.org/pdf/' in download_url and not download_url.endswith('.pdf'):
        download_url += '.pdf'

    # Validate URL
    if not download_url.startswith('http'):
        raise HTTPException(400, "Invalid URL")

    # Create paper directory
    paper_dir = PAPER_NOTES_DIR / paper_name
    paper_dir.mkdir(parents=True, exist_ok=True)
    (paper_dir / "images").mkdir(exist_ok=True)

    pdf_path = paper_dir / "paper.pdf"

    # Download using curl (follows redirects, handles HTTPS)
    result = subprocess.run(
        ["curl", "-L", "-f", "-o", str(pdf_path), download_url],
        capture_output=True, text=True, timeout=60,
    )

    if result.returncode != 0:
        raise HTTPException(400, f"Download failed: {result.stderr[:200]}")

    # Verify it's actually a PDF
    if pdf_path.exists() and pdf_path.stat().st_size > 0:
        with open(pdf_path, 'rb') as f:
            header = f.read(5)
        if header != b'%PDF-':
            pdf_path.unlink()
            raise HTTPException(400, "Downloaded file is not a valid PDF")
    else:
        raise HTTPException(400, "Download produced empty file")

    return {"ok": True, "path": str(pdf_path), "size": pdf_path.stat().st_size}


@app.post("/api/open-external")
async def open_external(paper_name: str = Form(...), file_name: str = Form(""), target: str = Form("finder")):
    """Open a file externally (Finder or IDE).

    An empty `file_name` reveals the paper's directory itself in Finder —
    useful for the "show this paper's folder" button in the preview header.
    """
    # Empty file_name → open the paper directory
    if file_name:
        target_path = (PAPER_NOTES_DIR / paper_name / file_name).resolve()
    else:
        target_path = (PAPER_NOTES_DIR / paper_name).resolve()

    if not str(target_path).startswith(str(PAPER_NOTES_DIR.resolve())):
        raise HTTPException(403, "Access denied")
    if not target_path.exists():
        raise HTTPException(404, "Not found")

    import subprocess
    if target == "finder":
        if target_path.is_dir():
            # Open the directory itself in Finder
            subprocess.Popen(["open", str(target_path)])
        else:
            # Reveal the file in Finder (macOS)
            subprocess.Popen(["open", "-R", str(target_path)])
    elif target == "ide":
        try:
            subprocess.Popen(["code", str(target_path)])
        except FileNotFoundError:
            subprocess.Popen(["open", str(target_path)])

    return {"ok": True, "path": str(target_path)}


@app.post("/api/save-file")
async def save_file(
    paper_name: str = Form(...),
    file_name: str = Form(...),
    content: str = Form(""),
):
    """Save user-authored markdown content to paper-notes/<paper>/<file>.

    Restrictions:
    - Only `.md` files may be created/overwritten.
    - Path must resolve inside the target paper directory.
    - Refuses to overwrite canonical output files like `paper.pdf`,
      `extracted-text.md`, `speed-read.md`, `deep-learn.md`,
      `paper-reading.md`, `slides-content.md`.
    """
    import re as _re

    # Sanitize file name: only allow basenames with .md extension
    file_name = file_name.strip()
    if not file_name.endswith(".md"):
        raise HTTPException(400, "Only .md files are allowed")
    if "/" in file_name or "\\" in file_name:
        raise HTTPException(400, "Nested paths not allowed")
    if not _re.match(r"^[\w\u4e00-\u9fff.\- ]+\.md$", file_name):
        raise HTTPException(400, "Invalid file name")

    paper_dir = (PAPER_NOTES_DIR / paper_name).resolve()
    if not str(paper_dir).startswith(str(PAPER_NOTES_DIR.resolve())):
        raise HTTPException(403, "Access denied")
    if not paper_dir.exists() or not paper_dir.is_dir():
        raise HTTPException(404, "Paper not found")

    target = (paper_dir / file_name).resolve()
    if not str(target).startswith(str(paper_dir)):
        raise HTTPException(403, "Access denied")

    # Protect canonical outputs
    RESERVED = {
        "extracted-text.md",
        "speed-read.md",
        "paper-reading.md",
        "deep-learn.md",
        "slides-content.md",
    }
    if file_name in RESERVED:
        raise HTTPException(400, f"'{file_name}' is reserved; choose a different name")

    target.write_text(content, encoding="utf-8")
    return {"ok": True, "path": str(target), "size": target.stat().st_size}


@app.get("/api/files/{paper_name}/{file_path:path}")
async def get_file(paper_name: str, file_path: str):
    """Serve files from paper-notes (markdown, images, HTML)."""
    # Security: resolve and check path is within paper-notes
    target = (PAPER_NOTES_DIR / paper_name / file_path).resolve()
    if not str(target).startswith(str(PAPER_NOTES_DIR.resolve())):
        raise HTTPException(403, "Access denied")
    if not target.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(str(target))


@app.get("/api/file-content/{paper_name}/{file_path:path}")
async def get_file_content(paper_name: str, file_path: str):
    """Get file content as text (for markdown preview)."""
    target = (PAPER_NOTES_DIR / paper_name / file_path).resolve()
    if not str(target).startswith(str(PAPER_NOTES_DIR.resolve())):
        raise HTTPException(403, "Access denied")
    if not target.exists():
        raise HTTPException(404, "File not found")
    try:
        content = target.read_text(encoding="utf-8")
        return {"content": content, "path": str(file_path)}
    except UnicodeDecodeError:
        raise HTTPException(400, "Not a text file")


# ── Session management ────────────────────────────────────────────────

@app.post("/api/start-session")
async def start_session(
    paper_name: str = Form(...),
    mode: str = Form("speed-read"),
    pdf_url: str = Form(""),
    message: Optional[str] = Form(""),
):
    """Start a new paper-lens-codex session.

    Spawns ``codex app-server`` and connects the adapter to it; returns a
    backend-side session id that the frontend uses for SSE + answer
    endpoints.
    """
    # Backup existing output files before creating new ones
    if mode != "chat":
        _backup_if_exists(paper_name, mode)

    # Build the prompt for paper-lens skill
    prompt = _build_prompt(paper_name, mode, pdf_url, message)

    adapter = CodexAppServerAdapter(working_dir=str(_codex_working_dir()))
    session_id = await adapter.start(prompt)

    sessions[session_id] = (adapter, time.time())
    hub = SessionEventHub(session_id, adapter)
    hubs[session_id] = hub
    hub.start()
    return {"session_id": session_id}


# NOTE: /api/resume-session was a Claude-only feature in paper-lens, where it
# attached the adapter to a saved claude_session_id so the CLI could
# `--resume` the previous conversation. The codex equivalent is
# `thread/resume`, but the UI uses a different identifier (codex thread id
# vs. claude session id) and the frontend doesn't currently track it.
# Not exposed in v0.1; revisit when the UI adds a "continue this thread"
# affordance keyed on codex thread id.


# ── SSE streaming endpoint (replaces browser WebSocket) ───────────────

@app.get("/api/stream/{session_id}")
async def sse_stream(session_id: str):
    """Server-Sent Events endpoint for browser to receive session events."""
    entry = sessions.get(session_id)
    if not entry:
        raise HTTPException(404, "Session not found")

    adapter, _ = entry
    # Update last active
    sessions[session_id] = (adapter, time.time())
    hub = hubs.get(session_id)
    if hub is None:
        hub = SessionEventHub(session_id, adapter)
        hubs[session_id] = hub
        hub.start()

    async def event_generator():
        subscriber = await hub.subscribe()
        try:
            while True:
                event = await subscriber.get()
                msg = _event_to_sse_data(event)
                if msg is not None:
                    yield f"data: {json.dumps(msg, ensure_ascii=False)}\n\n"
                if event.type in (EventType.DONE, EventType.ERROR):
                    break
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"SSE error for {session_id}: {e}")
            yield f"data: {json.dumps({'type': 'error', 'data': str(e)})}\n\n"
        finally:
            hub.unsubscribe(subscriber)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/answer/{session_id}")
async def post_answer(session_id: str, payload: dict = Body(...)):
    """Receive user answer or message from the browser."""
    entry = sessions.get(session_id)
    if not entry:
        raise HTTPException(404, "Session not found")

    adapter, _ = entry
    sessions[session_id] = (adapter, time.time())

    msg_type = payload.get("type", "message")

    try:
        if msg_type == "answer":
            data = payload.get("data") or {}
            # Codex's item/tool/requestUserInput expects a structured map
            # {question_id: {answers: [...]}}, so pass the raw dict
            # straight through to the adapter rather than collapsing it
            # into a text blob.
            normalized: dict[str, list[str]] = {}
            for key, value in data.items():
                if isinstance(value, list):
                    normalized[key] = [str(v) for v in value]
                elif value is None:
                    normalized[key] = []
                else:
                    normalized[key] = [str(value)]

            resolved = False
            try:
                resolved = await adapter.answer_question_structured(normalized)
            except Exception as e:
                logger.warning(f"answer_question_structured failed: {e}")
            if not resolved:
                # No parked requestUserInput — treat the answer as a
                # free-form follow-up message instead, so the user's
                # input doesn't disappear into the void.
                await adapter.send_message(_format_answer(data))
        elif msg_type == "message":
            text = payload.get("text", "")
            if text:
                await adapter.send_message(text)
        else:
            raise HTTPException(400, f"Unknown message type: {msg_type}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error sending message: {e}")
        raise HTTPException(500, f"发送失败: {e}")

    return {"ok": True}


# NOTE: paper-lens (Claude version) had a /ws/cli/{session_id} endpoint
# where the spawned `claude --sdk-url` subprocess connected back to us.
# Codex inverts that direction: `codex app-server --listen ws://...` is
# the WS host, and our adapter is the WS client. There is no inbound
# WebSocket from CLI to backend, so no endpoint here.


# ── Helpers (unchanged) ───────────────────────────────────────────────

def _backup_if_exists(paper_name: str, mode: str) -> None:
    """Rename existing output file with version number before creating a new one.

    e.g., deep-learn.md -> deep-learn-v1.md (if first backup)
          deep-learn.md -> deep-learn-v3.md (if v1, v2 already exist)
    """
    mode_files = {
        "speed-read": "speed-read.md",
        "paper-reading": "paper-reading.md",
        "deep-learn": "deep-learn.md",
        "present": "slides-content.md",
    }
    base_name = mode_files.get(mode)
    if not base_name:
        return

    paper_dir = PAPER_NOTES_DIR / paper_name
    target = paper_dir / base_name
    if not target.exists():
        return

    stem = base_name.rsplit(".", 1)[0]  # e.g., 'deep-learn'

    # Find highest existing version number
    max_v = 0
    for f in paper_dir.glob(f"{stem}-v*.md"):
        try:
            v = int(f.stem.split("-v")[-1])
            max_v = max(max_v, v)
        except ValueError:
            pass

    next_v = max_v + 1
    versioned = paper_dir / f"{stem}-v{next_v}.md"
    target.rename(versioned)
    logger.info(f"Backed up {target.name} -> {versioned.name}")


def _codex_working_dir() -> Path:
    """Return an ASCII-only cwd for codex app-server.

    Codex 0.125.0 emits the workspace path inside an HTTP metadata header.
    Non-ASCII cwd paths can make that header fail UTF-8 conversion mid-stream,
    so we enter the project through an ASCII symlink while all files still
    resolve back to PROJECT_DIR.
    """
    try:
        if CODEX_WORKSPACE_LINK.exists() or CODEX_WORKSPACE_LINK.is_symlink():
            if CODEX_WORKSPACE_LINK.resolve() == PROJECT_DIR.resolve():
                return CODEX_WORKSPACE_LINK
            logger.warning(
                "Configured Codex workspace link points elsewhere: %s",
                CODEX_WORKSPACE_LINK,
            )
            return PROJECT_DIR
        CODEX_WORKSPACE_LINK.symlink_to(PROJECT_DIR, target_is_directory=True)
        return CODEX_WORKSPACE_LINK
    except Exception as e:
        logger.warning("Could not create ASCII Codex workspace symlink: %s", e)
        return PROJECT_DIR


def _build_prompt(paper_name: str, mode: str, pdf_url: str, message: str = "") -> str:
    """Build the initial prompt for paper-lens skill."""
    if mode == "chat":
        # Free chat about a paper — don't invoke skill, just provide context
        paper_dir = PAPER_NOTES_DIR / paper_name
        notes = []
        for f in sorted(paper_dir.glob("*.md")):
            if f.name not in ("extracted-text.md", "README.md", "download-summary.md"):
                notes.append(f.name)
        context = f"用户正在查看论文 paper-notes/{paper_name}/。"
        if notes:
            context += f" 已有笔记：{', '.join(notes)}。请先读取相关笔记了解论文内容，然后回答用户的问题。"
        else:
            context += " 请根据论文内容回答用户的问题。"
        if message:
            context += f"\n\n用户的问题：{message}"
        return context

    mode_map = {
        "speed-read": "速览模式",
        "paper-reading": "论文级精读文档",
        "deep-learn": "学习模式",
        "present": "展示模式",
    }
    mode_text = mode_map.get(mode, "速览模式")

    if pdf_url:
        source = pdf_url
    else:
        # Find actual PDF file (may not be named paper.pdf)
        paper_dir = PAPER_NOTES_DIR / paper_name
        pdf_files = list(paper_dir.glob("*.pdf")) if paper_dir.exists() else []
        if pdf_files:
            source = f"paper-notes/{paper_name}/{pdf_files[0].name}"
        else:
            source = paper_name

    return (
        f"/paper-lens {source}\n选择：{mode_text}\n\n"
        "[Paper Lens Codex Web UI 约束]\n"
        "- 当前运行在 paper-lens-codex Web UI 中。需要向用户收集选择时，"
        "不要使用 request_user_input。请输出一个隐藏结构化问题块，格式必须严格为：\n"
        "```paper_lens_question\n"
        "{\"questions\":[{\"id\":\"focus\",\"header\":\"选择阅读重点\",\"question\":\"你想优先看哪部分？\","
        "\"options\":[{\"label\":\"核心贡献\",\"description\":\"先理解论文解决了什么问题\"}],"
        "\"multiSelect\":true}]}\n"
        "```\n"
        "输出问题块后立即停止本轮正文，等待用户回答；不要把选择题只写成普通 Markdown。\n"
        "- 每个 question 需要包含 id、header、question、options；options 使用 "
        "{label, description}。需要多选时在问题文字中写明“可多选”，Web UI 会以数组形式回传答案。\n"
        "- 输出文件统一写入当前项目的 paper-notes/<paper-name>/ 目录。"
    )


def _format_answer(answer_data) -> str:
    """Format browser answer into text for fallback chat turns."""
    if isinstance(answer_data, str):
        return answer_data or "继续"
    if isinstance(answer_data, dict):
        parts = []
        for question, selections in answer_data.items():
            if isinstance(selections, list):
                parts.append(f"{question}: {', '.join(selections)}")
            else:
                parts.append(f"{question}: {selections}")
        return "\n".join(parts) if parts else "继续"
    return str(answer_data) or "继续"


def _event_to_sse_data(event: SessionEvent) -> dict | None:
    """Convert a SessionEvent to an SSE-compatible JSON dict."""
    if event.type == EventType.TEXT_DELTA:
        return {"type": "text_delta", "content": event.data}

    elif event.type == EventType.THINKING_DELTA:
        return {"type": "thinking_delta", "content": event.data}

    elif event.type == EventType.QUESTION:
        qd: QuestionData = event.data
        return {
            "type": "question",
            "questions": qd.questions,
        }

    elif event.type == EventType.FILE_SAVED:
        return {"type": "file_saved", "data": event.data}

    elif event.type == EventType.TOOL_USE:
        return {"type": "tool_use", "data": event.data}

    elif event.type == EventType.TOOL_RESULT:
        return {"type": "tool_result", "data": event.data}

    elif event.type == EventType.USAGE:
        return {"type": "usage", "data": event.data}

    elif event.type == EventType.STATUS:
        return {"type": "status", "data": event.data}

    elif event.type == EventType.ERROR:
        return {"type": "error", "data": event.data}

    elif event.type == EventType.TURN_DONE:
        return {"type": "turn_done", "data": event.data}

    elif event.type == EventType.DONE:
        return {"type": "done"}

    return None


def _event_payload_preview(msg: dict | None) -> str:
    if msg is None:
        return "null"
    try:
        text = json.dumps(msg, ensure_ascii=False)
    except Exception:
        text = str(msg)
    return text[:180].replace("\n", "\\n")


def main():
    global SERVER_PORT
    SERVER_PORT = int(os.environ.get("PORT", 8766))
    print(f"\n  Paper-Lens-Codex backend")
    print(f"  http://localhost:{SERVER_PORT}")
    print(f"  Frontend (paper-lens-codex-web): http://localhost:3001\n")
    uvicorn.run(app, host="0.0.0.0", port=SERVER_PORT, log_level="info")


if __name__ == "__main__":
    main()
