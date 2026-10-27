"""Голос в Telegram: запись разбирается на этом компьютере.

Модель русского языка скачивается один раз в папку настроек FinMaster.
Дальше интернет для распознавания не нужен, аудио никуда не отправляется.
"""

from __future__ import annotations

import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import threading
import wave
import zipfile
from html.parser import HTMLParser
from typing import Any, Callable
from urllib.parse import unquote

from backend import storage

MODEL_NAME = "vosk-model-small-ru-0.22"
CATALOG = (
    {
        "id": "vosk-model-small-ru-0.22",
        "code": "s",
        "label": "Малая русская",
        "bytes": 45 * 1024 * 1024,
        "about": "Короткие команды, номера и простые фразы. Подходит слабому компьютеру. Имена и длинная речь разбираются хуже.",
        "url": "https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip",
    },
    {
        "id": "vosk-model-ru-0.22",
        "code": "r",
        "label": "Русская 0.22",
        "bytes": 1500 * 1024 * 1024,
        "about": "Обычная речь и более длинные фразы. Точнее малой модели, дольше скачивается и грузится.",
        "url": "https://alphacephei.com/vosk/models/vosk-model-ru-0.22.zip",
    },
    {
        "id": "vosk-model-ru-0.42",
        "code": "b",
        "label": "Русская 0.42",
        "bytes": 1800 * 1024 * 1024,
        "about": "Самая точная русская модель. Для длинных голосовых, имён и шумной записи. Нужны место на диске и время на первую загрузку.",
        "url": "https://alphacephei.com/vosk/models/vosk-model-ru-0.42.zip",
    },
)
_model = None
_model_path = ""
_MODEL_LOCK = threading.Lock()
_RECOGNIZE_LOCK = threading.Lock()
_SIZE_CACHE: dict[str, int] = {}
_JOB_LOCK = threading.Lock()
_JOB: dict[str, Any] = {
    "running": False,
    "progress": 0,
    "text": "",
    "error": "",
    "ok": False,
    "cancelled": False,
    "model": "",
}
_CANCEL = threading.Event()
_RESPONSE: Any = None
_SITE_URL = "https://alphacephei.com/vosk/models"
_SITE_LOCK = threading.Lock()
_SITE: dict[str, Any] = {"at": 0.0, "models": []}
_SITE_TTL = 6 * 60 * 60


class VoiceError(RuntimeError):
    pass


class DownloadCancelled(Exception):
    pass


class RecognizeCancelled(Exception):
    """Разбор записи остановлен кнопкой."""


def model_ready(model_id: str = "") -> bool:
    return os.path.isdir(os.path.join(_model_dir(model_id or active_id()), "am"))


def require() -> None:
    """Пакеты ставятся при запуске FinMaster. Без них голос не разобрать."""
    for name in ("vosk", "imageio_ffmpeg"):
        try:
            __import__(name)
        except ImportError as exc:
            raise VoiceError(
                "Распознавание ещё не установлено. Перезапустите FinMaster — библиотека поставится сама. Пока напишите вопрос текстом."
            ) from exc


