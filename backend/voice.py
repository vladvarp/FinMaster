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
import wave
import zipfile

from backend import storage

MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip"
MODEL_NAME = "vosk-model-small-ru-0.22"
_model = None


class VoiceError(RuntimeError):
    pass


def model_ready() -> bool:
    return os.path.isdir(os.path.join(_model_dir(), "am"))


def require() -> None:
    """Пакеты ставятся при запуске FinMaster. Без них голос не разобрать."""
    for name in ("vosk", "imageio_ffmpeg"):
        try:
            __import__(name)
        except ImportError as exc:
            raise VoiceError(
                "Распознавание ещё не установлено. Перезапустите FinMaster — библиотека поставится сама. Пока напишите вопрос текстом."
            ) from exc


def transcribe(data: bytes) -> str:
    if not data:
        raise VoiceError("Пустая запись. Напишите вопрос текстом.")
    require()
    path = ensure_model()
    wav = _to_wav(data)
    return _recognize(path, wav)


def ensure_model() -> str:
    path = _model_dir()
    if os.path.isdir(os.path.join(path, "am")):
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".zip"
    try:
        request = urllib.request.Request(MODEL_URL, headers={"User-Agent": "FinMaster"})
        with urllib.request.urlopen(request, timeout=120) as response, open(tmp, "wb") as handle:
            shutil.copyfileobj(response, handle)
        with zipfile.ZipFile(tmp) as archive:
            for info in archive.infolist():
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
    except (OSError, urllib.error.URLError, zipfile.BadZipFile, TimeoutError) as exc:
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


def _model_dir() -> str:
    return os.path.join(storage.config_dir(), "voice", MODEL_NAME)


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
    global _model
    try:
        from vosk import KaldiRecognizer, Model, SetLogLevel
    except ImportError as exc:
        raise VoiceError(
            "Распознавание ещё не установлено. Перезапустите FinMaster — библиотека поставится сама. Пока напишите вопрос текстом."
        ) from exc
    SetLogLevel(-1)
    if _model is None:
        _model = Model(path)
    with wave.open(io.BytesIO(wav), "rb") as handle:
        recognizer = KaldiRecognizer(_model, handle.getframerate())
        while True:
            chunk = handle.readframes(4000)
            if not chunk:
                break
            recognizer.AcceptWaveform(chunk)
        payload = json.loads(recognizer.FinalResult() or "{}")
    return " ".join(str(payload.get("text") or "").split())
