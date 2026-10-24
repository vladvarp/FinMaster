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
    return spoken_digits(_recognize(path, wav))


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
}


def _number_token(word: str) -> int | None:
    token = _NUM_ALIASES.get(word, word)
    for table in (_UNITS, _TEENS, _TENS, _HUNDREDS, _SCALES):
        if token in table:
            return table[token]
    return None


def spoken_digits(text: str) -> str:
    """«триста десять» и «тристо десять» становятся 310."""
    words = str(text or "").split()
    out: list[str] = []
    index = 0
    while index < len(words):
        raw = words[index].lower().replace("ё", "е")
        if _number_token(raw) is None:
            out.append(words[index])
            index += 1
            continue
        total = 0
        current = 0
        while index < len(words):
            token = words[index].lower().replace("ё", "е")
            value = _number_token(token)
            if value is None:
                break
            scale = _SCALES.get(_NUM_ALIASES.get(token, token))
            if scale:
                total += (current or 1) * scale
                current = 0
            elif value >= 100:
                current += value
            elif value >= 20:
                current += value
            else:
                current += value
            index += 1
        out.append(str(total + current))
    return " ".join(out)
