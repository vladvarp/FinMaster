"""Журнал записей на диск для вкладки консоли. Файлы отчётов не меняет."""

from __future__ import annotations

import ctypes
import os
import threading
import time

_LOCK = threading.Lock()
_EVENTS: list[dict] = []
_NEXT = 1
_SIZES: dict[str, int] = {}
_SAMPLED = 0.0


def _fmt(n: int) -> str:
    n = max(0, int(n))
    if n < 1024:
        return f"{n} Б"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} КБ"
    if n < 1024 ** 3:
        return f"{n / 1024 / 1024:.1f} МБ"
    return f"{n / 1024 ** 3:.2f} ГБ"


def note(path: str, nbytes: int) -> None:
    global _NEXT
    full = os.path.abspath(str(path or ""))
    with _LOCK:
        _EVENTS.append({
            "id": _NEXT,
            "ts": time.time(),
            "path": full,
            "bytes": int(nbytes),
            "total": int(nbytes),
            "fresh": True,
        })
        _NEXT += 1
        del _EVENTS[:-400]


def _dir_size(path: str) -> int:
    total = 0
    seen = 0
    for root, dirs, files in os.walk(path):
        dirs[:] = [name for name in dirs if name not in {"Crashpad", "BrowserMetrics"}]
        for name in files:
            seen += 1
            if seen > 6000:
                return total
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                continue
    return total


def _sample() -> None:
    global _SAMPLED, _NEXT
    now = time.time()
    if now - _SAMPLED < 3:
        return
    _SAMPLED = now
    local = os.environ.get("LOCALAPPDATA") or ""
    root = os.path.join(local, "pywebview", "EBWebView") if local else ""
    if not root or not os.path.isdir(root):
        return
    grown: list[tuple[str, int, int]] = []
    try:
        names = [name for name in os.listdir(root) if os.path.isdir(os.path.join(root, name))]
    except OSError:
        return
    for name in names:
        path = os.path.join(root, name)
        size = _dir_size(path)
        prev = _SIZES.get(path)
        _SIZES[path] = size
        if prev is None or size <= prev:
            continue
        grown.append((path, size - prev, size))
    if not grown:
        return
    with _LOCK:
        for path, delta, size in grown:
            _EVENTS.append({
                "id": _NEXT,
                "ts": now,
                "path": path,
                "bytes": delta,
                "total": size,
                "fresh": False,
            })
            _NEXT += 1
        del _EVENTS[:-400]


def since(after: int) -> dict:
    _sample()
    with _LOCK:
        events = [dict(item) for item in _EVENTS if item["id"] > after]
        last = _NEXT - 1
    return {"ok": True, "events": events, "last_id": last}


def clear() -> dict:
    global _EVENTS
    with _LOCK:
        _EVENTS = []
        last = _NEXT - 1
    return {"ok": True, "last_id": last}


class _IO(ctypes.Structure):
    _fields_ = [(name, ctypes.c_ulonglong) for name in (
        "rops", "wops", "oops", "rbytes", "wbytes", "obytes",
    )]


class _PE(ctypes.Structure):
    _fields_ = [
        ("dwSize", ctypes.c_uint32), ("cntUsage", ctypes.c_uint32),
        ("pid", ctypes.c_uint32), ("heap", ctypes.c_void_p),
        ("mod", ctypes.c_uint32), ("threads", ctypes.c_uint32),
        ("ppid", ctypes.c_uint32), ("pri", ctypes.c_long),
        ("flags", ctypes.c_uint32), ("exe", ctypes.c_wchar * 260),
    ]


_K32 = ctypes.WinDLL("kernel32", use_last_error=True)
_K32.CreateToolhelp32Snapshot.restype = ctypes.c_void_p
_K32.OpenProcess.restype = ctypes.c_void_p
_EDGE: list[dict] = []
_EDGE_NEXT = 1
_EDGE_PREV: dict[int, int] = {}


def _edge_now() -> list[tuple[int, int, int, int, int]]:
    snap = _K32.CreateToolhelp32Snapshot(0x2, 0)
    if not snap or snap == ctypes.c_void_p(-1).value:
        return []
    found: list[tuple[int, int]] = []
    pe = _PE()
    pe.dwSize = ctypes.sizeof(pe)
    ok = _K32.Process32FirstW(snap, ctypes.byref(pe))
    while ok:
        if pe.exe.lower() == "msedgewebview2.exe":
            found.append((int(pe.pid), int(pe.ppid)))
        ok = _K32.Process32NextW(snap, ctypes.byref(pe))
    _K32.CloseHandle(snap)
    rows = []
    for pid, ppid in found:
        handle = _K32.OpenProcess(0x1000, False, pid)
        if not handle:
            continue
        io = _IO()
        good = _K32.GetProcessIoCounters(handle, ctypes.byref(io))
        _K32.CloseHandle(handle)
        if good:
            rows.append((pid, ppid, int(io.wbytes), int(io.rbytes), int(io.wops)))
    return rows


def edge_since(after: int) -> dict:
    global _EDGE_NEXT
    fresh: list[dict] = []
    alive: set[int] = set()
    now = time.time()
    for pid, ppid, write, read, wops in _edge_now():
        alive.add(pid)
        prev = _EDGE_PREV.get(pid)
        _EDGE_PREV[pid] = write
        delta = 0 if prev is None else write - prev
        if prev is not None and delta <= 0:
            continue
        fresh.append({
            "id": 0,
            "ts": now,
            "path": f"msedgewebview2.exe · pid {pid} · родитель {ppid}",
            "bytes": max(0, delta),
            "total": write,
            "fresh": prev is None,
            "note": f"записано {_fmt(write)} · прочитано {_fmt(read)} · операций записи {wops}",
        })
    for pid in list(_EDGE_PREV):
        if pid not in alive:
            _EDGE_PREV.pop(pid, None)
    with _LOCK:
        for item in fresh:
            item["id"] = _EDGE_NEXT
            _EDGE_NEXT += 1
            _EDGE.append(item)
        del _EDGE[:-400]
        events = [dict(item) for item in _EDGE if item["id"] > after]
        last = _EDGE_NEXT - 1
    return {"ok": True, "events": events, "last_id": last}


def edge_clear() -> dict:
    global _EDGE
    _EDGE_PREV.clear()
    with _LOCK:
        _EDGE = []
        last = _EDGE_NEXT - 1
    return {"ok": True, "last_id": last}
