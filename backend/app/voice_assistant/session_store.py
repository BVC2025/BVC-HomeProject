"""
In-process, TTL-bounded session store.

Keyed on session_id. Sessions expire after IDLE_TTL_SECONDS of no
activity so old conversations don't leak memory. Thread-safe under
the FastAPI async event loop because we use a single RLock.

A Redis-backed implementation slots in behind the same get/save/reset
interface if we ever move to multi-process. Callers should not depend
on any concrete detail here.
"""

from __future__ import annotations

import threading
import time
from typing import Optional

from app.voice_assistant.schemas import SessionState


IDLE_TTL_SECONDS   = 30 * 60          # 30 minutes of inactivity → forget
MAX_HISTORY_TURNS  = 12               # keep last 12 entries (user+assistant)


class _Entry:
    __slots__ = ("state", "touched_at")

    def __init__(self, state: SessionState):
        self.state      = state
        self.touched_at = time.time()


class SessionStore:

    def __init__(self):
        self._data: dict[str, _Entry] = {}
        self._lock = threading.RLock()

    def _purge_expired(self) -> None:
        now = time.time()
        with self._lock:
            stale = [
                sid for sid, entry in self._data.items()
                if (now - entry.touched_at) > IDLE_TTL_SECONDS
            ]
            for sid in stale:
                self._data.pop(sid, None)

    def get_or_create(self, session_id: str, employee_id: str) -> SessionState:
        self._purge_expired()
        with self._lock:
            entry = self._data.get(session_id)
            if entry is None:
                entry = _Entry(SessionState(
                    session_id=session_id,
                    employee_id=employee_id,
                ))
                self._data[session_id] = entry
            else:
                # Rebind employee if the session is reused across users
                entry.state.employee_id = employee_id
            entry.touched_at = time.time()
            return entry.state

    def save(self, state: SessionState) -> None:
        with self._lock:
            entry = self._data.get(state.session_id)
            if entry is None:
                entry = _Entry(state)
                self._data[state.session_id] = entry
            else:
                # Bound history so prompts stay cheap
                if len(state.history) > MAX_HISTORY_TURNS:
                    state.history = state.history[-MAX_HISTORY_TURNS:]
                entry.state = state
                entry.touched_at = time.time()

    def reset(self, session_id: str) -> None:
        with self._lock:
            self._data.pop(session_id, None)

    def clear_active_intent(self, session_id: str) -> None:
        with self._lock:
            entry = self._data.get(session_id)
            if entry is None:
                return
            entry.state.active_intent = None
            entry.state.slots = {}
            entry.touched_at = time.time()


# Module-level singleton — one store per FastAPI worker.
store = SessionStore()
