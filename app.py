from __future__ import annotations

import json
import os
import sys
import threading
import time
import webbrowser
from typing import Any

from flask import Flask, send_from_directory

from backend.document import empty_document, normalize_document, now_iso
from backend import storage

ROOT = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.join(ROOT, "frontend")
FILE_TYPES = ("Отчёты FinMaster (*.fmaster;*.json)", "Все файлы (*.*)")

app = Flask(__name__, static_folder=FRONTEND, static_url_path="")


@app.get("/")
def index():
    return send_from_directory(FRONTEND, "index.html")


@app.get("/<path:filename>")
def static_files(filename: str):
    return send_from_directory(FRONTEND, filename)


class FinMasterApi:
    def __init__(self) -> None:
        self.force_close = False

    def get_bootstrap(self) -> dict[str, Any]:
        cfg = storage.load_config()
        recent = []
        for item in cfg.get("recent", []):
            path = item.get("path")
            if not path:
                continue
            exists = os.path.exists(path)
            recent.append({**item, "exists": exists})
        return {
            "recent": recent,
            "autosave": bool(cfg.get("autosave")),
            "last_dir": cfg.get("last_dir") or "",
            "native": True,
        }

    def new_document(self) -> dict[str, Any]:
        return empty_document()

    def open_dialog(self) -> dict[str, Any] | None:
        import webview

        window = webview.windows[0]
        directory = storage.load_config().get("last_dir") or ""
        result = window.create_file_dialog(
            webview.OPEN_DIALOG,
            directory=directory or None,
            allow_multiple=False,
            file_types=FILE_TYPES,
        )
        if not result:
            return None
        path = result[0]
        return self.open_path(path)

    def open_path(self, path: str) -> dict[str, Any]:
        if not path or not os.path.exists(path):
            raise FileNotFoundError("Файл отчёта не найден.")
        raw = json.loads(storage.read_text(path))
        doc = normalize_document(raw)
        recent = storage.add_recent(path, doc.get("title") or "")
        return {"path": os.path.abspath(path), "document": doc, "recent": recent}

    def save_dialog(self, suggested: str = "Отчёт.fmaster") -> str | None:
        import webview

        window = webview.windows[0]
        directory = storage.load_config().get("last_dir") or ""
        name = suggested if suggested.lower().endswith(".fmaster") else f"{suggested}.fmaster"
        result = window.create_file_dialog(
            webview.SAVE_DIALOG,
            directory=directory or None,
            save_filename=name,
            file_types=("Отчёт FinMaster (*.fmaster)",),
        )
        if not result:
            return None
        path = result if isinstance(result, str) else result[0]
        if path and not os.path.splitext(path)[1]:
            path += ".fmaster"
        return path

    def write_document(self, path: str, document: dict[str, Any]) -> dict[str, Any]:
        if not path:
            raise ValueError("Не указан путь файла.")
        doc = normalize_document(document)
        doc["modified_at"] = now_iso()
        storage.atomic_write(path, json.dumps(doc, ensure_ascii=False, indent=2))
        recent = storage.add_recent(path, doc.get("title") or "")
        return {"path": os.path.abspath(path), "document": doc, "recent": recent}

    def set_autosave(self, enabled: bool) -> bool:
        storage.set_autosave(bool(enabled))
        return bool(enabled)

    def export_dialog(self, suggested: str = "Экспорт.csv") -> str | None:
        import webview

        window = webview.windows[0]
        directory = storage.load_config().get("last_dir") or ""
        result = window.create_file_dialog(
            webview.SAVE_DIALOG,
            directory=directory or None,
            save_filename=suggested,
            file_types=("CSV (*.csv)", "Все файлы (*.*)"),
        )
        if not result:
            return None
        return result if isinstance(result, str) else result[0]

    def write_text(self, path: str, content: str) -> bool:
        storage.atomic_write(path, content)
        return True

    def confirm_close(self) -> bool:
        """Ask JS whether the window may close. JS returns true/false synchronously if clean."""
        import webview

        window = webview.windows[0]
        result = window.evaluate_js("window.__finmasterCanClose && window.__finmasterCanClose()")
        return bool(result)

    def destroy_window(self) -> None:
        import webview

        self.force_close = True
        for window in list(webview.windows):
            window.destroy()


def pick_port() -> int:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def run_server(port: int) -> None:
    app.run(host="127.0.0.1", port=port, threaded=True, use_reloader=False)


def main() -> None:
    port = pick_port()
    url = f"http://127.0.0.1:{port}/"
    thread = threading.Thread(target=run_server, args=(port,), daemon=True)
    thread.start()

    for _ in range(50):
        try:
            import urllib.request

            urllib.request.urlopen(url, timeout=0.2)
            break
        except Exception:
            time.sleep(0.1)

    try:
        import webview
    except ImportError:
        print("pywebview не установлен — открываю системный браузер.")
        print("Для отдельного окна выполните: pip install -r requirements.txt")
        webbrowser.open(url)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            return

    api = FinMasterApi()
    window = webview.create_window(
        "FinMaster — учёт заказов",
        url,
        js_api=api,
        width=1440,
        height=920,
        min_size=(1180, 740),
        background_color="#0b1220",
    )

    def on_closing():
        if api.force_close:
            return True
        try:
            dirty = window.evaluate_js("window.__finmasterIsDirty && window.__finmasterIsDirty()")
        except Exception:
            return True
        if not dirty:
            return True
        window.evaluate_js("window.__finmasterAskClose && window.__finmasterAskClose()")
        return False

    window.events.closing += on_closing
    webview.start()


if __name__ == "__main__":
    sys.exit(main() or 0)
