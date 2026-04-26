"""Codex CLI app-server adapter for paper-lens-codex.

Backend topology vs. Claude version
-----------------------------------
Claude paper-lens spawns ``claude --sdk-url ws://...`` and lets the CLI
**connect into** the FastAPI server's WebSocket endpoint. So the backend is
the WS *host* and the CLI is the *client*.

Codex inverts this: ``codex app-server --listen ws://...`` is the WS host;
external drivers (us) connect into it as JSON-RPC 2.0 clients. So this
adapter:

  1. ``start(prompt)`` — spawn ``codex app-server`` listening on a free
     loopback port, wait for it to accept a connection, open a WS client
     to it, run ``initialize``/``thread/start``/``turn/start``.
  2. ``send_message(text)`` — issue another ``turn/start`` on the same
     thread.
  3. ``answer_question_structured(answers)`` — resolve a parked
     ``item/tool/requestUserInput`` server-request with the user's
     selections.
  4. ``stop()`` — close WS, terminate the app-server subprocess.

Auth: codex login state is read from ``~/.codex``. The spawned
subprocess inherits the invoking user's credentials, so the operator
must have run ``codex login`` (or set ``OPENAI_API_KEY``) beforehand.
Do **not** run the backend with ``sudo`` — the subprocess would lose
the login token (same footgun as the Claude version, see paper-lens
v1.3 release notes).

Schema source: ``codex app-server generate-json-schema --out <dir>``,
exercised against codex-cli 0.123.0. The app-server protocol is marked
``[experimental]`` upstream; bumping the codex CLI may require updating
event/method names here.
"""
from __future__ import annotations

import asyncio
import json
import logging
import socket
from typing import AsyncIterator, Optional
from uuid import uuid4

import websockets
from websockets.client import WebSocketClientProtocol

from .base import EventType, QuestionData, SessionEvent, SessionInterface

logger = logging.getLogger(__name__)


# Server-request methods we auto-approve so the agent isn't blocked on
# every tool call. These are non-interactive approvals — the user has
# already opted into running this backend, which implies trusting it
# to do paper-reading-grade work (read files, run python, fetch URLs).
_AUTO_ACCEPT_METHODS = {
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/permissions/requestApproval",
    "applyPatchApproval",
    "execCommandApproval",
}


