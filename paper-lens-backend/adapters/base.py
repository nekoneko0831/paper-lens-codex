"""Abstract session interface for paper-lens adapters."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import AsyncIterator, Any


class EventType(str, Enum):
    TEXT_DELTA = "text_delta"
    THINKING_DELTA = "thinking_delta"
    QUESTION = "question"
    FILE_SAVED = "file_saved"
    TOOL_USE = "tool_use"
    TOOL_RESULT = "tool_result"
    USAGE = "usage"
    STATUS = "status"
    ERROR = "error"
    TURN_DONE = "turn_done"  # current assistant turn ended; session stays alive
    DONE = "done"            # session fully ended (process exit / stop())


@dataclass
class SessionEvent:
    type: EventType
    data: Any = None


@dataclass
class QuestionData:
    """Structured question from AskUserQuestion."""
    questions: list[dict] = field(default_factory=list)
    # Each question: {question: str, header: str, options: [...], multiSelect: bool}


class SessionInterface(ABC):
    """Abstract interface for paper-lens backend adapters.

    Implementations:
    - ClaudeCLIAdapter: wraps Claude Code CLI (local, free)
    - LarkAdapter: wraps Lark bot API (future)
    """

    @abstractmethod
    async def start(self, prompt: str) -> str:
        """Start a session with initial prompt. Returns session_id."""
        ...

    @abstractmethod
    async def send_message(self, message: str) -> None:
        """Send a follow-up message (e.g., user's answer to a question)."""
        ...

    @abstractmethod
    async def events(self) -> AsyncIterator[SessionEvent]:
        """Yield events from the backend."""
        ...

    @abstractmethod
    async def stop(self) -> None:
        """Stop the session and clean up resources."""
        ...