def transcribe(
    data: bytes,
    on_progress: Callable[[float, str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
) -> str:
    if not data:
        raise VoiceError("Пустая запись. Напишите вопрос текстом.")
    require()
    if should_stop and should_stop():
        raise RecognizeCancelled()
    path = ensure_model(on_progress, should_stop)
    if should_stop and should_stop():
        raise RecognizeCancelled()
    if on_progress:
        on_progress(0.94, "Разбираю запись…")
    wav = _to_wav(data, should_stop)
    if on_progress:
        on_progress(0.98, "Распознаю речь…")
    text = _recognize_cancellable(path, wav, should_stop) if should_stop else _recognize(path, wav)
    if should_stop and should_stop():
        raise RecognizeCancelled()
    return spoken_digits(text)


def ensure_model(
    on_progress: Callable[[float, str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
) -> str:
    return ensure_model_id(active_id(), on_progress, should_stop)


def ensure_model_id(
    model_id: str,
    on_progress: Callable[[float, str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
    on_response: Callable[[Any], None] | None = None,
) -> str:
    spec = _spec(model_id)
    if spec is None:
        raise VoiceError("Такой модели речи нет.")
    path = _model_dir(spec["id"])
    if os.path.isdir(os.path.join(path, "am")):
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".zip"
    try:
        request = urllib.request.Request(str(spec["url"]), headers={"User-Agent": "FinMaster"})
        with urllib.request.urlopen(request, timeout=120) as response:
            if on_response:
                on_response(response)
            try:
                total = int(response.headers.get("Content-Length") or 0) or int(spec["bytes"])
                if total > 0:
                    _SIZE_CACHE[str(spec["url"])] = total
                with open(tmp, "wb") as handle:
                    done = 0
                    while True:
                        if should_stop and should_stop():
                            raise DownloadCancelled()
                        chunk = response.read(256 * 1024)
                        if not chunk:
                            break
                        handle.write(chunk)
                        done += len(chunk)
                        if on_progress and total > 0:
                            on_progress(
                                min(0.72, done / total * 0.72),
                                f"Скачиваю {spec['label']}: {_fmt_size(done)} из {_fmt_size(total)}",
                            )
            finally:
                if on_response:
                    on_response(None)
        if on_progress:
            on_progress(0.74, f"Распаковываю {spec['label']}…")
        with zipfile.ZipFile(tmp) as archive:
            entries = [info for info in archive.infolist() if info.filename.replace("\\", "/")]
            total_files = max(len(entries), 1)
            for index, info in enumerate(entries):
                if should_stop and should_stop():
                    raise DownloadCancelled()
                name = info.filename.replace("\\", "/")
                if not name or name.startswith("/") or ".." in name.split("/"):
                    continue
                dest = os.path.join(storage.config_dir(), "voice", name)
                if name.endswith("/"):
                    os.makedirs(dest, exist_ok=True)
                    continue
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with archive.open(info) as source, open(dest, "wb") as target:
                    shutil.copyfileobj(source, target)
                if on_progress:
                    on_progress(0.74 + (index + 1) / total_files * 0.18, f"Распаковываю {spec['label']}…")
    except DownloadCancelled:
        _drop_partial(path)
        raise
    except (OSError, urllib.error.URLError, zipfile.BadZipFile, TimeoutError) as exc:
        if should_stop and should_stop():
            _drop_partial(path)
            raise DownloadCancelled() from exc
        raise VoiceError(
            "Не удалось скачать распознавание речи. Проверьте интернет и пришлите голос ещё раз. Текст можно написать сразу."
        ) from exc
    finally:
        if os.path.isfile(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass
    if not os.path.isdir(os.path.join(path, "am")):
        raise VoiceError("Модель речи скачалась не полностью. Пришлите голос ещё раз.")
    return path


def active_id() -> str:
    raw = str(storage.load_config().get("voice_model") or MODEL_NAME).strip()
    if _spec(raw) or model_ready(raw):
        return raw or MODEL_NAME
    return MODEL_NAME


def set_active(model_id: str) -> str:
    spec = _spec(model_id) or ({"id": model_id} if model_ready(model_id) else None)
    if spec is None or not model_ready(str(spec["id"])):
        raise VoiceError("Сначала скачайте эту модель.")
    chosen = str(spec["id"])
    cfg = storage.load_config()
    cfg["voice_model"] = chosen
    storage.save_config(cfg)
    global _model, _model_path
    with _MODEL_LOCK:
        _model = None
        _model_path = ""
    return chosen


def remove_model(model_id: str) -> None:
    spec = _spec(model_id)
    chosen = str(spec["id"]) if spec else str(model_id or "").strip()
    if not chosen or chosen in {".", ".."} or any(char in chosen for char in "/\\:"):
        raise VoiceError("Такой модели нет.")
    root = os.path.abspath(os.path.join(storage.config_dir(), "voice"))
    path = os.path.abspath(os.path.join(root, chosen))
    try:
        inside = os.path.commonpath([root, path]) == root
    except ValueError:
        inside = False
    if not inside:
        raise VoiceError("Такой модели нет.")
    if not model_ready(chosen):
        raise VoiceError("Эта модель не скачана.")
    job = job_snapshot()
    if job.get("running") and str(job.get("model") or "") == chosen:
        raise VoiceError("Сначала отмените скачивание.")
    global _model, _model_path
    with _MODEL_LOCK:
        if os.path.normcase(_model_path) == os.path.normcase(path):
            _model = None
            _model_path = ""
    cfg = storage.load_config()
    if str(cfg.get("voice_model") or "") == chosen:
        cfg["voice_model"] = ""
        storage.save_config(cfg)
    zip_path = path + ".zip"
    if os.path.isfile(zip_path):
        try:
            os.remove(zip_path)
        except OSError:
            pass
    try:
        shutil.rmtree(path)
    except OSError as exc:
        raise VoiceError("Модель занята. Повторите удаление через минуту.") from exc
    _forget(chosen)


def describe(model_id: str) -> str:
    spec = _spec(model_id)
    if spec:
        return str(spec["about"])
    return "Своя модель из папки voice. Программа использует её, если она выбрана рабочей."


def code_of(model_id: str) -> str:
    spec = _spec(model_id)
    return str(spec["code"]) if spec else ""


def id_of(code: str) -> str:
    key = str(code or "").strip()
    for spec in CATALOG:
        if spec["code"] == key:
            return str(spec["id"])
    if _safe_id(key):
        return key
    return ""


def more_models() -> dict[str, Any]:
    """Модели с сайта Vosk, кроме трёх русских из основного списка. Только для окна на компьютере."""
    error = ""
    try:
        rows = _load_site()
    except VoiceError as exc:
        rows = _site_file()
        error = str(exc) if not rows else ""
    builtin = {str(item["id"]) for item in CATALOG}
    current = active_id()
    models: list[dict[str, Any]] = []
    for spec in rows:
        if str(spec.get("id") or "") in builtin:
            continue
        row = _row(spec, current)
        row["lang"] = str(spec.get("lang") or "")
        models.append(row)
    payload: dict[str, Any] = {"models": models, "job": job_snapshot()}
    if error:
        payload["error"] = error
    elif not models and not rows:
        payload["error"] = "Список с сайта пуст."
    return payload


def job_snapshot() -> dict[str, Any]:
    with _JOB_LOCK:
        return dict(_JOB)


def cancel_download() -> dict[str, Any]:
    with _JOB_LOCK:
        running = bool(_JOB.get("running"))
        response = _RESPONSE
        if running:
            _JOB["text"] = "Отмена…"
    if not running:
        return job_snapshot()
    _CANCEL.set()
    if response is not None:
        try:
            response.close()
        except OSError:
            pass
    return job_snapshot()


def start_download(model_id: str) -> dict[str, Any]:
    spec = _spec(model_id)
    if spec is None:
        try:
            _load_site()
        except VoiceError:
            pass
        spec = _spec(model_id)
    if spec is None:
        raise VoiceError("Такой модели речи нет.")
    if not any(str(item["id"]) == str(spec["id"]) for item in CATALOG):
        _remember(spec)
    if model_ready(str(spec["id"])):
        with _JOB_LOCK:
            _JOB.update(running=False, progress=100, text="Уже скачана", error="", ok=True, cancelled=False, model=str(spec["id"]))
        return job_snapshot()
    with _JOB_LOCK:
        if _JOB["running"]:
            raise RuntimeError("Скачивание уже идёт.")
        _CANCEL.clear()
        _JOB.update(
            running=True,
            progress=0,
            text=f"Скачиваю {spec['label']}…",
            error="",
            ok=False,
            cancelled=False,
            model=str(spec["id"]),
        )

    def work() -> None:
        def tick(ratio: float, text: str) -> None:
            with _JOB_LOCK:
                _JOB["progress"] = max(0, min(100, int(ratio * 100)))
                _JOB["text"] = text

        def stopped() -> bool:
            return _CANCEL.is_set()

        def bind_response(response: Any) -> None:
            global _RESPONSE
            with _JOB_LOCK:
                _RESPONSE = response

        try:
            ensure_model_id(str(spec["id"]), tick, stopped, bind_response)
        except DownloadCancelled:
            with _JOB_LOCK:
                _JOB.update(running=False, ok=False, cancelled=True, error="", progress=0, text="Отменено")
            return
        except Exception as exc:
            with _JOB_LOCK:
                _JOB.update(running=False, ok=False, cancelled=False, error=str(exc) or "Не удалось скачать модель.", text="Ошибка")
            return
        with _JOB_LOCK:
            _JOB.update(running=False, ok=True, cancelled=False, progress=100, text="Готово", error="")

    threading.Thread(target=work, daemon=True).start()
    return job_snapshot()


def catalog() -> dict[str, Any]:
    current = active_id()
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for spec in CATALOG:
        seen.add(str(spec["id"]))
        rows.append(_row(spec, current))
    root = os.path.join(storage.config_dir(), "voice")
    if os.path.isdir(root):
        for name in sorted(os.listdir(root)):
            if name in seen or not model_ready(name):
                continue
            saved = _added().get(name)
            rows.append(_row(saved, current) if saved else _row(
                {"id": name, "code": "", "label": name, "bytes": 0, "about": describe(name), "url": ""},
                current,
            ))
    return {"active": current, "models": rows, "job": job_snapshot()}


def _row(spec: dict[str, Any], current: str) -> dict[str, Any]:
    model_id = str(spec["id"])
    ready = model_ready(model_id)
    size = int(spec.get("bytes") or 0)
    if size <= 0 and spec.get("url"):
        size = _download_size(spec)
    elif size <= 0:
        size = _dir_size(_model_dir(model_id))
    code = str(spec.get("code") or "")
    if not code and _safe_id(model_id):
        code = model_id
    return {
        "id": model_id,
        "code": code,
        "label": str(spec.get("label") or model_id),
        "about": str(spec.get("about") or ""),
        "bytes": size,
        "size": _fmt_size(size),
        "ready": ready,
        "active": ready and model_id == current,
    }


def _spec(model_id: str) -> dict[str, Any] | None:
    key = str(model_id or "").strip()
    for spec in CATALOG:
        if spec["id"] == key or spec["code"] == key:
            return spec
    saved = _added().get(key)
    if saved:
        return saved
    for spec in _site_memory():
        if spec.get("id") == key:
            return spec
    return None


def _safe_id(model_id: str) -> bool:
    return bool(re.fullmatch(r"vosk-model-[A-Za-z0-9._-]{1,80}", str(model_id or "")))


def _added_path() -> str:
    return os.path.join(storage.config_dir(), "voice", "added.json")


def _added() -> dict[str, dict[str, Any]]:
    path = _added_path()
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, encoding="utf-8") as handle:
            raw = json.load(handle)
    except (OSError, json.JSONDecodeError, UnicodeError):
        return {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for key, item in raw.items():
        if _safe_id(str(key)) and isinstance(item, dict):
            out[str(key)] = item
    return out


def _remember(spec: dict[str, Any]) -> None:
    model_id = str(spec.get("id") or "")
    if not _safe_id(model_id):
        return
    data = _added()
    data[model_id] = {
        "id": model_id,
        "code": "",
        "label": str(spec.get("label") or model_id),
        "bytes": int(spec.get("bytes") or 0),
        "about": str(spec.get("about") or ""),
        "url": str(spec.get("url") or ""),
        "lang": str(spec.get("lang") or ""),
    }
    path = _added_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False)
    os.replace(tmp, path)


def _forget(model_id: str) -> None:
    data = _added()
    if model_id not in data:
        return
    data.pop(model_id, None)
    path = _added_path()
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False)
    os.replace(tmp, path)


def _site_path() -> str:
    return os.path.join(storage.config_dir(), "voice", "site.json")


def _site_memory() -> list[dict[str, Any]]:
    with _SITE_LOCK:
        return list(_SITE.get("models") or [])


def _site_file() -> list[dict[str, Any]]:
    path = _site_path()
    if not os.path.isfile(path):
        return []
    try:
        with open(path, encoding="utf-8") as handle:
            raw = json.load(handle)
    except (OSError, json.JSONDecodeError, UnicodeError):
        return []
    rows = raw.get("models") if isinstance(raw, dict) else None
    if not isinstance(rows, list):
        return []
    return [item for item in rows if isinstance(item, dict) and _safe_id(str(item.get("id") or ""))]


def _load_site() -> list[dict[str, Any]]:
    now = time.time()
    with _SITE_LOCK:
        cached = list(_SITE.get("models") or [])
        fresh = cached and now - float(_SITE.get("at") or 0) < _SITE_TTL
    if fresh:
        return cached
    try:
        request = urllib.request.Request(_SITE_URL, headers={"User-Agent": "FinMaster"})
        with urllib.request.urlopen(request, timeout=20) as response:
            page = response.read().decode("utf-8", "replace")
        models = _parse_site(page)
        if not models:
            raise VoiceError("Список с сайта пуст.")
    except VoiceError:
        raise
    except (OSError, urllib.error.URLError, TimeoutError, ValueError) as exc:
        stored = _site_file()
        if stored:
            with _SITE_LOCK:
                _SITE["models"] = stored
                _SITE["at"] = now
            return stored
        raise VoiceError("Список с сайта не открылся. Проверьте интернет.") from exc
    with _SITE_LOCK:
        _SITE["models"] = models
        _SITE["at"] = now
    try:
        path = _site_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump({"at": now, "models": models}, handle, ensure_ascii=False)
        os.replace(tmp, path)
    except OSError:
        pass
    return models


class _SiteTable(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[tuple[str, str]]] = []
        self._in_tr = False
        self._in_td = False
        self._cells: list[tuple[str, str]] = []
        self._buf: list[str] = []
        self._href = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._in_tr = True
            self._cells = []
        elif tag == "td" and self._in_tr:
            self._in_td = True
            self._buf = []
            self._href = ""
        elif tag == "a" and self._in_td and not self._href:
            href = dict(attrs).get("href") or ""
            if href.endswith(".zip"):
                self._href = href

    def handle_endtag(self, tag: str) -> None:
        if tag == "td" and self._in_td:
            self._cells.append((" ".join("".join(self._buf).split()), self._href))
            self._in_td = False
        elif tag == "tr" and self._in_tr:
            self._in_tr = False
            if self._cells:
                self.rows.append(self._cells)

    def handle_data(self, data: str) -> None:
        if self._in_td:
            self._buf.append(data)


def _parse_human(text: str) -> int:
    match = re.match(r"([\d.]+)\s*([kmgt])b?", str(text or "").strip().lower().replace(",", "."))
    if not match:
        return 0
    mult = {"k": 1024, "m": 1024**2, "g": 1024**3, "t": 1024**4}[match.group(2)]
    try:
        return int(float(match.group(1)) * mult)
    except ValueError:
        return 0


def _parse_site(page: str) -> list[dict[str, Any]]:
    table = _SiteTable()
    table.feed(page)
    lang = ""
    models: list[dict[str, Any]] = []
    for cells in table.rows:
        text, href = cells[0]
        if not href:
            if text:
                lang = text
            continue
        name = unquote(href.rsplit("/", 1)[-1])
        if name.lower().endswith(".zip"):
            name = name[:-4]
        if not _safe_id(name):
            continue
        notes = cells[3][0] if len(cells) > 3 else ""
        url = href if href.startswith("http") else f"https://alphacephei.com{href}"
        models.append({
            "id": name,
            "code": "",
            "label": f"{lang} · {name}" if lang else name,
            "bytes": _parse_human(cells[1][0] if len(cells) > 1 else ""),
            "about": notes[:400],
            "url": url,
            "lang": lang,
        })
    return models


def _download_size(spec: dict[str, Any]) -> int:
    url = str(spec.get("url") or "")
    if url in _SIZE_CACHE:
        return _SIZE_CACHE[url]
    fallback = int(spec.get("bytes") or 0)
    if not url:
        return fallback
    try:
        request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "FinMaster"})
        with urllib.request.urlopen(request, timeout=3) as response:
            total = int(response.headers.get("Content-Length") or 0)
        if total > 0:
            _SIZE_CACHE[url] = total
            return total
    except (OSError, urllib.error.URLError, TimeoutError, ValueError):
        _SIZE_CACHE[url] = fallback
    return fallback


def _drop_partial(path: str) -> None:
    if os.path.isdir(path) and not os.path.isdir(os.path.join(path, "am")):
        shutil.rmtree(path, ignore_errors=True)


def _dir_size(path: str) -> int:
    total = 0
    if not os.path.isdir(path):
        return 0
    for dirpath, _dirnames, filenames in os.walk(path):
        for filename in filenames:
            try:
                total += os.path.getsize(os.path.join(dirpath, filename))
            except OSError:
                continue
    return total


def _fmt_size(size: int) -> str:
    if size <= 0:
        return ""
    if size < 1024 * 1024:
        return f"{max(1, round(size / 1024))} КБ"
    if size < 1024 * 1024 * 1024:
        text = f"{size / (1024 * 1024):.0f} МБ"
        return text
    text = f"{size / (1024 * 1024 * 1024):.1f} ГБ".replace(".", ",")
    return text.replace(",0 ГБ", " ГБ")


def _model_dir(model_id: str = "") -> str:
    return os.path.join(storage.config_dir(), "voice", model_id or active_id())


def _to_wav(data: bytes, should_stop: Callable[[], bool] | None = None) -> bytes:
    try:
        import imageio_ffmpeg
    except ImportError as exc:
        raise VoiceError(
            "Распознавание ещё не установлено. Перезапустите FinMaster — библиотека поставится сама. Пока напишите вопрос текстом."
        ) from exc
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    src_path = ""
    dst_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".oga", delete=False) as src:
            src.write(data)
            src_path = src.name
        dst_path = src_path + ".wav"
        kwargs: dict = {}
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        proc = subprocess.Popen(
            [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", src_path, "-ac", "1", "-ar", "16000", "-f", "wav", dst_path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            **kwargs,
        )
        while proc.poll() is None:
            if should_stop and should_stop():
                proc.kill()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
                raise RecognizeCancelled()
            time.sleep(0.2)
        if proc.returncode != 0 or not os.path.isfile(dst_path):
            raise VoiceError("Не удалось прочитать запись. Напишите вопрос текстом.")
        with open(dst_path, "rb") as handle:
            return handle.read()
    except VoiceError:
        raise
    except (OSError, subprocess.SubprocessError) as exc:
        raise VoiceError("Не удалось прочитать запись. Напишите вопрос текстом.") from exc
    finally:
        for file_path in (src_path, dst_path):
            if file_path and os.path.isfile(file_path):
                try:
                    os.remove(file_path)
                except OSError:
                    pass


def _recognize_cancellable(path: str, wav: bytes, should_stop: Callable[[], bool]) -> str:
    """Ждёт разбор кусками. «Отменить» возвращает управление сразу, даже если Vosk ещё считает."""
    if not _RECOGNIZE_LOCK.acquire(blocking=False):
        raise VoiceError("Предыдущее распознавание ещё останавливается. Пришлите запись через несколько секунд.")
    box: dict[str, Any] = {}
    done = threading.Event()

    def run() -> None:
        try:
            box["text"] = _recognize(path, wav, should_stop)
        except Exception as exc:
            box["err"] = exc
        finally:
            _RECOGNIZE_LOCK.release()
            done.set()

    threading.Thread(target=run, name="fm-vosk", daemon=True).start()
    while not done.wait(0.15):
        if should_stop():
            raise RecognizeCancelled()
    if box.get("err"):
        raise box["err"]
    return str(box.get("text") or "")


def _recognize(path: str, wav: bytes, should_stop: Callable[[], bool] | None = None) -> str:
    global _model, _model_path
    try:
        from vosk import KaldiRecognizer, Model, SetLogLevel
    except ImportError as exc:
        raise VoiceError(
            "Распознавание ещё не установлено. Перезапустите FinMaster — библиотека поставится сама. Пока напишите вопрос текстом."
        ) from exc
    SetLogLevel(-1)
    if should_stop and should_stop():
        raise RecognizeCancelled()
    with _MODEL_LOCK:
        if _model is None or _model_path != path:
            _model = Model(path)
            _model_path = path
        model = _model
    if should_stop and should_stop():
        raise RecognizeCancelled()
    with wave.open(io.BytesIO(wav), "rb") as handle:
        recognizer = KaldiRecognizer(model, handle.getframerate())
        while True:
            if should_stop and should_stop():
                raise RecognizeCancelled()
            chunk = handle.readframes(4000)
            if not chunk:
                break
            recognizer.AcceptWaveform(chunk)
        if should_stop and should_stop():
            raise RecognizeCancelled()
        payload = json.loads(recognizer.FinalResult() or "{}")
    return " ".join(str(payload.get("text") or "").split())


_UNITS = {
    "ноль": 0,
    "один": 1,
    "одна": 1,
    "одно": 1,
    "два": 2,
    "две": 2,
    "три": 3,
    "четыре": 4,
    "пять": 5,
    "шесть": 6,
    "семь": 7,
    "восемь": 8,
    "девять": 9,
}
_TEENS = {
    "десять": 10,
    "одиннадцать": 11,
    "двенадцать": 12,
    "тринадцать": 13,
    "четырнадцать": 14,
    "пятнадцать": 15,
    "шестнадцать": 16,
    "семнадцать": 17,
    "восемнадцать": 18,
    "девятнадцать": 19,
}
_TENS = {
    "двадцать": 20,
    "тридцать": 30,
    "сорок": 40,
    "пятьдесят": 50,
    "шестьдесят": 60,
    "семьдесят": 70,
    "восемьдесят": 80,
    "девяносто": 90,
}
_HUNDREDS = {
    "сто": 100,
    "двести": 200,
    "триста": 300,
    "четыреста": 400,
    "пятьсот": 500,
    "шестьсот": 600,
    "семьсот": 700,
    "восемьсот": 800,
    "девятьсот": 900,
}
_SCALES = {"тысяча": 1000, "тысячи": 1000, "тысяч": 1000, "миллион": 1000000, "миллиона": 1000000, "миллионов": 1000000}
_NUM_ALIASES = {
    "тристо": "триста",
    "двесте": "двести",
    "пятсот": "пятьсот",
    "пяцот": "пятьсот",
    "шестсот": "шестьсот",
    "семсот": "семьсот",
    "восемсот": "восемьсот",
    "девятсот": "девятьсот",
    "одинадцать": "одиннадцать",
    "десяый": "десятый",
}
# Порядковые: «триста десятый» и «300 десятый» — это 310, не 300 и слово.
_ORDINALS = {
    "первый": 1, "первая": 1, "первое": 1, "первого": 1, "первому": 1, "первым": 1,
    "второй": 2, "вторая": 2, "второе": 2, "второго": 2, "второму": 2, "вторым": 2,
    "третий": 3, "третья": 3, "третье": 3, "третьего": 3, "третьему": 3, "третьим": 3,
    "четвертый": 4, "четвертая": 4, "четвертое": 4, "четвертого": 4,
    "пятый": 5, "пятая": 5, "пятое": 5, "пятого": 5,
    "шестой": 6, "шестая": 6, "шестое": 6, "шестого": 6,
    "седьмой": 7, "седьмая": 7, "седьмое": 7, "седьмого": 7,
    "восьмой": 8, "восьмая": 8, "восьмое": 8, "восьмого": 8,
    "девятый": 9, "девятая": 9, "девятое": 9, "девятого": 9,
    "десятый": 10, "десятая": 10, "десятое": 10, "десятого": 10, "десятому": 10, "десятым": 10,
    "одиннадцатый": 11, "одиннадцатого": 11,
    "двенадцатый": 12, "двенадцатого": 12,
    "тринадцатый": 13, "тринадцатого": 13,
    "четырнадцатый": 14, "четырнадцатого": 14,
    "пятнадцатый": 15, "пятнадцатого": 15,
    "шестнадцатый": 16, "шестнадцатого": 16,
    "семнадцатый": 17, "семнадцатого": 17,
    "восемнадцатый": 18, "восемнадцатого": 18,
    "девятнадцатый": 19, "девятнадцатого": 19,
    "двадцатый": 20, "двадцатого": 20,
    "тридцатый": 30, "тридцатого": 30,
    "сороковой": 40, "сорокового": 40,
    "пятидесятый": 50, "пятидесятого": 50,
    "шестидесятый": 60, "шестидесятого": 60,
    "семидесятый": 70, "семидесятого": 70,
    "восьмидесятый": 80, "восьмидесятого": 80,
    "девяностый": 90, "девяностого": 90,
    "сотый": 100, "сотого": 100,
    "двухсотый": 200, "двухсотого": 200,
    "трехсотый": 300, "трехсотого": 300,
    "четырехсотый": 400, "четырехсотого": 400,
    "пятисотый": 500, "пятисотого": 500,
    "шестисотый": 600, "шестисотого": 600,
    "семисотый": 700, "семисотого": 700,
    "восьмисотый": 800, "восьмисотого": 800,
    "девятисотый": 900, "девятисотого": 900,
}


def _number_token(word: str) -> int | None:
    token = _NUM_ALIASES.get(word, word)
    for table in (_UNITS, _TEENS, _TENS, _HUNDREDS, _ORDINALS, _SCALES):
        if token in table:
            return table[token]
    return None


def _plain_int(word: str) -> int | None:
    token = word.strip(".,")
    if token.isdigit():
        return int(token)
    return None


def spoken_digits(text: str) -> str:
    """«триста десять», «триста десятый» и «300 десятый» становятся 310."""
    words = str(text or "").split()
    out: list[str] = []
    index = 0
    while index < len(words):
        raw = words[index].lower().replace("ё", "е")
        if _number_token(raw) is None and _plain_int(raw) is None:
            out.append(words[index])
            index += 1
            continue
        total = 0
        current = 0
        while index < len(words):
            token = words[index].lower().replace("ё", "е")
            value = _number_token(token)
            if value is None:
                digit = _plain_int(token)
                if digit is None or current or total:
                    break
                current = digit
                index += 1
                continue
            scale = _SCALES.get(_NUM_ALIASES.get(token, token))
            if scale:
                total += (current or 1) * scale
                current = 0
            else:
                current += value
            index += 1
        out.append(str(total + current))
    return " ".join(out)
