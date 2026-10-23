"""Установка и обновление FinMaster с GitHub: только последний коммит.

Полный снимок качается при установке и при обновлении.
FinMaster.exe с GitHub не скачивается. Запущенный файл копирует себя в папку
программы, чтобы не качать ту же копию ещё раз.
В папке программы commit.txt — время этого коммита.
"""

from __future__ import annotations

import hashlib
import json
import os
import queue
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Callable

from backend import storage


REPO = "vladvarp/FinMaster"
API = f"https://api.github.com/repos/{REPO}"
RAW = f"https://raw.githubusercontent.com/{REPO}"
SELF_NAME = "FinMaster.exe"
STAMP_NAME = "commit.txt"
_CREATE_NO_WINDOW = 0x08000000
_skip_check = False


class _Stop(Exception):
    """Пользователь закрыл установку."""


def _dpi() -> None:
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass


def _tell(text: str) -> None:
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, str(text)[:800], "FinMaster", 0x10)
    except Exception:
        pass


def _ask_yes(text: str, warning: bool = False) -> bool:
    if sys.platform != "win32":
        return False
    try:
        import ctypes

        flags = 0x4 | (0x30 if warning else 0x20)
        return int(ctypes.windll.user32.MessageBoxW(None, text, "FinMaster", flags)) == 6
    except Exception:
        return False


def _same(left: str, right: str) -> bool:
    if not left or not right:
        return False
    return os.path.normcase(os.path.abspath(left)) == os.path.normcase(os.path.abspath(right))


def _under(path: str, root: str) -> bool:
    try:
        return os.path.commonpath([os.path.abspath(path), os.path.abspath(root)]) == os.path.abspath(root)
    except ValueError:
        return False


def _here() -> str:
    return os.path.dirname(os.path.abspath(sys.executable))


def _running_here(path: str) -> bool:
    return _same(_here(), path)


def _is_self(rel: str) -> bool:
    name = str(rel or "").replace("\\", "/").rstrip("/").split("/")[-1]
    return name.lower() == SELF_NAME.lower()


def _without_self(files: list[str]) -> list[str]:
    return [rel for rel in files if rel and not _is_self(rel)]


def _rel_target(root: str, rel: str) -> str:
    rel = str(rel or "").replace("\\", "/").strip().lstrip("/")
    if not rel or (len(rel) > 1 and rel[1] == ":"):
        return ""
    parts = [part for part in rel.split("/") if part and part != "."]
    if not parts or any(part == ".." for part in parts):
        return ""
    target = os.path.abspath(os.path.join(root, *parts))
    if not _same(target, root) and not _under(target, root):
        return ""
    return target


def _record() -> tuple[bool, str, str, bool, str]:
    cfg = storage.load_config()
    return (
        bool(cfg.get("installed")) and bool(str(cfg.get("install_path") or "").strip()),
        str(cfg.get("install_path") or "").strip(),
        str(cfg.get("install_commit") or "").strip(),
        bool(cfg.get("update_pending")),
        str(cfg.get("python_place") or "").strip(),
    )


def _save_commit(path: str, sha: str) -> None:
    cfg = storage.load_config()
    cfg["installed"] = True
    cfg["install_path"] = os.path.abspath(path)
    cfg["install_commit"] = sha
    cfg["update_pending"] = False
    storage.save_config(cfg)


def _clear_pending() -> None:
    cfg = storage.load_config()
    cfg["update_pending"] = False
    storage.save_config(cfg)
    _remove_manifest()


def _reports_dir() -> str:
    return os.path.join(storage.user_documents_dir(), storage.APP_NAME)


def _unsafe(path: str) -> bool:
    if not path:
        return True
    path = os.path.abspath(path)
    drive, tail = os.path.splitdrive(path)
    if not tail.strip("\\/"):
        return True
    windir = os.path.abspath(os.environ.get("WINDIR") or r"C:\Windows")
    if _same(path, windir) or _under(path, windir):
        return True
    reports = os.path.abspath(_reports_dir())
    if _same(path, reports) or _under(path, reports) or _under(reports, path):
        return True
    home = os.path.abspath(os.path.expanduser("~"))
    return _same(path, home)


def _with_app_dir(path: str) -> str:
    """Папка программы всегда заканчивается на \\FinMaster."""
    text = os.path.normpath(str(path or "").strip().strip('"'))
    if not text or text.endswith(":"):
        return text
    if os.path.basename(text).lower() == "finmaster":
        return text
    return os.path.join(text, "FinMaster")


def _default_dir() -> str:
    return r"D:\Program Files\FinMaster"


def _nonempty(path: str) -> bool:
    if not os.path.isdir(path):
        return False
    try:
        return any(os.scandir(path))
    except OSError:
        return True


def _path_error(path: str) -> str:
    if not str(path or "").strip():
        return "Укажите папку"
    if _unsafe(path):
        return "Сюда ставить нельзя: это папка отчётов или системный каталог"
    if _nonempty(path) and not os.path.isfile(os.path.join(path, "run.vbs")):
        return "Папка не пустая. Выберите пустую или уже установленный FinMaster"
    return ""


def _sha_ok(sha: str) -> bool:
    text = str(sha or "").strip().lower()
    return len(text) == 40 and all(ch in "0123456789abcdef" for ch in text)