class CodexAppServerAdapter(SessionInterface):
    """Drives a ``codex app-server`` subprocess over a JSON-RPC 2.0 WS.

    Public surface mirrors the Claude SdkUrlAdapter: ``start``,
    ``send_message``, ``events``, ``stop``. The structured-answer entry
    point ``answer_question_structured`` replaces the Claude
    ``answer_question(text)`` because codex's server-request expects a
    typed map ``{question_id: {answers: [...]}}`` rather than an opaque
    text blob.

    Cleanup compatibility: ``_cli_ws`` is exposed so server.py's
    ``_cleanup_expired_sessions`` (which skips sessions whose
    ``adapter._cli_ws is not None``) keeps mid-turn sessions alive even
    if no HTTP endpoint has been hit recently.
    """

    def __init__(self, working_dir: str):
        self.working_dir = working_dir
        self.session_id: str = str(uuid4())
        self.thread_id: Optional[str] = None

        self._app_port: Optional[int] = None
        self._process: Optional[asyncio.subprocess.Process] = None
        self._cli_ws: Optional[WebSocketClientProtocol] = None
        self._receive_task: Optional[asyncio.Task] = None

        self._event_queue: asyncio.Queue[SessionEvent] = asyncio.Queue()
        self._next_request_id: int = 1
        self._pending_responses: dict[int, asyncio.Future] = {}

        # Parked ``item/tool/requestUserInput`` server-requests:
        #   server_request_id -> original params (for question metadata)
        self._pending_questions: dict[object, dict] = {}

        self._stopped = False

    # ── Public API (SessionInterface) ─────────────────────────────────

    async def start(self, prompt: str) -> str:
        self._app_port = _find_free_port()
        listen_url = f"ws://127.0.0.1:{self._app_port}"
        logger.info(f"Spawning: codex app-server --listen {listen_url}")

        self._process = await asyncio.create_subprocess_exec(
            "codex", "app-server", "--listen", listen_url,
            cwd=self.working_dir,
            stdout=asyncio.subprocess.DEVNULL,
            # capture stderr for diagnostics if startup fails
            stderr=asyncio.subprocess.PIPE,
        )

        # Poll until the server accepts a WS connection or give up.
        # codex app-server typically binds within a few hundred ms but
        # leave a generous ceiling so a slow start (e.g. cold cache,
        # first-run schema generation) doesn't trip false-positive
        # failures.
        connect_deadline = 15.0
        connect_interval = 0.2
        attempts = int(connect_deadline / connect_interval)
        last_err: Optional[Exception] = None
        for _ in range(attempts):
            if self._process.returncode is not None:
                # subprocess died before we could connect
                stderr = b""
                if self._process.stderr is not None:
                    try:
                        stderr = await asyncio.wait_for(
                            self._process.stderr.read(2048), timeout=0.5
                        )
                    except asyncio.TimeoutError:
                        pass
                raise RuntimeError(
                    f"codex app-server exited before listening "
                    f"(rc={self._process.returncode}): "
                    f"{stderr.decode('utf-8', errors='replace')[:500]}"
                )
            try:
                self._cli_ws = await websockets.connect(
                    listen_url,
                    max_size=None,  # don't truncate large responses
                    open_timeout=connect_interval,
                )
                break
            except (ConnectionRefusedError, OSError, asyncio.TimeoutError) as e:
                last_err = e
                await asyncio.sleep(connect_interval)
        if self._cli_ws is None:
            await self._terminate_process()
            raise RuntimeError(
                f"could not connect to codex app-server at {listen_url} "
                f"after {connect_deadline:.0f}s: {last_err}"
            )
        logger.info(f"WS connected to codex app-server (session {self.session_id})")

        # JSON-RPC handshake
        self._receive_task = asyncio.create_task(self._receive_loop())
        try:
            await self._call("initialize", {
                "clientInfo": {
                    "name": "paper-lens-codex-backend",
                    "version": "0.1.0",
                },
            })
            await self._notify("initialized", {})

            thread_resp = await self._call("thread/start", {
                # Auto-approve everything: paper-lens needs to run python,
                # read files, curl PDFs without interrupting the user.
                "approvalPolicy": "never",
                "cwd": self.working_dir,
            })
            self.thread_id = (
                thread_resp.get("thread", {}).get("id")
                if isinstance(thread_resp, dict) else None
            )
            if not self.thread_id:
                raise RuntimeError(
                    f"thread/start returned unexpected payload: {thread_resp!r}"
                )
            logger.info(f"thread/start ok, thread_id={self.thread_id}")

            await self._call("turn/start", {
                "threadId": self.thread_id,
                "input": [{"type": "text", "text": prompt}],
            })
        except Exception:
            await self.stop()
            raise

        return self.session_id

    async def send_message(self, message: str) -> None:
        if not self.thread_id:
            raise RuntimeError("send_message before thread is started")
        if self._cli_ws is None:
            raise RuntimeError("send_message after WS closed")
        await self._call("turn/start", {
            "threadId": self.thread_id,
            "input": [{"type": "text", "text": message}],
        })

    async def answer_question_structured(
        self,
        answers: dict[str, list[str]],
    ) -> bool:
        """Resolve the oldest parked ``item/tool/requestUserInput``.

        ``answers`` maps the question ``id`` (as sent by codex in the
        server-request params) to a list of answer strings. Question ids
        not present in ``answers`` get an empty list — codex tolerates
        that, but the model may then re-ask.

        Returns False if no question is parked, so the caller can fall
        back to ``send_message`` (treat the user's reply as a free-form
        message).
        """
        if not self._pending_questions:
            return False
        request_id, params = self._pending_questions.popitem()  # LIFO is fine
        questions = params.get("questions", [])

        # Build the per-question answer map. Frontend may key by header,
        # title, or id — be lenient and accept any of them.
        answer_map: dict[str, dict] = {}
        for q in questions:
            qid = q.get("id")
            header = q.get("header")
            question_text = q.get("question")
            picked: list[str] = (
                answers.get(qid, [])
                or answers.get(header, [])
                or answers.get(question_text, [])
            )
            if isinstance(picked, str):
                picked = [picked]
            answer_map[qid] = {"answers": list(picked)}

        await self._send_response(request_id, {"answers": answer_map})
        logger.info(
            f"resolved requestUserInput request_id={request_id} "
            f"with {sum(len(v['answers']) for v in answer_map.values())} answers"
        )
        return True

    async def events(self) -> AsyncIterator[SessionEvent]:
        while True:
            event = await self._event_queue.get()
            yield event
            if event.type in (EventType.DONE, EventType.ERROR):
                break

    async def stop(self) -> None:
        if self._stopped:
            return
        self._stopped = True

        if self._receive_task and not self._receive_task.done():
            self._receive_task.cancel()
            try:
                await self._receive_task
            except (asyncio.CancelledError, Exception):
                pass

        if self._cli_ws is not None:
            try:
                await self._cli_ws.close()
            except Exception:
                pass
            self._cli_ws = None

        await self._terminate_process()

    # ── Internal: subprocess + JSON-RPC plumbing ──────────────────────

    async def _terminate_process(self) -> None:
        if self._process is None:
            return
        try:
            self._process.terminate()
            await asyncio.wait_for(self._process.wait(), timeout=5.0)
        except (asyncio.TimeoutError, ProcessLookupError):
            try:
                self._process.kill()
            except ProcessLookupError:
                pass
        self._process = None

    async def _call(self, method: str, params: dict, timeout: float = 60.0) -> dict:
        """Issue a JSON-RPC request and await the matching response."""
        if self._cli_ws is None:
            raise RuntimeError(f"WS closed before {method!r}")
        rid = self._next_request_id
        self._next_request_id += 1
        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        self._pending_responses[rid] = fut
        msg = {"jsonrpc": "2.0", "id": rid, "method": method, "params": params}
        await self._cli_ws.send(json.dumps(msg))
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        finally:
            self._pending_responses.pop(rid, None)

    async def _notify(self, method: str, params: dict) -> None:
        if self._cli_ws is None:
            return
        msg = {"jsonrpc": "2.0", "method": method, "params": params}
        await self._cli_ws.send(json.dumps(msg))

    async def _send_response(self, request_id: object, result: dict) -> None:
        if self._cli_ws is None:
            return
        msg = {"jsonrpc": "2.0", "id": request_id, "result": result}
        await self._cli_ws.send(json.dumps(msg))

    async def _send_error_response(
        self, request_id: object, code: int, message: str,
    ) -> None:
        if self._cli_ws is None:
            return
        msg = {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": code, "message": message},
        }
        await self._cli_ws.send(json.dumps(msg))

    async def _receive_loop(self) -> None:
        try:
            assert self._cli_ws is not None
            async for raw in self._cli_ws:
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    logger.warning(f"non-JSON frame from codex: {str(raw)[:160]!r}")
                    continue
                try:
                    await self._dispatch(data)
                except Exception as e:
                    logger.exception(f"dispatch error: {e}")
        except (websockets.ConnectionClosed, asyncio.CancelledError):
            pass
        except Exception as e:
            if not self._stopped:
                logger.error(f"receive loop crashed: {e}")
                await self._event_queue.put(
                    SessionEvent(type=EventType.ERROR, data=f"codex WS: {e}")
                )
        finally:
            if not self._stopped:
                await self._event_queue.put(
                    SessionEvent(type=EventType.DONE, data="ws closed")
                )

    async def _dispatch(self, msg: dict) -> None:
        """Fan one inbound JSON-RPC message into responses / events / approvals."""
        if "method" not in msg:
            # Response to one of our outbound requests.
            rid = msg.get("id")
            fut = self._pending_responses.get(rid)
            if fut is None:
                logger.warning(f"unmatched response id={rid}")
                return
            if "error" in msg:
                err = msg["error"] or {}
                fut.set_exception(RuntimeError(
                    f"codex RPC error {err.get('code')}: {err.get('message')}"
                ))
            else:
                fut.set_result(msg.get("result"))
            return

        method = msg["method"]
        params = msg.get("params") or {}

        if "id" in msg:
            await self._handle_server_request(msg["id"], method, params)
        else:
            await self._handle_notification(method, params)

    async def _handle_server_request(
        self, request_id: object, method: str, params: dict,
    ) -> None:
        if method == "item/tool/requestUserInput":
            self._pending_questions[request_id] = params
            questions = params.get("questions", [])
            await self._event_queue.put(SessionEvent(
                type=EventType.QUESTION,
                data=QuestionData(questions=list(questions)),
            ))
            # Don't respond — wait for answer_question_structured() to do so.
            return

        if method in _AUTO_ACCEPT_METHODS:
            # Field name varies: most use {"decision": "accept"}; signed-bearer
            # variants may differ. "accept" is the universal happy path.
            await self._send_response(request_id, {"decision": "accept"})
            return

        if method == "mcpServer/elicitation/request":
            # We don't currently surface MCP elicitations to the user; decline
            # so the model can move on rather than hang forever.
            await self._send_response(request_id, {"action": "decline"})
            return

        # Default: unknown server-request — error out so codex doesn't wait
        # forever. This keeps experimental schema drift visible in logs.
        logger.warning(f"unhandled server-request {method!r}; rejecting")
        await self._send_error_response(
            request_id, code=-32601, message=f"unhandled server method {method}"
        )

    async def _handle_notification(self, method: str, params: dict) -> None:
        if method == "thread/started":
            thread = params.get("thread") or {}
            tid = thread.get("id")
            if tid and self.thread_id is None:
                self.thread_id = tid
            await self._event_queue.put(SessionEvent(
                type=EventType.STATUS,
                data={"status": "thread_started", "thread_id": tid},
            ))
            return

        if method == "item/agentMessage/delta":
            delta = params.get("delta", "")
            if delta:
                await self._event_queue.put(SessionEvent(
                    type=EventType.TEXT_DELTA, data=delta,
                ))
            return

        if method == "item/reasoning/textDelta":
            delta = params.get("delta", "")
            if delta:
                await self._event_queue.put(SessionEvent(
                    type=EventType.THINKING_DELTA, data=delta,
                ))
            return

        if method in (
            "item/reasoning/summaryTextDelta",
            "item/reasoning/summaryPartAdded",
        ):
            # Reasoning summaries are nice-to-have but verbose; surface as
            # thinking deltas so the UI shows progress.
            text = params.get("delta") or params.get("text") or params.get("part")
            if isinstance(text, str) and text:
                await self._event_queue.put(SessionEvent(
                    type=EventType.THINKING_DELTA, data=text,
                ))
            return

        if method == "turn/started":
            await self._event_queue.put(SessionEvent(
                type=EventType.STATUS, data={"status": "turn_started"},
            ))
            return

        if method == "turn/completed":
            turn = params.get("turn") or {}
            await self._event_queue.put(SessionEvent(
                type=EventType.TURN_DONE,
                data={
                    "turn_id": turn.get("id"),
                    "thread_id": params.get("threadId"),
                    "status": turn.get("status"),
                },
            ))
            return

        if method == "thread/tokenUsage/updated":
            await self._event_queue.put(SessionEvent(
                type=EventType.USAGE, data=params,
            ))
            return

        if method == "item/started":
            item = params.get("item") or {}
            await self._event_queue.put(SessionEvent(
                type=EventType.TOOL_USE,
                data={
                    "id": item.get("id"),
                    "type": item.get("type"),
                    "summary": item.get("summary"),
                },
            ))
            return

        if method == "item/completed":
            item = params.get("item") or {}
            await self._event_queue.put(SessionEvent(
                type=EventType.TOOL_RESULT,
                data={
                    "id": item.get("id"),
                    "type": item.get("type"),
                    "status": item.get("status"),
                },
            ))
            return

        if method in ("error", "warning"):
            await self._event_queue.put(SessionEvent(
                type=EventType.ERROR if method == "error" else EventType.STATUS,
                data=params.get("message") or params,
            ))
            return

        # Unhandled notifications are fine — codex sends a lot of
        # bookkeeping events (thread/status/changed, app/list/updated,
        # mcpServer/startupStatus/updated, ...). Log at debug only.
        logger.debug(f"unhandled notification {method!r}")


def _find_free_port() -> int:
    """Bind-and-release trick to find an ephemeral loopback port."""
    s = socket.socket()
    try:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]
    finally:
        s.close()
