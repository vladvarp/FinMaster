"""Голос в Telegram: запись разбирается на этом компьютере.

Модель русского языка скачивается один раз в папку настроек FinMaster.
Дальше интернет для распознавания не нужен, аудио никуда не отправляется.
"""

from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
import threading
import wave
import zipfile
from typing import Any, Callable

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


class VoiceError(RuntimeError):
    pass


class DownloadCancelled(Exception):
    pass


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


def transcribe(data: bytes, on_progress: Callable[[float, str], None] | None = None) -> str:
    if not data:
        raise VoiceError("Пустая запись. Напишите вопрос текстом.")
    require()
    path = ensure_model(on_progress)
    if on_progress:
        on_progress(0.94, "Разбираю запись…")
    wav = _to_wav(data)
    if on_progress:
        on_progress(0.98, "Распознаю речь…")
    return spoken_digits(_recognize(path, wav))


def ensure_model(on_progress: Callable[[float, str], None] | None = None) -> str:
    return ensure_model_id(active_id(), on_progress)


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


def describe(model_id: str) -> str:
    spec = _spec(model_id)
    if spec:
        return str(spec["about"])
    return "Своя модель из папки voice. Программа использует её, если она выбрана рабочей."


def code_of(model_id: str) -> str:
    spec = _spec(model_id)
    return str(spec["code"]) if spec else ""


def id_of(code: str) -> str:
    for spec in CATALOG:
        if spec["code"] == str(code or "").strip():
            return str(spec["id"])
    return ""


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
        raise VoiceError("Такой модели речи нет.")
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
            rows.append(
                _row(
                    {"id": name, "code": "", "label": name, "bytes": 0, "about": describe(name), "url": ""},
                    current,
                )
            )
    return {"active": current, "models": rows, "job": job_snapshot()}


def _row(spec: dict[str, Any], current: str) -> dict[str, Any]:
    model_id = str(spec["id"])
    ready = model_ready(model_id)
    size = _download_size(spec) if spec.get("url") else _dir_size(_model_dir(model_id))
    return {
        "id": model_id,
        "code": str(spec.get("code") or ""),
        "label": str(spec.get("label") or model_id),
        "about": str(spec.get("about") or ""),
        "bytes": size,
        "size": _fmt_size(size),
        "ready": ready,
        "active": model_id == current,
    }


def _spec(model_id: str) -> dict[str, Any] | None:
    key = str(model_id or "").strip()
    for spec in CATALOG:
        if spec["id"] == key or spec["code"] == key:
            return spec
    return None


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


def _to_wav(data: bytes) -> bytes:
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
        kwargs: dict = {"capture_output": True, "timeout": 90}
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        run = subprocess.run(
            [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", src_path, "-ac", "1", "-ar", "16000", "-f", "wav", dst_path],
            **kwargs,
        )
        if run.returncode != 0 or not os.path.isfile(dst_path):
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


def _recognize(path: str, wav: bytes) -> str:
    global _model, _model_path
    try:
        from vosk import KaldiRecognizer, Model, SetLogLevel
    except ImportError as exc:
        raise VoiceError(
            "Распознавание ещё не установлено. Перезапустите FinMaster — библиотека поставится сама. Пока напишите вопрос текстом."
        ) from exc
    SetLogLevel(-1)
    with _MODEL_LOCK:
        if _model is None or _model_path != path:
            _model = Model(path)
            _model_path = path
        model = _model
    with wave.open(io.BytesIO(wav), "rb") as handle:
        recognizer = KaldiRecognizer(model, handle.getframerate())
        while True:
            chunk = handle.readframes(4000)
            if not chunk:
                break
            recognizer.AcceptWaveform(chunk)
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