def _read_json(url: str, timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "FinMaster", "Accept": "application/vnd.github+json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 403:
            raise RuntimeError("GitHub отклонил запрос") from exc
        raise RuntimeError(f"GitHub ответил {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError("Нет связи с GitHub") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("GitHub прислал не тот ответ")
    return payload


def _remote_head(timeout: float) -> tuple[str, str]:
    payload = _read_json(f"{API}/commits/HEAD", timeout)
    sha = str(payload.get("sha") or "").strip().lower()
    if not _sha_ok(sha):
        raise RuntimeError("GitHub не прислал номер версии")
    commit = payload.get("commit") if isinstance(payload.get("commit"), dict) else {}
    when = ""
    for key in ("committer", "author"):
        person = commit.get(key) if isinstance(commit.get(key), dict) else {}
        when = str(person.get("date") or "").strip()
        if when:
            break
    if not when:
        raise RuntimeError("GitHub не прислал время коммита")
    return sha, when


def _remote_sha(timeout: float) -> str:
    return _remote_head(timeout)[0]


def _parse_when(text: str) -> datetime | None:
    raw = str(text or "").strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        value = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value


def _stamp_path(dest: str) -> str:
    return os.path.join(dest, STAMP_NAME)


_BROKEN_MARK = "integrity broken"


def _stamp_lines(dest: str) -> list[str]:
    try:
        with open(_stamp_path(dest), encoding="utf-8") as handle:
            return [line.strip() for line in handle.read().splitlines()]
    except OSError:
        return []


def _read_stamp(dest: str) -> str:
    lines = _stamp_lines(dest)
    return lines[0] if lines else ""


def _broken_flag(dest: str) -> bool:
    return any(line.lower() == _BROKEN_MARK for line in _stamp_lines(dest)[1:])


def _write_stamp(dest: str, when: str | None = None, *, broken: bool | None = None) -> None:
    """Первая строка — дата версии. Вторая, если есть, — пометка о нарушении целостности."""
    text = _read_stamp(dest) if when is None else str(when or "").strip()
    flag = _broken_flag(dest) if broken is None else bool(broken)
    lines: list[str] = []
    if text:
        lines.append(text)
    if flag:
        if not lines:
            lines.append("")
        lines.append(_BROKEN_MARK)
    path = _stamp_path(dest)
    if not lines:
        try:
            os.remove(path)
        except OSError:
            pass
        return
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def _repo_folder(path: str) -> bool:
    return os.path.isdir(os.path.join(path, ".git"))


def _tree(sha: str) -> dict[str, str]:
    payload = _read_json(f"{API}/git/trees/{sha}?recursive=1", 20)
    if payload.get("truncated"):
        raise RuntimeError("Список файлов на GitHub слишком большой")
    found: dict[str, str] = {}
    for item in payload.get("tree") or []:
        if not isinstance(item, dict) or item.get("type") != "blob":
            continue
        path = str(item.get("path") or "").replace("\\", "/")
        blob = str(item.get("sha") or "").strip().lower()
        if path and blob and not _is_self(path):
            found[path] = blob
    return found


def _blob(path: str) -> str:
    with open(path, "rb") as handle:
        data = handle.read()
    header = f"blob {len(data)}\0".encode("ascii")
    return hashlib.sha1(header + data).hexdigest()


def _changed(root: str, sha: str) -> list[str]:
    """Файлы снимка, которых нет локально или которые не совпали с коммитом."""
    changed: list[str] = []
    for rel, blob in _tree(sha).items():
        if _hidden_entry(rel):
            continue
        local = _rel_target(root, rel)
        if not local:
            continue
        try:
            same = os.path.isfile(local) and _blob(local) == blob
        except OSError:
            same = False
        if not same:
            changed.append(rel)
    changed.sort()
    return changed


_MKDIR = threading.Lock()


def _pause(stop: Callable[[], bool], seconds: float) -> bool:
    deadline = time.perf_counter() + seconds
    while time.perf_counter() < deadline:
        if stop():
            return True
        time.sleep(0.05)
    return bool(stop())


def _download_file(url: str, dest: str, stop: Callable[[], bool]) -> None:
    folder = os.path.dirname(dest)
    with _MKDIR:
        os.makedirs(folder, exist_ok=True)
    temporary = f"{dest}.{os.getpid()}.{threading.get_ident()}.part"
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "FinMaster"})
        with urllib.request.urlopen(request, timeout=60) as response, open(temporary, "wb") as handle:
            while True:
                if stop():
                    raise _Stop()
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
        os.replace(temporary, dest)
    finally:
        if os.path.exists(temporary):
            try:
                os.remove(temporary)
            except OSError:
                pass


def _file_url(sha: str, rel: str) -> str:
    return f"{RAW}/{sha}/{urllib.parse.quote(rel, safe='/')}"


def _download_files(
    sha: str,
    dest: str,
    files: list[str],
    report: Callable[[str, float | None], None],
    stop: Callable[[], bool],
    workers: int = 40,
    retries: int = 1,
) -> None:
    listed = _without_self(files)
    total = max(1, len(listed))
    targets: list[tuple[str, str]] = []
    for rel in listed:
        target = _rel_target(dest, rel)
        if not target:
            raise RuntimeError(f"Небезопасный путь {rel}")
        targets.append((rel, target))
    done = 0
    done_lock = threading.Lock()
    failed = threading.Event()
    errors: list[BaseException] = []
    attempts = max(1, int(retries))

    def should_stop() -> bool:
        return bool(stop()) or failed.is_set()

    def one(rel: str, target: str) -> None:
        nonlocal done
        if should_stop():
            return
        error: BaseException | None = None
        for attempt in range(attempts):
            if should_stop():
                return
            try:
                _download_file(_file_url(sha, rel), target, should_stop)
                error = None
                break
            except _Stop:
                failed.set()
                return
            except urllib.error.HTTPError as exc:
                error = RuntimeError(f"Не удалось скачать {rel} ({exc.code})")
            except (urllib.error.URLError, TimeoutError, OSError):
                error = RuntimeError(f"Не удалось скачать {rel}")
            if attempt + 1 < attempts and _pause(should_stop, 0.4):
                return
        if error is not None:
            failed.set()
            errors.append(error)
            return
        with done_lock:
            done += 1
            current = done
        report(f"Скачиваю {current}/{total}", 18 + 64 * current / total)

    threads: list[threading.Thread] = []
    pending = list(targets)

    def worker() -> None:
        while pending and not should_stop():
            with done_lock:
                if not pending or should_stop():
                    return
                rel, target = pending.pop()
            one(rel, target)

    for _ in range(min(max(1, int(workers)), len(targets))):
        thread = threading.Thread(target=worker, daemon=True)
        threads.append(thread)
        thread.start()
    for thread in threads:
        while thread.is_alive():
            thread.join(0.05)
    if stop():
        raise _Stop()
    if errors:
        raise errors[0]


def _place_file(src: str, dest: str) -> None:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if _same(dest, sys.executable):
        return
    temporary = f"{dest}.{os.getpid()}.new"
    shutil.copy2(src, temporary)
    os.replace(temporary, dest)


