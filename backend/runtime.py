"""Python в папке FinMaster и выбор, чем запускать программу."""

from __future__ import annotations

import importlib.metadata as metadata
import json
import os
import re
import subprocess
import sys
import threading
import time
from typing import Any, Callable

from backend import storage


PACKAGE_NAMES = ("flask", "pywebview", "pillow")
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SCRIPT = os.path.join(_ROOT, "bootstrap_python.ps1")
_REQUIREMENTS = os.path.join(_ROOT, "requirements.txt")
_LOCK = threading.Lock()
_JOB: dict[str, Any] = {"running": False, "log": [], "error": "", "ok": False}
_CREATE_NO_WINDOW = 0x08000000


def runtime_dir() -> str:
    return os.path.join(storage.default_reports_dir(), "python")


def _state_dir() -> str:
    """Служебные файлы установки. Не в корне папки с отчётами."""
    base = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".config")
    folder = os.path.join(base, "FinMaster")
    os.makedirs(folder, exist_ok=True)
    return folder


def install_log_path() -> str:
    return os.path.join(_state_dir(), "python-install.log")


def _under(path: str, root: str) -> bool:
    try:
        return os.path.commonpath([os.path.abspath(path), os.path.abspath(root)]) == os.path.abspath(root)
    except ValueError:
        return False


def _console_exe(path: str) -> str:
    low = path.lower()
    if low.endswith("pythonw.exe"):
        alt = path[: -len("pythonw.exe")] + "python.exe"
        if os.path.isfile(alt):
            return alt
    return path


