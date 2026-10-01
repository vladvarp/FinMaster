"""Очередь PDF: бот просит окно FinMaster собрать файл тем же движком, что на компьютере."""

from __future__ import annotations

import secrets
import threading
import time
from typing import Any


class PdfBridge:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pending: dict[str, dict[str, Any]] = {}
        self._queue: list[str] = []

    def request(self, payload: dict[str, Any], timeout: float = 90.0) -> bytes:
        job_id = secrets.token_hex(8)
        done = threading.Event()
        with self._lock:
            self._pending[job_id] = {
                "payload": payload,
                "event": done,
                "result": None,
                "error": None,
                "created": time.time(),
            }
            self._queue.append(job_id)
        if not done.wait(timeout):
            with self._lock:
                self._pending.pop(job_id, None)
                if job_id in self._queue:
                    self._queue.remove(job_id)
            raise TimeoutError(
                "Окно FinMaster не успело собрать PDF по шаблону. "
                "Проверьте, что программа открыта на компьютере, и повторите."
            )
        with self._lock:
            job = self._pending.pop(job_id, {}) or {}
        if job.get("error"):
            raise RuntimeError(str(job["error"]))
        data = job.get("result")
        if not isinstance(data, (bytes, bytearray)) or not data:
            raise RuntimeError("Компьютер вернул пустой PDF.")
        return bytes(data)

    def take(self) -> dict[str, Any] | None:
        with self._lock:
            while self._queue:
                job_id = self._queue.pop(0)
                job = self._pending.get(job_id)
                if not job:
                    continue
                if job.get("result") is not None or job.get("error"):
                    continue
                payload = dict(job.get("payload") or {})
                payload["id"] = job_id
                return payload
        return None

    def complete(self, job_id: str, *, data: bytes | None = None, error: str = "") -> bool:
        with self._lock:
            job = self._pending.get(str(job_id or ""))
            if not job:
                return False
            if error:
                job["error"] = str(error)[:500]
            else:
                job["result"] = bytes(data or b"")
            job["event"].set()
            return True


PDF_BRIDGE = PdfBridge()