def _copy_self(dest: str) -> None:
    """Кладёт запущенный FinMaster.exe в папку программы, не скачивая его."""
    target = os.path.join(dest, SELF_NAME)
    source = os.path.abspath(sys.executable)
    if _same(source, target):
        return
    if not os.path.isfile(source):
        raise RuntimeError("Не найден запущенный FinMaster.exe")
    _place_file(source, target)


def _remove_stale_exe() -> None:
    for suffix in (".old", f".{os.getpid()}.old"):
        path = sys.executable + suffix
        if os.path.isfile(path):
            try:
                os.remove(path)
            except OSError:
                pass


def manifest_path() -> str:
    return os.path.join(tempfile.gettempdir(), "FinMaster-update.txt")


def _write_manifest(mode: str, root: str, sha: str, files: list[str], pid: int) -> None:
    lines = [
        f"mode={mode}",
        f"commit={sha}",
        f"root={os.path.abspath(root)}",
        f"pid={int(pid)}",
        "exe=copy",
    ]
    for rel in _without_self(files):
        lines.append("file=" + rel.replace("\\", "/"))
    path = manifest_path()
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def _read_manifest() -> dict[str, Any]:
    path = manifest_path()
    try:
        with open(path, encoding="utf-8") as handle:
            raw = handle.read().splitlines()
    except OSError as exc:
        raise RuntimeError("Не найден список обновления") from exc
    mode = ""
    sha = ""
    root = ""
    pid = 0
    files: list[str] = []
    for line in raw:
        key, sep, value = line.partition("=")
        if not sep:
            continue
        if key == "mode":
            mode = value.strip()
        elif key == "commit":
            sha = value.strip().lower()
        elif key == "root":
            root = value.strip()
        elif key == "pid":
            try:
                pid = int(value.strip() or "0")
            except ValueError:
                pid = 0
        elif key == "file":
            rel = value.strip().replace("\\", "/")
            if rel and not _is_self(rel):
                files.append(rel)
    if mode not in {"files", "all"} or not _sha_ok(sha) or not root:
        raise RuntimeError("Список обновления повреждён")
    return {"mode": mode, "commit": sha, "root": root, "pid": pid, "files": files}


def _remove_manifest() -> None:
    try:
        os.remove(manifest_path())
    except OSError:
        pass


def _pid_alive(pid: int) -> bool:
    if pid <= 0 or sys.platform != "win32":
        return False
    import ctypes

    handle = ctypes.windll.kernel32.OpenProcess(0x00100000, False, int(pid))
    if handle:
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    return ctypes.windll.kernel32.GetLastError() == 5


def _wait_pid(pid: int, stop: Callable[[], bool]) -> None:
    if pid <= 0 or pid == os.getpid():
        return
    deadline = time.time() + 20
    while time.time() < deadline and _pid_alive(pid):
        if stop():
            raise _Stop()
        time.sleep(0.1)


def _special_dir(csidl: int, fallback: str) -> str:
    if sys.platform != "win32":
        return fallback
    import ctypes

    buffer = ctypes.create_unicode_buffer(32768)
    try:
        function = ctypes.windll.shell32.SHGetFolderPathW
        function.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint, ctypes.c_wchar_p]
        function.restype = ctypes.c_long
        if function(None, csidl, None, 0, buffer) == 0 and buffer.value:
            return buffer.value
    except Exception:
        pass
    return fallback


def _run_hidden(args: list[str], env: dict[str, str] | None = None) -> None:
    kwargs: dict[str, Any] = {"capture_output": True, "text": True, "errors": "replace"}
    if env is not None:
        kwargs["env"] = env
    if sys.platform == "win32":
        kwargs["creationflags"] = _CREATE_NO_WINDOW
    try:
        result = subprocess.run(args, **kwargs)
    except OSError as exc:
        raise RuntimeError(f"Не удалось создать ярлык: {exc}") from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(detail or "Не удалось создать ярлык")


def _make_shortcuts(dest: str, desktop: bool = True, start_menu: bool = True) -> None:
    target = os.path.join(dest, SELF_NAME)
    if not os.path.isfile(target):
        raise RuntimeError("В папке программы нет FinMaster.exe")
    desktop_dir = _special_dir(0x0010, os.path.join(os.path.expanduser("~"), "Desktop"))
    programs_dir = _special_dir(
        0x0002,
        os.path.join(os.environ.get("APPDATA") or "", "Microsoft", "Windows", "Start Menu", "Programs"),
    )
    system = os.environ.get("SystemRoot") or r"C:\Windows"
    powershell = os.path.join(system, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    if not os.path.isfile(powershell):
        powershell = "powershell.exe"
    script = (
        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:FM_LNK)\n"
        "$s.TargetPath = $env:FM_TARGET\n"
        "$s.WorkingDirectory = $env:FM_WORKDIR\n"
        "$s.IconLocation = $env:FM_TARGET + ',0'\n"
        "$s.Description = 'FinMaster'\n"
        "$s.Save()\n"
    )
    folders: list[str] = []
    if desktop:
        folders.append(desktop_dir)
    if start_menu:
        folders.append(programs_dir)
    for folder in folders:
        if not folder:
            raise RuntimeError("Не найдена папка для ярлыка")
        os.makedirs(folder, exist_ok=True)
        env = os.environ.copy()
        env["FM_LNK"] = os.path.join(folder, "FinMaster.lnk")
        env["FM_TARGET"] = target
        env["FM_WORKDIR"] = dest
        _run_hidden([powershell, "-NoProfile", "-Command", script], env)


def _remove_shortcuts() -> None:
    desktop = _special_dir(0x0010, os.path.join(os.path.expanduser("~"), "Desktop"))
    programs = _special_dir(
        0x0002,
        os.path.join(os.environ.get("APPDATA") or "", "Microsoft", "Windows", "Start Menu", "Programs"),
    )
    for folder in (desktop, programs):
        path = os.path.join(folder, "FinMaster.lnk")
        try:
            os.remove(path)
        except OSError:
            pass


def _script_supports_dir(dest: str) -> bool:
    path = os.path.join(dest, "bootstrap_python.ps1")
    try:
        with open(path, encoding="utf-8") as handle:
            return "PythonDir" in handle.read()
    except OSError:
        return False