def _run(args: list[str], timeout: int = 20) -> subprocess.CompletedProcess[str]:
    kwargs: dict[str, Any] = {
        "capture_output": True,
        "text": True,
        "timeout": timeout,
        "errors": "replace",
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = _CREATE_NO_WINDOW
    return subprocess.run(args, **kwargs)


def _blank_packages(names: list[str] | tuple[str, ...] | None = None) -> list[dict[str, Any]]:
    return [{"name": name, "installed": False, "version": ""} for name in (names or PACKAGE_NAMES)]


def _local_packages(names: list[str] | tuple[str, ...] | None = None) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for name in names or PACKAGE_NAMES:
        try:
            found.append({"name": name, "installed": True, "version": metadata.version(name)})
        except metadata.PackageNotFoundError:
            found.append({"name": name, "installed": False, "version": ""})
    return found


def _probe_libraries(
    exe: str,
    pip_names: list[str] | tuple[str, ...],
    std_names: list[str] | tuple[str, ...],
) -> list[dict[str, Any]]:
    pip = [name for name in pip_names if _package_name(name)]
    std = [name for name in std_names if re.fullmatch(r"[a-z_][a-z0-9_]{0,40}", name)]
    code = (
        "import importlib, importlib.metadata as md, json\n"
        f"pip = json.loads({json.dumps(json.dumps(pip))})\n"
        f"std = json.loads({json.dumps(json.dumps(std))})\n"
        "out = []\n"
        "seen = set()\n"
        "for name in pip:\n"
        "    seen.add(name)\n"
        "    try:\n"
        "        out.append({'name': name, 'installed': True, 'version': md.version(name)})\n"
        "    except Exception:\n"
        "        out.append({'name': name, 'installed': False, 'version': ''})\n"
        "for name in std:\n"
        "    if name in seen:\n"
        "        continue\n"
        "    try:\n"
        "        mod = importlib.import_module(name)\n"
        "        ver = getattr(mod, 'TkVersion', '') or ''\n"
        "        out.append({'name': name, 'installed': True, 'version': str(ver)})\n"
        "    except Exception:\n"
        "        out.append({'name': name, 'installed': False, 'version': ''})\n"
        "print(json.dumps(out))\n"
    )
    blank = [{"name": name, "installed": False, "version": ""} for name in [*pip, *std]]
    try:
        proc = _run([_console_exe(exe), "-c", code], timeout=40)
    except (OSError, subprocess.TimeoutExpired):
        return blank
    if proc.returncode != 0:
        return blank
    try:
        parsed = json.loads(proc.stdout.strip() or "[]")
    except json.JSONDecodeError:
        return blank
    return parsed if isinstance(parsed, list) else blank


def _probe_packages(exe: str, names: list[str] | tuple[str, ...] | None = None) -> list[dict[str, Any]]:
    wanted = [name for name in (names or PACKAGE_NAMES) if _package_name(name)]
    if not wanted:
        wanted = list(PACKAGE_NAMES)
    code = (
        "import json, importlib.metadata as md\n"
        f"names = json.loads({json.dumps(json.dumps(wanted))})\n"
        "out = []\n"
        "for name in names:\n"
        "    try:\n"
        "        out.append({'name': name, 'installed': True, 'version': md.version(name)})\n"
        "    except Exception:\n"
        "        out.append({'name': name, 'installed': False, 'version': ''})\n"
        "print(json.dumps(out))\n"
    )
    try:
        proc = _run([_console_exe(exe), "-c", code], timeout=25)
    except (OSError, subprocess.TimeoutExpired):
        return [{"name": name, "installed": False, "version": ""} for name in wanted]
    if proc.returncode != 0:
        return [{"name": name, "installed": False, "version": ""} for name in wanted]
    try:
        parsed = json.loads(proc.stdout.strip() or "[]")
    except json.JSONDecodeError:
        return [{"name": name, "installed": False, "version": ""} for name in wanted]
    if not isinstance(parsed, list):
        return _blank_packages()
    return parsed


def _version_of(exe: str) -> str:
    try:
        proc = _run([_console_exe(exe), "-c", "import sys; print(sys.version.split()[0])"], timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    if proc.returncode != 0:
        return ""
    return proc.stdout.strip()


def _skip_store(path: str) -> bool:
    return "windowsapps" in path.replace("/", "\\").lower()


def _known_system_exes() -> list[str]:
    local = os.environ.get("LOCALAPPDATA") or ""
    program = os.environ.get("ProgramFiles") or ""
    found: list[str] = []
    for ver in ("314", "313", "312", "311", "310"):
        found.append(os.path.join(local, "Programs", "Python", f"Python{ver}", "pythonw.exe"))
        found.append(os.path.join(program, f"Python{ver}", "pythonw.exe"))
        found.append(os.path.join(rf"C:\Python{ver}", "pythonw.exe"))
    return found


def system_pythonw() -> str:
    """Интерпретатор системы, не копия рядом с программой и не копия в папке отчётов."""
    folder = runtime_dir()
    beside = program_python_dir()
    candidates: list[str] = []
    override = (os.environ.get("FINMASTER_PYTHONW") or "").strip()
    if override:
        candidates.append(override)
    for name in ("pythonw.exe", "python.exe", "pythonw", "python"):
        for part in os.environ.get("PATH", "").split(os.pathsep):
            if not part or _skip_store(part):
                continue
            candidates.append(os.path.join(part, name))
    candidates.extend(_known_system_exes())
    for path in candidates:
        if not path or not os.path.isfile(path) or _skip_store(path):
            continue
        if _under(path, folder) or _under(path, beside):
            continue
        return path if path.lower().endswith("pythonw.exe") else _console_exe(path)
    launcher = ""
    for part in os.environ.get("PATH", "").split(os.pathsep):
        if not part or _skip_store(part):
            continue
        candidate = os.path.join(part, "py.exe")
        if os.path.isfile(candidate):
            launcher = candidate
            break
    if not launcher:
        return ""
    try:
        proc = _run([launcher, "-3", "-c", "import sys; print(sys.executable)"], timeout=12)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    exe = (proc.stdout or "").strip()
    if proc.returncode != 0 or not exe or not os.path.isfile(exe) or _under(exe, folder) or _under(exe, beside):
        return ""
    return exe


def program_python_dir(project_root: str | None = None) -> str:
    """Python рядом с файлами программы, не в папке отчётов."""
    return os.path.join(project_root or _ROOT, "python")


def program_pythonw(project_root: str | None = None) -> str:
    path = os.path.join(program_python_dir(project_root), "pythonw.exe")
    return path if os.path.isfile(path) else ""


def using_program_python(project_root: str | None = None) -> bool:
    """Сейчас программа уже запущена копией Python из своей папки."""
    return bool(program_pythonw(project_root)) and _under(sys.executable, program_python_dir(project_root))


def folder_pythonw() -> str:
    path = os.path.join(runtime_dir(), "pythonw.exe")
    return path if os.path.isfile(path) else ""


def preference() -> str:
    mode = str(storage.load_config().get("python_runtime") or "folder")
    return mode if mode in {"system", "folder"} else "folder"


def _active() -> str:
    return "folder" if _under(sys.executable, runtime_dir()) else "system"


def _log_says_ready(lines: list[str]) -> bool:
    if not lines:
        return False
    tail = lines[-1].strip()
    if len(tail) > 8 and tail[2] == ":" and tail[5] == ":":
        tail = tail[9:].strip()
    return tail == "Готово"


def _read_log() -> list[str]:
    path = install_log_path()
    if not os.path.isfile(path):
        return []
    try:
        with open(path, encoding="utf-8-sig", errors="replace") as handle:
            lines = [line.rstrip() for line in handle if line.strip()]
    except OSError:
        return []
    return lines[-200:]


def job_snapshot() -> dict[str, Any]:
    with _LOCK:
        return {
            "running": bool(_JOB["running"]),
            "log": list(_JOB["log"]),
            "error": str(_JOB["error"] or ""),
            "ok": bool(_JOB["ok"]),
        }


def _publish_log() -> None:
    lines = _read_log()
    with _LOCK:
        _JOB["log"] = lines


def _powershell() -> str:
    root = os.environ.get("SystemRoot") or r"C:\Windows"
    path = os.path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    return path if os.path.isfile(path) else "powershell.exe"


_SKIP_SCAN = {".git", ".kilo", "build", "dist", "__pycache__", "node_modules", ".venv", "venv", "env", "python"}
# Имя в import не всегда совпадает с именем пакета в pip.
_IMPORT_TO_PACKAGE = {
    "pil": "pillow",
    "cv2": "opencv-python",
    "yaml": "pyyaml",
    "bs4": "beautifulsoup4",
    "sklearn": "scikit-learn",
    "dateutil": "python-dateutil",
    "dotenv": "python-dotenv",
    "webview": "pywebview",
    "win32api": "pywin32",
    "win32con": "pywin32",
    "win32gui": "pywin32",
    "pythoncom": "pywin32",
    "pywintypes": "pywin32",
}
_IMPORT_LINE = re.compile(
    r"(?m)^[ \t]*(?:from[ \t]+([A-Za-z_][A-Za-z0-9_]*)|import[ \t]+([A-Za-z_][A-Za-z0-9_\.]*(?:[ \t]*,[ \t]*[A-Za-z_][A-Za-z0-9_\.]*)*))"
)


def _package_name(raw: str) -> str:
    name = re.split(r"[<>=!;\[]", str(raw or "").split("#", 1)[0].strip(), maxsplit=1)[0].strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,40}", name):
        return ""
    return name


def _local_modules(project_root: str) -> set[str]:
    names: set[str] = set()
    try:
        entries = os.listdir(project_root)
    except OSError:
        return names
    for entry in entries:
        path = os.path.join(project_root, entry)
        if entry.endswith(".py") and os.path.isfile(path):
            names.add(entry[:-3].lower())
        elif os.path.isdir(path) and entry not in _SKIP_SCAN and not entry.startswith("."):
            names.add(entry.lower())
    return names


def _imported_modules(project_root: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for dirpath, dirnames, filenames in os.walk(project_root):
        dirnames[:] = [name for name in dirnames if name not in _SKIP_SCAN and not name.startswith(".")]
        for filename in filenames:
            if not filename.endswith(".py"):
                continue
            path = os.path.join(dirpath, filename)
            try:
                with open(path, encoding="utf-8", errors="ignore") as handle:
                    text = handle.read()
            except OSError:
                continue
            for match in _IMPORT_LINE.finditer(text):
                raw = match.group(1) or match.group(2) or ""
                for part in raw.split(","):
                    module = part.strip().split(".", 1)[0]
                    key = module.lower()
                    if not key or key in seen:
                        continue
                    seen.add(key)
                    found.append(module)
    return found


def _requirement_pins(project_root: str) -> dict[str, str]:
    """Версии из requirements.txt. Сам список библиотек отсюда не берётся."""
    pins: dict[str, str] = {}
    path = os.path.join(project_root, "requirements.txt")
    if not os.path.isfile(path):
        return pins
    try:
        with open(path, encoding="utf-8") as handle:
            lines = handle.readlines()
    except OSError:
        return pins
    for line in lines:
        spec = line.split("#", 1)[0].strip()
        name = _package_name(spec)
        if name and name not in pins:
            pins[name] = spec
    return pins


def _stdlib_names() -> set[str]:
    return {name.lower() for name in getattr(sys, "stdlib_module_names", ())}


def required_packages(project_root: str) -> list[str]:
    """Пакеты pip, которые реально импортируют py-файлы программы."""
    stdlib = _stdlib_names()
    local = _local_modules(project_root)
    ordered: list[str] = []
    for module in _imported_modules(project_root):
        key = module.lower()
        if key in stdlib or key in local:
            continue
        package = _IMPORT_TO_PACKAGE.get(key) or _package_name(key)
        if package and package not in ordered:
            ordered.append(package)
    return ordered or list(PACKAGE_NAMES)


def required_stdlib(project_root: str) -> list[str]:
    """Встроенные модули из файлов программы. tkinter нужен заставке всегда."""
    stdlib = _stdlib_names()
    local = _local_modules(project_root)
    ordered: list[str] = []
    for module in _imported_modules(project_root):
        key = module.lower()
        if key not in stdlib or key in local or key in ordered:
            continue
        ordered.append(key)
    if "tkinter" not in ordered:
        ordered.append("tkinter")
    return ordered


def stdlib_list_path(project_root: str) -> str:
    """Какие встроенные модули проверить у копии Python в папке FinMaster."""
    folder = _state_dir()
    path = os.path.join(folder, "stdlib.scan.txt")
    text = "\n".join(required_stdlib(project_root)) + "\n"
    try:
        with open(path, encoding="utf-8") as handle:
            current = handle.read()
    except OSError:
        current = ""
    if current != text:
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
    return path


def install_list_path(project_root: str) -> str:
    """Файл для pip: имена из файлов программы, версии — из requirements.txt, если они там есть."""
    pins = _requirement_pins(project_root)
    lines = [pins.get(name, name) for name in required_packages(project_root)]
    folder = _state_dir()
    path = os.path.join(folder, "requirements.scan.txt")
    text = "\n".join(lines) + "\n"
    try:
        with open(path, encoding="utf-8") as handle:
            current = handle.read()
    except OSError:
        current = ""
    if current != text:
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
    return path


def _missing_for(exe: str, project_root: str) -> list[str]:
    needed = required_packages(project_root)
    if not exe or not os.path.isfile(exe):
        return needed
    installed = {
        str(item.get("name") or "").lower()
        for item in _probe_packages(exe, needed)
        if item.get("installed")
    }
    return [name for name in needed if name not in installed]


def _missing_imports(exe: str, names: list[str]) -> list[str]:
    if not names:
        return []
    if not exe or not os.path.isfile(exe):
        return ["tkinter"] if "tkinter" in names else []
    code = (
        "import json\n"
        f"names = json.loads({json.dumps(json.dumps(names))})\n"
        "missing = []\n"
        "for name in names:\n"
        "    try:\n"
        "        __import__(name)\n"
        "    except Exception:\n"
        "        missing.append(name)\n"
        "print(json.dumps(missing))\n"
    )
    try:
        proc = _run([_console_exe(exe), "-c", code], timeout=40)
    except (OSError, subprocess.TimeoutExpired):
        return list(names)
    if proc.returncode != 0:
        return list(names)
    try:
        parsed = json.loads(proc.stdout.strip() or "[]")
    except json.JSONDecodeError:
        return list(names)
    if not isinstance(parsed, list):
        return list(names)
    return [str(name) for name in parsed if str(name) in names]


def missing_packages(project_root: str) -> list[str]:
    """Чего не хватает копии в папке: пакеты pip и встроенные модули вроде tkinter."""
    exe = os.path.join(runtime_dir(), "python.exe")
    pip = _missing_for(exe, project_root)
    if not os.path.isfile(exe):
        return pip
    found = list(pip)
    for name in _missing_imports(exe, required_stdlib(project_root)):
        if name not in found:
            found.append(name)
    return found


def missing_here(project_root: str) -> list[str]:
    return _missing_for(sys.executable, project_root)


def install_blocking(
    on_line: Callable[[str], None] | None = None,
    project_root: str | None = None,
) -> None:
    """Ставит Python и библиотеки в папку FinMaster. Без окна консоли."""
    if sys.platform != "win32":
        raise ValueError("Установка Python в папку FinMaster доступна в Windows")
    root = project_root or _ROOT
    script = os.path.join(root, "bootstrap_python.ps1")
    requirements = install_list_path(root)
    stdlib = stdlib_list_path(root)
    if not os.path.isfile(script):
        raise RuntimeError("Не найден bootstrap_python.ps1")
    log_path = install_log_path()
    try:
        os.remove(log_path)
    except OSError:
        pass
    cmd = [
        _powershell(),
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-Requirements",
        requirements,
        "-Stdlib",
        stdlib,
    ]
    kwargs: dict[str, Any] = {
        "cwd": root,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = _CREATE_NO_WINDOW
    try:
        proc = subprocess.Popen(cmd, **kwargs)
    except OSError as exc:
        raise RuntimeError(f"Не удалось запустить установку: {exc}") from exc
    seen = 0
    while proc.poll() is None:
        lines = _read_log()
        while seen < len(lines):
            if on_line:
                on_line(lines[seen])
            seen += 1
        _publish_log()
        time.sleep(0.12)
    lines = _read_log()
    while seen < len(lines):
        if on_line:
            on_line(lines[seen])
        seen += 1
    _publish_log()
    if proc.returncode != 0 and not _log_says_ready(lines):
        error = next((line for line in reversed(lines) if "ошибка" in line.lower()), "")
        raise RuntimeError(error or "Не удалось установить Python в папку FinMaster")


def _run_install() -> None:
    try:
        install_blocking()
    except Exception as exc:
        with _LOCK:
            _JOB["running"] = False
            _JOB["log"] = _read_log()
            _JOB["error"] = str(exc)
            _JOB["ok"] = False
        return
    with _LOCK:
        _JOB["running"] = False
        _JOB["log"] = _read_log()
        _JOB["error"] = ""
        _JOB["ok"] = True


def start_install() -> None:
    if sys.platform != "win32":
        raise ValueError("Установка Python в папку FinMaster доступна в Windows")
    with _LOCK:
        if _JOB["running"]:
            raise RuntimeError("Установка уже идёт")
        _JOB["running"] = True
        _JOB["log"] = []
        _JOB["error"] = ""
        _JOB["ok"] = False
    threading.Thread(target=_run_install, daemon=True).start()


def set_mode(mode: str) -> None:
    if program_pythonw():
        raise ValueError("Python лежит в папке программы, переключение недоступно")
    if mode not in {"system", "folder"}:
        raise ValueError("Неизвестный режим запуска")
    if mode == "system" and not system_pythonw():
        raise ValueError("В системе Python не найден")
    if mode == "folder" and not folder_pythonw():
        raise ValueError("Сначала установите Python в папку FinMaster")
    cfg = storage.load_config()
    cfg["python_runtime"] = mode
    storage.save_config(cfg)


def _same_install(left: str, right: str) -> bool:
    if not left or not right:
        return False
    return os.path.normcase(os.path.abspath(_console_exe(left))) == os.path.normcase(os.path.abspath(_console_exe(right)))


def _env_block(
    exe: str,
    *,
    local: bool,
    busy: bool,
    fallback: str,
    pip_names: list[str],
    std_names: list[str],
) -> dict[str, Any]:
    available = bool(exe) and os.path.isfile(exe)
    packages = _blank_packages([*pip_names, *std_names])
    version = ""
    if available and not busy:
        version = sys.version.split()[0] if local else _version_of(exe)
        packages = _probe_libraries(exe, pip_names, std_names)
    return {
        "available": available,
        "path": os.path.dirname(exe) if available else fallback,
        "exe": exe if available else "",
        "version": version,
        "packages": packages,
    }


def status() -> dict[str, Any]:
    job = job_snapshot()
    folder_exe = folder_pythonw()
    system_exe = system_pythonw()
    active = _active()
    stored = preference()
    can_switch = bool(system_exe)
    choice = stored if can_switch else "folder"
    pip_names = required_packages(_ROOT)
    std_names = ["tkinter"]
    folder_local = _same_install(sys.executable, folder_exe)
    system_local = _same_install(sys.executable, system_exe)
    restart = can_switch and choice != active and (choice != "folder" or bool(folder_exe))
    if not can_switch:
        note = "В системе Python не найден. Программа использует папку FinMaster, переключить нельзя."
    elif restart:
        note = "Новый выбор заработает после перезапуска FinMaster."
    elif not folder_exe:
        note = "Python в папке FinMaster ещё не скачан. Библиотеки ставятся туда же."
    else:
        note = "По умолчанию программа запускается из папки FinMaster. Библиотеки ставятся туда же."
    return {
        "platform": sys.platform,
        "active": active,
        "active_path": sys.executable,
        "active_version": sys.version.split()[0],
        "preference": choice,
        "can_switch": can_switch and not program_pythonw(),
        "runtime_choice": not program_pythonw(),
        "restart_needed": restart,
        "note": note,
        "folder": _env_block(
            folder_exe, local=folder_local, busy=job["running"], fallback=runtime_dir(), pip_names=pip_names, std_names=std_names
        ),
        "system": _env_block(
            system_exe, local=system_local, busy=False, fallback="", pip_names=pip_names, std_names=std_names
        ),
        "job": job,
    }
