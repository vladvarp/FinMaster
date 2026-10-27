"""Архив настроек .fms: zip с выбранными файлами из папки настроек."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import threading
import zipfile
from typing import Any, Callable

from backend import runtime, storage, voice


EXT = ".fms"
KIND = "finmaster-settings"
_MANIFEST = "manifest.json"
_SKIP = {
    "instance.json",
    "python-install.log",
    "startup.status",
    "requirements.scan.txt",
    "stdlib.scan.txt",
    "history",
    "config.yml",
    "secrets.bin",
    "python-pending",
}
_HEAD = (
    ("config.json", "config", "Настройки"),
    ("dictionary.fmwb", "dictionary", "Словарь"),
)
_VOICE = ("voice", "voice", "Голос")
_LOCK = threading.Lock()
_JOB: dict[str, Any] = {
    "running": False,
    "progress": 0,
    "text": "",
    "error": "",
    "ok": False,
    "config": False,
    "dictionary": False,
    "cancelled": False,
}


def job_snapshot() -> dict[str, Any]:
    with _LOCK:
        return dict(_JOB)


def list_parts(root: str | None = None) -> list[dict[str, Any]]:
    parts = [row for row in _parts_from_tree(root or storage.config_dir()) if row["id"] != "voice"]
    parts.extend(_voice_parts())
    python = _python_part()
    if python:
        parts.append(python)
    return parts


def inspect_archive(path: str) -> list[dict[str, Any]]:
    names = _archive_names(path)
    return _parts_from_archive(names, _archive_sizes(path, names), _manifest(path))


def apply_pending_python() -> None:
    """Дописывает файлы Python, которые были заняты во время импорта."""
    pending = os.path.join(storage.config_dir(), "python-pending")
    if not os.path.isdir(pending):
        return
    dest_root = runtime.runtime_dir()
    left = False
    for dirpath, _dirnames, filenames in os.walk(pending):
        for filename in filenames:
            src = os.path.join(dirpath, filename)
            rel = os.path.relpath(src, pending)
            dest = os.path.join(dest_root, rel)
            if not _inside(dest_root, dest):
                continue
            try:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                os.replace(src, dest)
            except OSError:
                left = True
    if not left:
        shutil.rmtree(pending, ignore_errors=True)


def start_export(dest: str, ids: list[str]) -> dict[str, Any]:
    root = storage.config_dir()
    chosen = _clean_ids(ids)
    if not chosen:
        raise ValueError("Отметьте, что положить в архив.")
    _begin("Упаковка…")

    def work() -> None:
        export_archive(root, dest, chosen, _tick)

    _start(work)
    return job_snapshot()


def start_import(src: str, ids: list[str]) -> dict[str, Any]:
    root = storage.config_dir()
    chosen = _clean_ids(ids)
    if not chosen:
        raise ValueError("Отметьте, что импортировать.")
    inspect_archive(src)
    _begin("Распаковка…")

    def work() -> None:
        flags = import_archive(root, src, chosen, _tick)
        if flags.get("config"):
            storage.reload_config()
        with _LOCK:
            _JOB["config"] = bool(flags.get("config"))
            _JOB["dictionary"] = bool(flags.get("dictionary"))
            if flags.get("python_pending"):
                _JOB["text"] = "Часть Python заменится после перезапуска"

    _start(work)
    return job_snapshot()


def export_archive(root: str, dest: str, ids: list[str], progress: Callable[[int, int], None] | None = None) -> None:
    chosen = set(_clean_ids(ids))
    files = [item for item in _files(root) if item[0] in chosen]
    if "python" in chosen:
        files.extend(_python_files())
    if not files:
        raise ValueError("В папке настроек нет отмеченных файлов.")
    dest = os.path.abspath(dest)
    parent = os.path.dirname(dest)
    if parent:
        os.makedirs(parent, exist_ok=True)
    total = sum(size for _part, _rel, _path, size in files) or 1
    done = 0
    if progress:
        progress(0, total)
    fd, tmp = tempfile.mkstemp(suffix=".fms", dir=parent or None)
    os.close(fd)
    try:
        with zipfile.ZipFile(tmp, "w") as archive:
            info = zipfile.ZipInfo(_MANIFEST)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.flag_bits |= 0x800
            archive.writestr(info, json.dumps(_manifest_body(chosen), ensure_ascii=False))
            for _part, rel, path, size in files:
                wrote = _write_member(archive, rel, path, size)
                done += wrote
                if progress:
                    progress(min(done, total), total)
        os.replace(tmp, dest)
    except Exception:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise
    if progress:
        progress(total, total)


def import_archive(root: str, src: str, ids: list[str], progress: Callable[[int, int], None] | None = None) -> dict[str, bool]:
    chosen = set(_clean_ids(ids))
    names = [name for name in _archive_names(src) if _pid_of_member(name) in chosen]
    if not names:
        raise ValueError("В архиве нет отмеченных файлов.")
    sizes = _archive_sizes(src, names)
    total = sum(sizes.get(name, 0) for name in names) or 1
    done = 0
    if progress:
        progress(0, total)
    os.makedirs(root, exist_ok=True)
    stage = tempfile.mkdtemp(prefix=".fms-in-", dir=root)
    flags = {"config": False, "dictionary": False, "python_pending": False}
    python_names = [name for name in names if name.startswith("python/")]
    names = [name for name in names if not name.startswith("python/")]
    try:
        if python_names:
            flags["python_pending"], wrote = _import_python(src, python_names)
            done += wrote
            if progress:
                progress(min(done, total), total)
        with zipfile.ZipFile(src, "r") as archive:
            for name in names:
                rel = name.replace("\\", "/")
                target = os.path.join(stage, *rel.split("/"))
                if not _inside(stage, target):
                    raise ValueError("Архив содержит недопустимый путь.")
                os.makedirs(os.path.dirname(target), exist_ok=True)
                wrote = _read_member(archive, name, target)
                done += wrote
                if progress:
                    progress(min(done, total), total)
        cfg = os.path.join(stage, "config.json")
        if os.path.isfile(cfg):
            try:
                with open(cfg, encoding="utf-8") as handle:
                    parsed = json.load(handle)
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                raise ValueError("Файл настроек в архиве повреждён.") from None
            if not isinstance(parsed, dict):
                raise ValueError("Файл настроек в архиве повреждён.")
        tops = sorted({name.split("/", 1)[0] for name in names})
        for name in tops:
            src_path = os.path.join(stage, name)
            dest = os.path.join(root, name)
            if not os.path.exists(src_path) or not _inside(root, dest):
                continue
            _swap(src_path, dest)
            if name == "config.json":
                flags["config"] = True
            elif name == "dictionary.fmwb":
                flags["dictionary"] = True
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    if progress:
        progress(total, total)
    return flags


def _begin(text: str) -> None:
    global _JOB
    with _LOCK:
        if _JOB["running"]:
            raise RuntimeError("Упаковка уже идёт.")
        _JOB = {
            "running": True,
            "progress": 0,
            "text": text,
            "error": "",
            "ok": False,
            "config": False,
            "dictionary": False,
            "cancelled": False,
        }


def _start(work: Callable[[], None]) -> None:
    def runner() -> None:
        try:
            work()
        except Exception as exc:
            with _LOCK:
                _JOB["running"] = False
                _JOB["ok"] = False
                _JOB["error"] = str(exc) or "Не удалось обработать архив."
            return
        with _LOCK:
            _JOB["running"] = False
            _JOB["ok"] = True
            _JOB["progress"] = 100
            if not str(_JOB.get("text") or "").startswith("Часть"):
                _JOB["text"] = "Готово"

    threading.Thread(target=runner, daemon=True).start()


def _tick(done: int, total: int) -> None:
    percent = 100 if total <= 0 else min(100, int(done * 100 / total))
    with _LOCK:
        _JOB["progress"] = percent


def _clean_ids(ids: list[str]) -> list[str]:
    out: list[str] = []
    for raw in ids or []:
        text = str(raw or "").strip()
        if text and text not in out:
            out.append(text)
    return out


def _safe_top(name: str) -> bool:
    if not name or name in (".", "..") or name.startswith("."):
        return False
    if name.lower() in _SKIP or name == _MANIFEST:
        return False
    low = name.lower()
    if low.endswith(".partial") or low.endswith(".fms") or low.endswith(".tmp") or low.endswith(".log"):
        return False
    if any(sep in name for sep in ("/", "\\", ":")):
        return False
    return True


def _part_id(name: str) -> str:
    for known, pid, _label in (*_HEAD, _VOICE):
        if name == known:
            return pid
    return "extra:" + name


def _pid_label(pid: str) -> str:
    for _name, known, label in (*_HEAD, _VOICE):
        if known == pid:
            return label
    if pid.startswith("extra:"):
        return pid.split(":", 1)[1]
    return pid


def _label(name: str) -> str:
    for known, _pid, label in (*_HEAD, _VOICE):
        if name == known:
            return label
    return name


def _default_on(pid: str) -> bool:
    return pid not in ("voice", "extra:cloudflared.exe") and not pid.startswith("voice:") and pid != "python"


def _parts_from_tree(root: str) -> list[dict[str, Any]]:
    if not os.path.isdir(root):
        return []
    present = {name: os.path.join(root, name) for name in os.listdir(root) if _safe_top(name)}
    ordered = [row[0] for row in _HEAD if row[0] in present]
    ordered += sorted((name for name in present if name not in {row[0] for row in _HEAD} and name != _VOICE[0]), key=str.lower)
    if _VOICE[0] in present:
        ordered.append(_VOICE[0])
    parts: list[dict[str, Any]] = []
    for name in ordered:
        pid = _part_id(name)
        size = _tree_size(present[name])
        parts.append(_part_row(pid, _label(name), size))
    return parts


def _parts_from_names(names: list[str], sizes: dict[str, int]) -> list[dict[str, Any]]:
    tops: dict[str, int] = {}
    for name in names:
        top = name.split("/", 1)[0]
        if not _safe_top(top):
            continue
        tops[top] = tops.get(top, 0) + sizes.get(name, 0)
    ordered = [row[0] for row in _HEAD if row[0] in tops]
    ordered += sorted((name for name in tops if name not in {row[0] for row in _HEAD} and name != _VOICE[0]), key=str.lower)
    if _VOICE[0] in tops:
        ordered.append(_VOICE[0])
    return [_part_row(_part_id(name), _label(name), tops[name]) for name in ordered]


def _part_row(pid: str, label: str, size: int, title: str = "", detail: str = "") -> dict[str, Any]:
    row = {"id": pid, "label": label, "on": _default_on(pid), "bytes": size, "size": _fmt_size(size)}
    if pid == "voice":
        row["title"] = "Папка voice. В архив не входит, пока галочка выключена."
    if title:
        row["title"] = title
    if detail:
        row["detail"] = detail
    return row


def _pid_of_member(name: str) -> str:
    parts = name.replace("\\", "/").split("/")
    top = parts[0]
    if top == "python":
        return "python"
    if top == "voice" and len(parts) > 1 and _safe_top(parts[1]):
        return "voice:" + parts[1]
    return _part_id(top)


def _manifest(path: str) -> dict[str, Any]:
    try:
        with zipfile.ZipFile(path, "r") as archive:
            raw = archive.read(_MANIFEST)
        meta = json.loads(raw.decode("utf-8"))
    except (OSError, KeyError, UnicodeDecodeError, json.JSONDecodeError, zipfile.BadZipFile):
        return {}
    return meta if isinstance(meta, dict) else {}


def _manifest_body(chosen: set[str]) -> dict[str, Any]:
    body: dict[str, Any] = {"kind": KIND, "version": 2}
    if "python" in chosen:
        summary = runtime.folder_summary()
        body["python"] = {
            "version": summary.get("version") or "",
            "packages": [
                {"name": item.get("name") or "", "version": item.get("version") or "", "installed": bool(item.get("installed"))}
                for item in summary.get("packages") or []
                if isinstance(item, dict)
            ],
        }
    models = []
    for pid in sorted(chosen):
        if not pid.startswith("voice:"):
            continue
        model_id = pid.split(":", 1)[1]
        models.append({"id": model_id, "label": _voice_label(model_id), "about": voice.describe(model_id)})
    if models:
        body["models"] = models
    return body


def _voice_label(model_id: str) -> str:
    for spec in voice.CATALOG:
        if spec["id"] == model_id:
            return f"Vosk · {spec['label']}"
    return f"Vosk · {model_id}"


def _voice_detail(model_id: str, meta: dict[str, Any] | None = None) -> str:
    about = ""
    if meta:
        for item in meta.get("models") or []:
            if isinstance(item, dict) and item.get("id") == model_id:
                about = str(item.get("about") or "")
                break
    if not about:
        about = voice.describe(model_id)
    return about


def _python_detail(meta: dict[str, Any] | None = None, live: dict[str, Any] | None = None) -> str:
    source = live or {}
    if meta and isinstance(meta.get("python"), dict):
        source = meta["python"]
    version = str(source.get("version") or "").strip()
    packages = []
    for item in source.get("packages") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "")
        if not name:
            continue
        if item.get("installed") is False:
            packages.append(f"нет {name}")
        else:
            ver = str(item.get("version") or "")
            packages.append(f"{name} {ver}".strip())
    bits = []
    if version:
        bits.append(f"Python {version}")
    if packages:
        bits.append(", ".join(packages))
    return " · ".join(bits)


def _voice_parts() -> list[dict[str, Any]]:
    root = os.path.join(storage.config_dir(), "voice")
    if not os.path.isdir(root):
        return []
    parts = []
    for name in sorted(os.listdir(root)):
        path = os.path.join(root, name)
        if not _safe_top(name) or not os.path.isdir(path):
            continue
        if not os.path.isdir(os.path.join(path, "am")) and name not in {spec["id"] for spec in voice.CATALOG}:
            continue
        size = _tree_size(path)
        detail = _voice_detail(name)
        parts.append(_part_row(f"voice:{name}", _voice_label(name), size, detail, detail))
    return parts


def _python_part() -> dict[str, Any] | None:
    summary = runtime.folder_summary()
    if not summary.get("available"):
        return None
    size = _tree_size(runtime.runtime_dir())
    detail = _python_detail(live=summary)
    return _part_row("python", "Python из папки отчётов", size, detail or "Папка Документы\\FinMaster\\python", detail)


def _voice_files(path: str) -> list[tuple[str, str, str, int]]:
    found: list[tuple[str, str, str, int]] = []
    root = storage.config_dir()
    for name in os.listdir(path):
        if not _safe_top(name):
            continue
        model_path = os.path.join(path, name)
        if not os.path.isdir(model_path):
            continue
        pid = "voice:" + name
        for dirpath, dirnames, filenames in os.walk(model_path):
            dirnames[:] = [item for item in dirnames if not item.startswith(".")]
            for filename in filenames:
                full = os.path.join(dirpath, filename)
                if not os.path.isfile(full) or not _inside(root, full):
                    continue
                rel = os.path.relpath(full, root).replace("\\", "/")
                found.append((pid, rel, full, os.path.getsize(full)))
    return found


def _python_files() -> list[tuple[str, str, str, int]]:
    root = runtime.runtime_dir()
    if not os.path.isfile(os.path.join(root, "pythonw.exe")) and not os.path.isfile(os.path.join(root, "python.exe")):
        return []
    found: list[tuple[str, str, str, int]] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [item for item in dirnames if not item.startswith(".")]
        for filename in filenames:
            full = os.path.join(dirpath, filename)
            if not os.path.isfile(full) or not _inside(root, full):
                continue
            rel = "python/" + os.path.relpath(full, root).replace("\\", "/")
            found.append(("python", rel, full, os.path.getsize(full)))
    return found


def _parts_from_archive(names: list[str], sizes: dict[str, int], meta: dict[str, Any]) -> list[dict[str, Any]]:
    buckets: dict[str, int] = {}
    for name in names:
        pid = _pid_of_member(name)
        buckets[pid] = buckets.get(pid, 0) + sizes.get(name, 0)
    ordered = [row[1] for row in _HEAD if row[1] in buckets]
    ordered += sorted((pid for pid in buckets if pid not in ordered and not pid.startswith("voice:") and pid != "python"), key=str.lower)
    ordered += sorted(pid for pid in buckets if pid.startswith("voice:"))
    if "python" in buckets:
        ordered.append("python")
    parts = []
    for pid in ordered:
        if pid.startswith("voice:"):
            model_id = pid.split(":", 1)[1]
            detail = _voice_detail(model_id, meta)
            parts.append(_part_row(pid, _voice_label(model_id), buckets[pid], detail, detail))
        elif pid == "python":
            detail = _python_detail(meta)
            parts.append(_part_row(pid, "Python из папки отчётов", buckets[pid], detail or "Папка Документы\\FinMaster\\python", detail))
        else:
            parts.append(_part_row(pid, _pid_label(pid), buckets[pid]))
    return parts


def _import_python(src: str, names: list[str]) -> tuple[bool, int]:
    dest_root = runtime.runtime_dir()
    pending_root = os.path.join(storage.config_dir(), "python-pending")
    pending = False
    wrote = 0
    with zipfile.ZipFile(src, "r") as archive:
        for name in names:
            rel = name.replace("\\", "/")
            tail = rel.split("/", 1)[1] if "/" in rel else ""
            if not tail or not _member_ok(rel):
                continue
            target = os.path.join(dest_root, *tail.split("/"))
            if not _inside(dest_root, target):
                raise ValueError("Архив содержит недопустимый путь.")
            fd, tmp = tempfile.mkstemp(prefix=".pyimp-", dir=storage.config_dir())
            os.close(fd)
            try:
                wrote += _read_member(archive, name, tmp)
                try:
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    shutil.copy2(tmp, target)
                except OSError:
                    pending = True
                    hold = os.path.join(pending_root, *tail.split("/"))
                    os.makedirs(os.path.dirname(hold), exist_ok=True)
                    shutil.copy2(tmp, hold)
            finally:
                if os.path.exists(tmp):
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass
    return pending, wrote


def _files(root: str) -> list[tuple[str, str, str, int]]:
    found: list[tuple[str, str, str, int]] = []
    if not os.path.isdir(root):
        return found
    for name in os.listdir(root):
        if not _safe_top(name):
            continue
        path = os.path.join(root, name)
        pid = _part_id(name)
        if os.path.isfile(path):
            if _inside(root, path):
                found.append((pid, name.replace("\\", "/"), path, os.path.getsize(path)))
            continue
        if name == "voice" and os.path.isdir(path):
            found.extend(_voice_files(path))
            continue
        if not os.path.isdir(path):
            continue
        for dirpath, dirnames, filenames in os.walk(path):
            dirnames[:] = [item for item in dirnames if item not in (".", "..") and not item.startswith(".")]
            for filename in filenames:
                full = os.path.join(dirpath, filename)
                if not os.path.isfile(full) or not _inside(root, full):
                    continue
                rel = os.path.relpath(full, root).replace("\\", "/")
                found.append((pid, rel, full, os.path.getsize(full)))
    return found


def _archive_names(path: str) -> list[str]:
    if not path or not os.path.isfile(path):
        raise ValueError("Архив не найден.")
    try:
        with zipfile.ZipFile(path, "r") as archive:
            raw = archive.read(_MANIFEST)
            names = [info.filename.replace("\\", "/") for info in archive.infolist() if not info.is_dir()]
    except (zipfile.BadZipFile, KeyError, OSError):
        raise ValueError("Это не архив настроек FinMaster.") from None
    try:
        meta = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        meta = None
    if not isinstance(meta, dict) or meta.get("kind") != KIND:
        raise ValueError("Это не архив настроек FinMaster.")
    clean = []
    for name in names:
        if name == _MANIFEST or not _member_ok(name):
            continue
        clean.append(name)
    if len(clean) > 10000:
        raise ValueError("В архиве слишком много файлов.")
    return clean


def _archive_sizes(path: str, names: list[str]) -> dict[str, int]:
    wanted = set(names)
    sizes: dict[str, int] = {}
    with zipfile.ZipFile(path, "r") as archive:
        total = 0
        for info in archive.infolist():
            name = info.filename.replace("\\", "/")
            if name not in wanted:
                continue
            total += max(0, info.file_size)
            sizes[name] = max(0, info.file_size)
            if total > 8_000_000_000:
                raise ValueError("Архив слишком большой.")
    return sizes


def _member_ok(name: str) -> bool:
    rel = name.replace("\\", "/").lstrip("/")
    if not rel or rel.startswith("../") or "/../" in f"/{rel}/":
        return False
    parts = rel.split("/")
    if any(part in ("", ".", "..") for part in parts):
        return False
    return _safe_top(parts[0])


def _inside(root: str, path: str) -> bool:
    try:
        base = os.path.abspath(root)
        full = os.path.abspath(path)
        return os.path.commonpath([base, full]) == base
    except ValueError:
        return False


def _tree_size(path: str) -> int:
    if os.path.isfile(path):
        return os.path.getsize(path)
    total = 0
    for dirpath, dirnames, filenames in os.walk(path):
        dirnames[:] = [item for item in dirnames if not item.startswith(".")]
        for filename in filenames:
            full = os.path.join(dirpath, filename)
            try:
                total += os.path.getsize(full)
            except OSError:
                continue
    return total


def _fmt_size(size: int) -> str:
    if size < 1024:
        return f"{size} Б"
    if size < 1024 * 1024:
        return f"{max(1, round(size / 1024))} КБ"
    if size < 1024 * 1024 * 1024:
        return f"{size / (1024 * 1024):.1f} МБ".replace(".0 МБ", " МБ").replace(".", ",")
    return f"{size / (1024 * 1024 * 1024):.1f} ГБ".replace(".0 ГБ", " ГБ").replace(".", ",")


def _write_member(archive: zipfile.ZipFile, rel: str, path: str, size: int) -> int:
    info = zipfile.ZipInfo(rel)
    info.compress_type = zipfile.ZIP_STORED if size > 2_000_000 else zipfile.ZIP_DEFLATED
    info.flag_bits |= 0x800
    wrote = 0
    with archive.open(info, "w") as dest, open(path, "rb") as src:
        while True:
            chunk = src.read(256 * 1024)
            if not chunk:
                break
            dest.write(chunk)
            wrote += len(chunk)
    return wrote


def _read_member(archive: zipfile.ZipFile, name: str, target: str) -> int:
    wrote = 0
    with archive.open(name, "r") as src, open(target, "wb") as dest:
        while True:
            chunk = src.read(256 * 1024)
            if not chunk:
                break
            dest.write(chunk)
            wrote += len(chunk)
    return wrote


def _swap(src: str, dest: str) -> None:
    """Кладёт только пришедшие файлы. Соседние файлы в папке не удаляет."""
    if os.path.isdir(src):
        for dirpath, _dirnames, filenames in os.walk(src):
            rel = os.path.relpath(dirpath, src)
            target_dir = dest if rel == "." else os.path.join(dest, rel)
            os.makedirs(target_dir, exist_ok=True)
            for filename in filenames:
                _replace_file(os.path.join(dirpath, filename), os.path.join(target_dir, filename))
        return
    _replace_file(src, dest)


def _replace_file(src: str, dest: str) -> None:
    parent = os.path.dirname(dest)
    if parent:
        os.makedirs(parent, exist_ok=True)
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    os.replace(src, dest)