def _ensure_python(
    dest: str,
    place: str,
    report: Callable[[str, float | None], None],
    stop: Callable[[], bool],
) -> None:
    if place not in {"program", "reports"}:
        return
    from backend.runtime import install_blocking, runtime_dir

    folder = os.path.join(dest, "python") if place == "program" else runtime_dir()
    if os.path.isfile(os.path.join(folder, "pythonw.exe")):
        return
    if place == "program" and not _script_supports_dir(dest):
        raise RuntimeError(
            "Скачанная копия не умеет ставить Python в папку программы. Выберите папку отчётов."
        )
    report("Ставлю Python…", 88)
    install_blocking(
        on_line=lambda line: report(line, None),
        project_root=dest,
        should_stop=stop,
        python_dir=folder if place == "program" else None,
    )


def _icon(root: str) -> str:
    path = os.path.join(root, "frontend", "favicon.png")
    return path if os.path.isfile(path) else ""


def _logo_path() -> str:
    """favicon.ico: из сборки exe, рядом с программой или из исходников."""
    found: list[str] = []
    bundled = getattr(sys, "_MEIPASS", "")
    if bundled:
        found.append(os.path.join(bundled, "favicon.ico"))
    found.append(os.path.join(_here(), "frontend", "favicon.ico"))
    found.append(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "favicon.ico"))
    for path in found:
        if path and os.path.isfile(path):
            return path
    return ""


def _apply_logo(root: Any) -> None:
    path = _logo_path()
    if not path:
        return
    try:
        root.iconbitmap(default=path)
    except Exception:
        try:
            root.iconbitmap(path)
        except Exception:
            pass


def _run_splash(icon: str, first: str, work: Callable[..., None]) -> None:
    from backend.splash import Splash

    splash = Splash(icon, closable=True)
    splash.step(first, 8)
    box: queue.Queue[tuple[Any, ...]] = queue.Queue()

    def report(text: str, progress: float | None = None) -> None:
        box.put(("step", text, progress))

    def runner() -> None:
        try:
            work(report, lambda: splash.cancelled)
            box.put(("ok",))
        except _Stop:
            box.put(("stop",))
        except Exception as exc:
            if splash.cancelled or str(exc) == "Установка прервана":
                box.put(("stop",))
            else:
                box.put(("err", exc))

    threading.Thread(target=runner, daemon=True).start()
    while True:
        try:
            splash.pump()
        except Exception:
            pass
        try:
            item = box.get(timeout=0.016)
        except queue.Empty:
            continue
        if item[0] == "step":
            splash.step(item[1], item[2])
            continue
        splash.close()
        if item[0] == "ok":
            return
        if item[0] == "stop":
            raise _Stop()
        raise item[1]


def _remote_file_list(sha: str) -> list[str]:
    files = list(_tree(sha))
    files.sort()
    return files


def _hidden_entry(rel: str) -> bool:
    parts = str(rel or "").replace("\\", "/").split("/")
    return any(part.startswith(".") for part in parts if part)


def _snapshot_files(sha: str) -> list[str]:
    """Файлы последнего коммита без FinMaster.exe и без имён на точку."""
    files = [rel for rel in _remote_file_list(sha) if not _hidden_entry(rel)]
    files.sort()
    return files


def _shortcut_places() -> tuple[bool, bool]:
    cfg = storage.load_config()
    if "install_shortcut_desktop" in cfg or "install_shortcut_start" in cfg:
        return bool(cfg.get("install_shortcut_desktop")), bool(cfg.get("install_shortcut_start"))
    enabled = bool(cfg.get("install_shortcuts", True))
    return enabled, enabled


def _pull(
    sha: str,
    dest: str,
    files: list[str] | None,
    place: str,
    shortcuts: bool,
    report: Callable[[str, float | None], None],
    stop: Callable[[], bool],
    pid: int = 0,
) -> str:
    if stop():
        raise _Stop()
    report("Жду закрытия предыдущей копии…", 10)
    _wait_pid(pid, stop)
    listed = _remote_file_list(sha) if files is None else _without_self(files)
    os.makedirs(dest, exist_ok=True)
    if listed:
        _download_files(sha, dest, listed, report, stop)
    report("Копирую FinMaster.exe…", 86)
    _copy_self(dest)
    if not os.path.isfile(os.path.join(dest, SELF_NAME)):
        raise RuntimeError("Не удалось положить FinMaster.exe в папку программы")
    bundled = os.path.isfile(os.path.join(dest, "python", "pythonw.exe"))
    if not bundled and place in {"program", "reports"}:
        _ensure_python(dest, place, report, stop)
    shortcut_error = ""
    if shortcuts:
        report("Создаю ярлыки…", 94)
        try:
            desktop_on, start_on = _shortcut_places()
            _make_shortcuts(dest, desktop=desktop_on, start_menu=start_on)
        except Exception as exc:
            shortcut_error = str(exc)
            report(shortcut_error, None)
    chosen = place or ("bundled" if bundled else "")
    cfg = storage.load_config()
    cfg["installed"] = True
    cfg["install_path"] = os.path.abspath(dest)
    cfg["install_commit"] = sha
    cfg["update_pending"] = False
    if chosen and not str(cfg.get("python_place") or "").strip():
        cfg["python_place"] = chosen
    storage.save_config(cfg)
    _remove_manifest()
    try:
        remote, when = _remote_head(10)
        if remote == sha:
            _write_stamp(dest, when, broken=False)
    except Exception:
        pass
    report("Готово", 100)
    return shortcut_error


def _spawn(dest: str, report_path: str) -> int:
    exe = os.path.join(dest, SELF_NAME)
    if not os.path.isfile(exe):
        raise RuntimeError("В папке программы нет FinMaster.exe")
    cmd = [exe]
    if report_path:
        cmd.append(report_path)
    subprocess.Popen(cmd, cwd=dest, close_fds=True)
    return 0


def _relaunch() -> None:
    subprocess.Popen([sys.executable, *sys.argv[1:]], close_fds=True)
    os._exit(0)


