"""Наблюдение за папкой FinMaster: отчёты, которые появились или исчезли в проводнике."""

from __future__ import annotations

import os
import threading
import time
from typing import Callable

from backend import netlog, storage

POLL_SEC = 0.7
WAIT_TIMEOUT = 20.0


def library_fingerprint() -> str:
    folder = storage.default_reports_dir()
    rows: list[str] = []
    try:
        names = os.listdir(folder)
    except OSError:
        return ""
    for name in names:
        if not name.lower().endswith(".fmaster"):
            continue
        path = os.path.join(folder, name)
        try:
            st = os.stat(path)
        except OSError:
            continue
        if not os.path.isfile(path):
            continue
        stamp = int(getattr(st, "st_mtime_ns", int(st.st_mtime * 1_000_000_000)))
        rows.append(f"{name.casefold()}|{st.st_size}|{stamp}")
    rows.sort()
    return "\n".join(rows)


class LibraryWatcher:
    def __init__(self) -> None:
        self.version = 0
        self._cond = threading.Condition()
        self._fp = ""
        self._stop = threading.Event()
        self._on_change: Callable[[], None] | None = None
        self._thread: threading.Thread | None = None

    def set_hook(self, fn: Callable[[], None] | None) -> None:
        self._on_change = fn

    def tick(self) -> bool:
        fp = library_fingerprint()
        if fp == self._fp:
            return False
        self._fp = fp
        with self._cond:
            self.version += 1
            self._cond.notify_all()
        netlog.add("sync", "Папка FinMaster обновилась", key="lib-watch")
        hook = self._on_change
        if hook:
            try:
                hook()
            except Exception:
                pass
        return True

    def wait(self, since: int, timeout: float = WAIT_TIMEOUT) -> int:
        deadline = time.time() + timeout
        with self._cond:
            while self.version <= since and not self._stop.is_set():
                left = deadline - time.time()
                if left <= 0:
                    break
                self._cond.wait(min(left, 1.0))
            return self.version

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._fp = library_fingerprint()
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="fm-library-watch", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        with self._cond:
            self._cond.notify_all()

    def _run(self) -> None:
        folder = storage.default_reports_dir()
        if os.name == "nt":
            try:
                self._watch_windows(folder)
                return
            except Exception:
                pass
        self._run_poll()

    def _run_poll(self) -> None:
        while not self._stop.is_set():
            self.tick()
            self._stop.wait(POLL_SEC)

    def _watch_windows(self, folder: str) -> None:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.windll.kernel32
        file_list_directory = 0x0001
        share = 0x0001 | 0x0002 | 0x0004
        open_existing = 3
        backup_semantics = 0x02000000
        notify = 0x00000001 | 0x00000002 | 0x00000004 | 0x00000008 | 0x00000010

        create_file = kernel32.CreateFileW
        create_file.argtypes = [
            wintypes.LPCWSTR,
            wintypes.DWORD,
            wintypes.DWORD,
            wintypes.LPVOID,
            wintypes.DWORD,
            wintypes.DWORD,
            wintypes.HANDLE,
        ]
        create_file.restype = wintypes.HANDLE
        handle = create_file(folder, file_list_directory, share, None, open_existing, backup_semantics, None)
        invalid = wintypes.HANDLE(-1).value
        if handle in (None, 0, invalid, 0xFFFFFFFF, 0xFFFFFFFFFFFFFFFF):
            self._run_poll()
            return

        buf = ctypes.create_string_buffer(64 * 1024)
        nbytes = wintypes.DWORD()
        read = kernel32.ReadDirectoryChangesW
        try:
            self.tick()
            while not self._stop.is_set():
                ok = read(handle, buf, len(buf), False, notify, ctypes.byref(nbytes), None, None)
                if not ok:
                    time.sleep(POLL_SEC)
                else:
                    time.sleep(0.15)
                self.tick()
        finally:
            kernel32.CloseHandle(handle)


WATCHER = LibraryWatcher()