def _mark_installed(dest: str, sha: str, place: str, desktop: bool, start_menu: bool) -> None:
    cfg = storage.load_config()
    cfg["installed"] = True
    cfg["install_path"] = os.path.abspath(dest)
    cfg["install_commit"] = sha
    cfg["update_pending"] = False
    cfg["python_place"] = place
    cfg["install_shortcut_desktop"] = bool(desktop)
    cfg["install_shortcut_start"] = bool(start_menu)
    cfg["install_shortcuts"] = bool(desktop or start_menu)
    storage.save_config(cfg)
    _remove_manifest()


def _perform_install(dest: str, desktop: bool, start_menu: bool) -> str:
    """Скачивает файлы и возвращает текст ошибки ярлыка, если она была."""
    holder: dict[str, str] = {"sha": "", "shortcut": ""}

    def work(report: Callable[[str, float | None], None], stop: Callable[[], bool]) -> None:
        report("Смотрю последний коммит…", 12)
        sha, when = _remote_head(20)
        holder["sha"] = sha
        holder["when"] = when
        if stop():
            raise _Stop()
        report("Скачиваю файлы…", 16)
        _download_files(sha, dest, _snapshot_files(sha), report, stop, workers=40, retries=20)
        report("Копирую FinMaster.exe…", 86)
        _copy_self(dest)
        if desktop or start_menu:
            report("Создаю ярлыки…", 94)
            try:
                _make_shortcuts(dest, desktop=desktop, start_menu=start_menu)
            except Exception as exc:
                holder["shortcut"] = str(exc)
        saved = not holder["shortcut"]
        bundled = "bundled" if os.path.isfile(os.path.join(dest, "python", "pythonw.exe")) else ""
        _mark_installed(dest, sha, bundled, desktop and saved, start_menu and saved)
        _write_stamp(dest, when, broken=False)
        report("Готово", 100)

    _run_splash(_icon(_here()) or _icon(dest), "Скачиваю FinMaster…", work)
    return holder["shortcut"]


def _continue_here() -> None:
    global _skip_check
    _skip_check = True


def _first_install(report_path: str) -> int | None:
    default = _default_dir()
    while True:
        choice = _ask_install(default)
        if not choice:
            return 1
        dest = os.path.abspath(choice["path"])
        error = _path_error(dest)
        if error:
            _tell(error)
            default = dest
            continue
        existed = _nonempty(dest)
        os.makedirs(dest, exist_ok=True)
        try:
            shortcut_error = _perform_install(
                dest,
                bool(choice["desktop"]),
                bool(choice["start_menu"]),
            )
        except _Stop:
            if not existed and not os.path.isfile(os.path.join(dest, "run.vbs")):
                shutil.rmtree(dest, ignore_errors=True)
            return 1
        except Exception as exc:
            if not existed and not os.path.isfile(os.path.join(dest, "run.vbs")):
                shutil.rmtree(dest, ignore_errors=True)
            _tell(str(exc))
            default = dest
            continue
        if shortcut_error:
            _tell("Программа установлена, но ярлык не создался: " + shortcut_error)
        if _running_here(dest):
            _continue_here()
            return None
        return _spawn(dest, report_path)


def _resume_update(report_path: str) -> int | None:
    try:
        manifest = _read_manifest()
    except Exception as exc:
        _clear_pending()
        _tell(str(exc))
        path = _record()[1]
        if path and _running_here(path):
            _continue_here()
            return None
        return 1
    path = str(manifest["root"])
    recorded = _record()[1]
    if _unsafe(path) or (recorded and not _same(path, recorded)):
        _clear_pending()
        _tell("Файл обновления не совпадает с папкой программы")
        return 1
    place = _record()[4]
    shortcuts = bool(storage.load_config().get("install_shortcuts"))
    files = None if manifest["mode"] == "all" else list(manifest["files"])
    holder = {"shortcut": ""}

    def work(report: Callable[[str, float | None], None], stop: Callable[[], bool]) -> None:
        holder["shortcut"] = _pull(
            str(manifest["commit"]),
            path,
            files,
            place,
            shortcuts,
            report,
            stop,
            int(manifest["pid"] or 0),
        )

    try:
        _run_splash(_icon(path) or _icon(_here()), "Обновляю FinMaster…", work)
    except _Stop:
        _clear_pending()
        if _running_here(path):
            _continue_here()
            return None
        return 1
    except Exception as exc:
        _clear_pending()
        _tell(str(exc))
        if _running_here(path):
            _continue_here()
            return None
        return 1
    if holder["shortcut"]:
        _tell("Файлы обновлены, но ярлык не создался: " + holder["shortcut"])
    if not _running_here(path):
        return _spawn(path, report_path)
    _continue_here()
    return None


def _begin_update(path: str, sha: str, restore: bool, files: list[str] | None = None) -> None:
    if restore or files is None:
        mode, listed = "all", []
    else:
        listed = _without_self(files)
        if not listed:
            _save_commit(path, sha)
            _copy_self(path)
            return
        mode = "files"
    _write_manifest(mode, path, sha, listed, os.getpid())
    cfg = storage.load_config()
    cfg["update_pending"] = True
    cfg["install_path"] = os.path.abspath(path)
    storage.save_config(cfg)
    _relaunch()


def _rmtree_onerror(func: Callable[..., Any], path: str, _exc: Any) -> None:
    os.chmod(path, stat.S_IWRITE)
    func(path)


def _uninstall(path: str) -> None:
    if _unsafe(path):
        raise RuntimeError("Эту папку удалять нельзя")
    _remove_shortcuts()
    try:
        from backend.startup import set_windows_login

        set_windows_login(path, False)
    except Exception:
        pass
    if os.path.isdir(path):
        shutil.rmtree(path, onerror=_rmtree_onerror)
    if os.path.isdir(path):
        raise RuntimeError("Не удалось удалить папку. Закройте программу и повторите.")
    cfg = storage.load_config()
    cfg["installed"] = False
    cfg["install_path"] = ""
    cfg["install_commit"] = ""
    cfg["update_pending"] = False
    cfg["python_place"] = ""
    storage.save_config(cfg)
    _remove_manifest()


def _foreign_menu(path: str, report_path: str) -> int:
    while True:
        choice = _ask_menu(path)
        if not choice:
            return 1
        if choice == "launch":
            if not os.path.isfile(os.path.join(path, SELF_NAME)):
                _tell("В папке программы нет FinMaster.exe. Можно восстановить.")
                continue
            return _spawn(path, report_path)
        if choice == "delete":
            if not _ask_yes("Удалить FinMaster из этой папки? Отчёты в Документах останутся.", warning=True):
                continue
            _uninstall(path)
            return 0
        try:
            sha = _remote_sha(20)
        except Exception as exc:
            _tell(str(exc))
            continue
        _begin_update(path, sha, restore=True)


def _colors() -> dict[str, str]:
    return {
        "bg": "#e8eef4",
        "card": "#ffffff",
        "ink": "#0f172a",
        "muted": "#64748b",
        "line": "#dbe3ec",
        "accent": "#0f766e",
        "danger": "#dc2626",
    }


def _center(root: Any, width: int, height: int) -> None:
    root.update_idletasks()
    screen_w = root.winfo_screenwidth()
    screen_h = root.winfo_screenheight()
    x = max(0, (screen_w - width) // 2)
    y = max(0, (screen_h - height) // 3)
    root.geometry(f"{width}x{height}+{x}+{y}")
    root.resizable(False, False)


def _ask_install(default_path: str) -> dict[str, Any] | None:
    import tkinter as tk
    from tkinter import filedialog

    color = _colors()
    root = tk.Tk()
    root.title("FinMaster")
    _apply_logo(root)
    root.configure(bg=color["bg"])
    try:
        root.attributes("-topmost", True)
    except tk.TclError:
        pass
    _center(root, 520, 360)
    result: dict[str, Any] = {}
    pad = tk.Frame(root, bg=color["card"], highlightthickness=1, highlightbackground=color["line"])
    pad.pack(fill="both", expand=True, padx=16, pady=16)
    tk.Label(pad, text="Установка FinMaster", bg=color["card"], fg=color["ink"], font=("Segoe UI Semibold", 16)).pack(
        anchor="w", padx=22, pady=(18, 4)
    )
    tk.Label(
        pad,
        text="С GitHub скачаются только файлы последнего коммита. FinMaster.exe скопируется сам.",
        bg=color["card"],
        fg=color["muted"],
        font=("Segoe UI", 9),
        wraplength=450,
        justify="left",
    ).pack(anchor="w", padx=22, pady=(0, 12))
    tk.Label(pad, text="Папка программы", bg=color["card"], fg=color["ink"], font=("Segoe UI", 10)).pack(
        anchor="w", padx=22
    )
    row = tk.Frame(pad, bg=color["card"])
    row.pack(fill="x", padx=22, pady=(4, 8))
    path_var = tk.StringVar(value=default_path)
    entry = tk.Entry(row, textvariable=path_var, font=("Segoe UI", 10), relief="flat", highlightthickness=1)
    entry.configure(highlightbackground=color["line"], highlightcolor=color["accent"])
    entry.pack(side="left", fill="x", expand=True, ipady=4)

    def browse() -> None:
        current = path_var.get().strip().strip('"')
        parent = os.path.dirname(current) if os.path.basename(current).lower() == "finmaster" else current
        initial = parent if parent and os.path.isdir(parent) else os.path.dirname(default_path)
        picked = filedialog.askdirectory(parent=root, initialdir=initial or default_path, title="Куда установить FinMaster")
        if picked:
            path_var.set(_with_app_dir(picked))

    tk.Button(
        row,
        text="Обзор",
        command=browse,
        font=("Segoe UI", 10),
        bg=color["bg"],
        fg=color["ink"],
        relief="flat",
        padx=10,
    ).pack(side="left", padx=(8, 0))
    desktop_var = tk.BooleanVar(value=True)
    start_var = tk.BooleanVar(value=True)
    tk.Checkbutton(
        pad,
        text="Ярлык на рабочем столе",
        variable=desktop_var,
        bg=color["card"],
        fg=color["ink"],
        activebackground=color["card"],
        font=("Segoe UI", 10),
        anchor="w",
    ).pack(anchor="w", padx=22, pady=(4, 0))
    tk.Checkbutton(
        pad,
        text="Ярлык в меню Пуск",
        variable=start_var,
        bg=color["card"],
        fg=color["ink"],
        activebackground=color["card"],
        font=("Segoe UI", 10),
        anchor="w",
    ).pack(anchor="w", padx=22, pady=(0, 8))
    error_var = tk.StringVar(value="")
    tk.Label(pad, textvariable=error_var, bg=color["card"], fg=color["danger"], font=("Segoe UI", 9), wraplength=450).pack(
        anchor="w", padx=22, pady=(8, 0)
    )
    buttons = tk.Frame(pad, bg=color["card"])
    buttons.pack(fill="x", padx=22, pady=(8, 18))

    def accept() -> None:
        dest = _with_app_dir(path_var.get())
        path_var.set(dest)
        error = _path_error(dest)
        if error:
            error_var.set(error)
            return
        result["path"] = dest
        result["desktop"] = bool(desktop_var.get())
        result["start_menu"] = bool(start_var.get())
        root.destroy()

    def cancel() -> None:
        result.clear()
        root.destroy()

    tk.Button(
        buttons,
        text="Установить",
        command=accept,
        font=("Segoe UI Semibold", 10),
        bg=color["accent"],
        fg="#ffffff",
        activebackground=color["accent"],
        activeforeground="#ffffff",
        relief="flat",
        padx=14,
        pady=4,
    ).pack(side="right")
    tk.Button(
        buttons,
        text="Отмена",
        command=cancel,
        font=("Segoe UI", 10),
        bg=color["bg"],
        fg=color["ink"],
        relief="flat",
        padx=12,
        pady=4,
    ).pack(side="right", padx=(0, 8))
    root.protocol("WM_DELETE_WINDOW", cancel)
    entry.focus_set()
    root.mainloop()
    return result or None


def _ask_menu(path: str) -> str:
    import tkinter as tk

    color = _colors()
    root = tk.Tk()
    root.title("FinMaster")
    _apply_logo(root)
    root.configure(bg=color["bg"])
    try:
        root.attributes("-topmost", True)
    except tk.TclError:
        pass
    _center(root, 480, 230)
    result = {"choice": ""}
    pad = tk.Frame(root, bg=color["card"], highlightthickness=1, highlightbackground=color["line"])
    pad.pack(fill="both", expand=True, padx=16, pady=16)
    tk.Label(pad, text="FinMaster уже установлен", bg=color["card"], fg=color["ink"], font=("Segoe UI Semibold", 16)).pack(
        anchor="w", padx=22, pady=(18, 6)
    )
    tk.Label(
        pad,
        text=path,
        bg=color["card"],
        fg=color["muted"],
        font=("Segoe UI", 9),
        wraplength=410,
        justify="left",
    ).pack(anchor="w", padx=22)
    tk.Label(
        pad,
        text="Этот запуск не из папки программы.",
        bg=color["card"],
        fg=color["ink"],
        font=("Segoe UI", 10),
    ).pack(anchor="w", padx=22, pady=(8, 12))
    buttons = tk.Frame(pad, bg=color["card"])
    buttons.pack(fill="x", padx=22, pady=(0, 18))

    def choose(name: str) -> None:
        result["choice"] = name
        root.destroy()

    tk.Button(
        buttons,
        text="Запустить",
        command=lambda: choose("launch"),
        font=("Segoe UI Semibold", 10),
        bg=color["accent"],
        fg="#ffffff",
        relief="flat",
        padx=10,
        pady=4,
    ).pack(side="left")
    tk.Button(
        buttons,
        text="Обновить или восстановить",
        command=lambda: choose("update"),
        font=("Segoe UI", 10),
        bg=color["bg"],
        fg=color["ink"],
        relief="flat",
        padx=10,
        pady=4,
    ).pack(side="left", padx=8)
    tk.Button(
        buttons,
        text="Удалить",
        command=lambda: choose("delete"),
        font=("Segoe UI", 10),
        bg=color["card"],
        fg=color["danger"],
        relief="flat",
        padx=10,
        pady=4,
    ).pack(side="right")
    root.protocol("WM_DELETE_WINDOW", root.destroy)
    root.mainloop()
    return result["choice"]


def _update_wait() -> int | None:
    args = sys.argv[1:]
    if not args:
        return None
    flag = str(args[0] or "").strip().strip('"').lower()
    if flag not in {"/update", "-update", "--update"}:
        return None
    if len(args) > 1 and str(args[1]).strip().isdigit():
        return int(str(args[1]).strip())
    return 0


def _incremental_update(dest: str) -> bool:
    """Новая версия без пометки о повреждении: качаем только отличия."""
    if _broken_flag(dest):
        return False
    try:
        _sha, when = _remote_head(8)
    except Exception:
        return False
    remote = _parse_when(when)
    local = _parse_when(_read_stamp(dest))
    if local is None or remote is None:
        return False
    return remote > local


def _refresh_snapshot(dest: str, wait_pid: int, copy_exe: bool = True, full: bool = True) -> None:
    """full — весь снимок. Иначе только файлы, которых нет или которые отличаются."""

    def work(report: Callable[[str, float | None], None], stop: Callable[[], bool]) -> None:
        if wait_pid:
            report("Жду закрытия программы…", 8)
            _wait_pid(wait_pid, stop)
        if stop():
            raise _Stop()
        report("Смотрю последний коммит…", 12)
        sha, when = _remote_head(20)
        if stop():
            raise _Stop()
        if full:
            listed = _snapshot_files(sha)
            report("Скачиваю файлы…", 16)
        else:
            listed = _changed(dest, sha)
            report("Скачиваю изменённые файлы…" if listed else "Изменённых файлов нет…", 16)
        if listed:
            _download_files(sha, dest, listed, report, stop, workers=40, retries=20)
        if copy_exe:
            report("Копирую FinMaster.exe…", 90)
            _copy_self(dest)
        _write_stamp(dest, when, broken=False)
        _save_commit(dest, sha)
        report("Готово", 100)

    _run_splash(_icon(dest) or _icon(_here()), "Обновляю FinMaster…", work)


def update_folder(dest: str = "") -> None:
    """Снимок в папку программы. FinMaster.exe не подменяется: его вызывает update.vbs через уже стоящий Python."""
    dest = os.path.abspath(dest or os.environ.get("FM_UPDATE_DIR") or os.getcwd())
    if _repo_folder(dest):
        _tell("Это папка репозитория. Снимок с GitHub её не заменяет.")
        raise SystemExit(1)
    if not os.path.isfile(os.path.join(dest, "run.vbs")):
        _tell("Рядом нет установленной программы")
        raise SystemExit(1)
    try:
        _refresh_snapshot(dest, 0, copy_exe=False, full=not _incremental_update(dest))
    except _Stop:
        raise SystemExit(1)
    except SystemExit:
        raise
    except Exception as exc:
        _tell(str(exc))
        raise SystemExit(1)


def _apply_update(wait_pid: int) -> int | None:
    dest = _here()
    if _repo_folder(dest):
        _tell("Это папка репозитория. Снимок с GitHub её не заменяет.")
        _continue_here()
        return None
    if not os.path.isfile(os.path.join(dest, "run.vbs")):
        _tell("Рядом нет установленной программы")
        return 1
    try:
        _refresh_snapshot(dest, wait_pid, full=not _incremental_update(dest))
    except _Stop:
        return 1
    except Exception as exc:
        _tell(str(exc))
        return 1
    _continue_here()
    return None


def launch_update_script(root: str, pid: int) -> None:
    """Закрытие программы снаружи. Дальше качает сам update.vbs, без запуска FinMaster.exe."""
    root = os.path.abspath(root)
    if _repo_folder(root):
        raise RuntimeError("Это папка репозитория. Снимок с GitHub её не заменяет.")
    script = os.path.join(root, "update.vbs")
    if not os.path.isfile(script):
        raise RuntimeError("Рядом нет update.vbs")
    system = os.environ.get("SystemRoot") or r"C:\Windows"
    host = os.path.join(system, "System32", "wscript.exe")
    if not os.path.isfile(host):
        host = "wscript.exe"
    # Отвязать от окна: иначе скрипт умирает вместе с программой и exe не стартует.
    flags = 0x00000008 | 0x00000200
    command = [host, "//nologo", script, str(int(pid))]
    kwargs = {
        "cwd": root,
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "close_fds": True,
    }
    try:
        subprocess.Popen(command, creationflags=flags | 0x01000000, **kwargs)
    except OSError:
        subprocess.Popen(command, creationflags=flags, **kwargs)


def prepare(report_path: str = "") -> int | None:
    """None — можно запускать программу. Число — код выхода, запуск уже не нужен."""
    _remove_stale_exe()
    _dpi()
    try:
        waited = _update_wait()
        if waited is not None:
            return _apply_update(waited)
        installed, path, _commit, pending, _place = _record()
        if pending:
            return _resume_update(report_path)
        if not installed and not os.path.isfile(os.path.join(_here(), "run.vbs")):
            return _first_install(report_path)
        if not installed:
            return None
        if not _running_here(path):
            return _foreign_menu(path, report_path)
        return None
    except _Stop:
        return 1
    except Exception as exc:
        _tell(str(exc))
        return 1


def install_missing_vbs(report_path: str = "") -> int | None:
    """Снимок с GitHub. Только когда рядом с FinMaster.exe нет run.vbs."""
    _remove_stale_exe()
    _dpi()
    try:
        return _first_install(report_path)
    except _Stop:
        return 1


def offer_update() -> None:
    """При запуске ничего не спрашивает. Решение остаётся за кнопкой в окне."""
    return


def installed_year(root: str) -> int | None:
    """Год версии из первой строки commit.txt."""
    moment = _parse_when(_read_stamp(root))
    if moment is None:
        return None
    return moment.astimezone().year


def _local_version(root: str) -> str:
    """Дата из commit.txt. Если строка не разбирается, показываем её как есть."""
    raw = _read_stamp(root)
    label = _version_label(_parse_when(raw))
    if label:
        return label
    if raw and raw.lower() != _BROKEN_MARK:
        return raw
    return ""


def _version_label(moment: datetime | None) -> str:
    if moment is None:
        return ""
    local = moment.astimezone()
    months = (
        "января",
        "февраля",
        "марта",
        "апреля",
        "мая",
        "июня",
        "июля",
        "августа",
        "сентября",
        "октября",
        "ноября",
        "декабря",
    )
    return f"{local.day} {months[local.month - 1]} {local.year}, {local.hour:02d}:{local.minute:02d}"


def _readme_same(root: str) -> bool | None:
    """None — не удалось сверить. True — README.md в папке совпал с GitHub."""
    local = os.path.join(root, "README.md")
    if not os.path.isfile(local):
        return False
    try:
        payload = _read_json(f"{API}/contents/README.md", 8)
        remote_blob = str(payload.get("sha") or "").strip().lower()
        if not remote_blob:
            return None
        return _blob(local) == remote_blob
    except Exception:
        return None


def _quiet_old_exe(root: str, sha: str) -> None:
    installed, path, commit, _pending, _place = _record()
    if not installed or not _same(path, root) or commit == sha:
        return
    cfg = storage.load_config()
    cfg["install_commit"] = sha
    storage.save_config(cfg)


def _file_diff(root: str, sha: str = "") -> dict[str, Any]:
    """Файлы папки против коммита. FinMaster.exe и имена на точку не входят."""
    root = os.path.abspath(root)
    if not sha:
        sha, _when = _remote_head(12)
    files: list[dict[str, str]] = []
    for rel, blob in _tree(sha).items():
        if _hidden_entry(rel):
            continue
        local = _rel_target(root, rel)
        if not local:
            continue
        if not os.path.isfile(local):
            files.append({"path": rel, "kind": "missing"})
            continue
        try:
            same = _blob(local) == blob
        except OSError:
            files.append({"path": rel, "kind": "missing"})
            continue
        if not same:
            files.append({"path": rel, "kind": "changed"})
    files.sort(key=lambda item: item["path"])
    return {"ok": not files, "changed": len(files), "files": files}


def _settle_integrity(root: str, sha: str = "") -> bool:
    """Пока в commit.txt есть пометка, при запуске сверяем файлы и снимаем её, когда они совпали."""
    if not _broken_flag(root):
        return False
    try:
        result = _file_diff(root, sha)
    except Exception:
        return True
    if result["ok"]:
        _write_stamp(root, None, broken=False)
        return False
    return True


def check_integrity(root: str, remember: bool = False) -> dict[str, Any]:
    root = os.path.abspath(root)
    result = _file_diff(root)
    if remember:
        _write_stamp(root, None, broken=not result["ok"])
    return result


def update_status(root: str) -> dict[str, Any]:
    """Есть ли версия новее. Даты — для вопроса в окне, без номеров коммитов."""
    empty = {"available": False, "current": "", "latest": "", "damaged": False, "integrity": False}
    root = os.path.abspath(root)
    if _repo_folder(root):
        return {**empty, "enabled": False}
    if not os.path.isfile(os.path.join(root, "run.vbs")):
        return empty
    try:
        sha, when = _remote_head(4)
    except Exception:
        return {
            "available": False,
            "current": _local_version(root),
            "latest": "",
            "damaged": False,
            "integrity": _broken_flag(root),
            "offline": True,
        }
    remote = _parse_when(when)
    latest = _version_label(remote)
    local = _parse_when(_read_stamp(root))
    if local is None:
        matched = _readme_same(root)
        if matched is None:
            return {
                "available": False,
                "current": _local_version(root),
                "latest": latest,
                "damaged": False,
                "integrity": _settle_integrity(root, sha),
                "offline": True,
            }
        if matched:
            _write_stamp(root, when)
            _quiet_old_exe(root, sha)
            return {
                "available": False,
                "current": latest,
                "latest": latest,
                "damaged": False,
                "integrity": _settle_integrity(root, sha),
            }
        _quiet_old_exe(root, sha)
        return {
            "available": True,
            "current": "Вероятно, есть повреждённые файлы",
            "latest": latest,
            "damaged": True,
            "integrity": _settle_integrity(root, sha),
        }
    available = remote is not None and remote > local
    if available:
        _quiet_old_exe(root, sha)
    return {
        "available": available,
        "current": _version_label(local),
        "latest": latest,
        "damaged": False,
        "integrity": _settle_integrity(root, sha),
    }
