from __future__ import annotations

import json
import os
import sys
import threading
import time
import webbrowser
from typing import Any

from flask import Flask, jsonify, request, send_from_directory

from backend import qr, storage
from backend.dialogs import open_report_dialog, save_csv_dialog, save_png_dialog, save_report_dialog
from backend.document import normalize_document, now_iso
from backend.remote import SESSION as REMOTE
from backend.remote import lan_candidates, lan_ip

ROOT = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.join(ROOT, "frontend")

app = Flask(__name__, static_folder=FRONTEND, static_url_path="")
WINDOW = None
FORCE_CLOSE = False
DIRTY = False
SERVER_PORT = 0

LOCAL_ADDRS = {"127.0.0.1", "::1", "localhost"}
MOBILE_FILES = {"/m", "/mobile.html", "/mobile.js", "/mobile.css"}


def _is_local() -> bool:
    return (request.remote_addr or "") in LOCAL_ADDRS


@app.before_request
def guard_remote_clients():
    """Телефон видит только мобильный интерфейс и только с действующим токеном."""
    if _is_local():
        return None
    if not REMOTE.enabled:
        return jsonify({"error": "Удалённый доступ выключен на компьютере."}), 403
    path = request.path
    if path in MOBILE_FILES:
        return None
    if path.startswith("/api/remote/"):
        token = request.headers.get("X-FM-Token") or request.args.get("t")
        if not token:
            token = (request.get_json(silent=True) or {}).get("token")
        if not REMOTE.check(token):
            return jsonify({"error": "Сессия недействительна — отсканируйте QR-код заново."}), 401
        return None
    return jsonify({"error": "Доступ запрещён."}), 403


@app.get("/")
def index():
    return send_from_directory(FRONTEND, "index.html")


@app.get("/m")
def mobile_index():
    return send_from_directory(FRONTEND, "mobile.html")


@app.get("/<path:filename>")
def static_files(filename: str):
    return send_from_directory(FRONTEND, filename)


def _recent_payload() -> list[dict[str, Any]]:
    cfg = storage.load_config()
    recent = []
    for item in cfg.get("recent", []):
        path = item.get("path")
        if not path:
            continue
        recent.append({**item, "exists": os.path.exists(path)})
    return recent


@app.get("/api/bootstrap")
def api_bootstrap():
    cfg = storage.load_config()
    return jsonify(
        {
            "recent": _recent_payload(),
            "autosave": bool(cfg.get("autosave")),
            "last_dir": cfg.get("last_dir") or "",
            "theme": "dark" if cfg.get("theme") == "dark" else "light",
            "desktop": True,
        }
    )


@app.post("/api/dirty")
def api_dirty():
    global DIRTY
    data = request.get_json(silent=True) or {}
    DIRTY = bool(data.get("dirty"))
    return jsonify({"ok": True, "dirty": DIRTY})


@app.post("/api/autosave")
def api_autosave():
    data = request.get_json(silent=True) or {}
    enabled = bool(data.get("enabled"))
    storage.set_autosave(enabled)
    return jsonify({"ok": True, "autosave": enabled})


@app.post("/api/theme")
def api_theme():
    data = request.get_json(silent=True) or {}
    theme = storage.set_theme(data.get("theme") or "light")
    return jsonify({"ok": True, "theme": theme})


@app.post("/api/recent/remove")
def api_recent_remove():
    data = request.get_json(silent=True) or {}
    path = data.get("path") or ""
    storage.remove_recent(path)
    return jsonify({"ok": True, "recent": _recent_payload()})


@app.post("/api/dialog/open")
def api_dialog_open():
    path = open_report_dialog(storage.load_config().get("last_dir") or "")
    if not path:
        return jsonify({"cancelled": True})
    return jsonify(_open_path(path))


@app.post("/api/open-path")
def api_open_path():
    data = request.get_json(silent=True) or {}
    path = data.get("path") or ""
    try:
        return jsonify(_open_path(path))
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 404
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


def _open_path(path: str) -> dict[str, Any]:
    if not path or not os.path.exists(path):
        raise FileNotFoundError("Файл отчёта не найден.")
    raw = json.loads(storage.read_text(path))
    doc = normalize_document(raw)
    recent = storage.add_recent(path, doc.get("title") or "")
    return {"path": os.path.abspath(path), "document": doc, "recent": recent, "cancelled": False}


@app.post("/api/dialog/save")
def api_dialog_save():
    data = request.get_json(silent=True) or {}
    suggested = data.get("suggested") or "Отчёт.fmaster"
    path = save_report_dialog(suggested, storage.load_config().get("last_dir") or "")
    if not path:
        return jsonify({"cancelled": True})
    return jsonify({"path": path, "cancelled": False})


@app.post("/api/dialog/export")
def api_dialog_export():
    data = request.get_json(silent=True) or {}
    suggested = data.get("suggested") or "Экспорт.csv"
    path = save_csv_dialog(suggested, storage.load_config().get("last_dir") or "")
    if not path:
        return jsonify({"cancelled": True})
    return jsonify({"path": path, "cancelled": False})


@app.post("/api/write")
def api_write():
    data = request.get_json(silent=True) or {}
    path = data.get("path") or ""
    document = data.get("document")
    if not path:
        return jsonify({"error": "Не указан путь файла."}), 400
    doc = normalize_document(document)
    doc["modified_at"] = now_iso()
    storage.atomic_write(path, json.dumps(doc, ensure_ascii=False, indent=2))
    recent = storage.add_recent(path, doc.get("title") or "")
    return jsonify({"path": os.path.abspath(path), "document": doc, "recent": recent})


@app.post("/api/write-text")
def api_write_text():
    data = request.get_json(silent=True) or {}
    path = data.get("path") or ""
    content = data.get("content") or ""
    if not path:
        return jsonify({"error": "Не указан путь файла."}), 400
    storage.atomic_write(path, content)
    return jsonify({"ok": True})


@app.post("/api/dialog/png")
def api_dialog_png():
    data = request.get_json(silent=True) or {}
    suggested = data.get("suggested") or "Заказ.png"
    path = save_png_dialog(suggested, storage.load_config().get("last_dir") or "")
    if not path:
        return jsonify({"cancelled": True})
    return jsonify({"path": path, "cancelled": False})


@app.post("/api/write-bytes")
def api_write_bytes():
    import base64

    data = request.get_json(silent=True) or {}
    path = data.get("path") or ""
    payload = data.get("base64") or ""
    if not path:
        return jsonify({"error": "Не указан путь файла."}), 400
    raw = base64.b64decode(payload)
    directory = os.path.dirname(os.path.abspath(path)) or "."
    os.makedirs(directory, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(raw)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)
    return jsonify({"ok": True})


@app.post("/api/clipboard-text")
def api_clipboard_text():
    from backend.clipboard import copy_text_to_clipboard

    data = request.get_json(silent=True) or {}
    text = data.get("text")
    if text is None:
        return jsonify({"error": "Нет текста."}), 400
    try:
        copy_text_to_clipboard(str(text))
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    return jsonify({"ok": True})


@app.post("/api/clipboard-png")
def api_clipboard_png():
    import base64

    from backend.clipboard import copy_png_to_clipboard

    data = request.get_json(silent=True) or {}
    payload = data.get("base64") or ""
    if not payload:
        return jsonify({"error": "Нет изображения."}), 400
    try:
        copy_png_to_clipboard(base64.b64decode(payload))
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    return jsonify({"ok": True})


@app.post("/api/remote/start")
def api_remote_start():
    data = request.get_json(silent=True) or {}
    token = REMOTE.start()
    REMOTE.publish(data.get("document"), data.get("path") or "", "desktop", bool(data.get("dirty")))
    ips = lan_candidates()
    ip = str(data.get("ip") or "") if str(data.get("ip") or "") in ips else ips[0]
    url = f"http://{ip}:{SERVER_PORT}/m?t={token}"
    return jsonify(
        {
            "ok": True,
            "url": url,
            "token": token,
            "ip": ip,
            "ips": ips,
            "port": SERVER_PORT,
            "qr": qr.svg(url, module=6),
            "version": REMOTE.version,
        }
    )


@app.post("/api/remote/address")
def api_remote_address():
    """Перерисовать QR для другого сетевого адреса, не разрывая сессию."""
    if not REMOTE.enabled:
        return jsonify({"error": "Сессия не запущена."}), 409
    data = request.get_json(silent=True) or {}
    ips = lan_candidates()
    ip = str(data.get("ip") or "")
    if ip not in ips:
        return jsonify({"error": "Неизвестный адрес."}), 400
    url = f"http://{ip}:{SERVER_PORT}/m?t={REMOTE.token}"
    return jsonify({"ok": True, "url": url, "ip": ip, "ips": ips, "qr": qr.svg(url, module=6)})


@app.post("/api/remote/stop")
def api_remote_stop():
    REMOTE.stop()
    return jsonify({"ok": True})


@app.get("/api/remote/info")
def api_remote_info():
    snap = REMOTE.snapshot(with_doc=False)
    snap["ip"] = lan_ip()
    snap["ips"] = lan_candidates()
    snap["port"] = SERVER_PORT
    return jsonify(snap)


@app.post("/api/remote/publish")
def api_remote_publish():
    """Компьютер отдаёт свежий документ подключённым телефонам."""
    if not REMOTE.enabled:
        return jsonify({"ok": False, "enabled": False})
    data = request.get_json(silent=True) or {}
    version = REMOTE.publish(data.get("document"), data.get("path") or "", "desktop", bool(data.get("dirty")))
    return jsonify({"ok": True, "version": version})


@app.get("/api/remote/pull")
def api_remote_pull():
    """Длинный опрос: ждём изменений документа с любой стороны."""
    if not REMOTE.enabled:
        return jsonify({"enabled": False, "version": REMOTE.version, "changed": False})
    since = request.args.get("since", type=int) or 0
    cid = request.args.get("cid") or ""
    kind = request.args.get("kind") or "mobile"
    name = request.args.get("name") or ""
    REMOTE.touch(cid, kind, name)
    snap = REMOTE.wait(since)
    return jsonify(snap)


@app.get("/api/remote/session")
def api_remote_session():
    """Стартовые данные мобильного клиента."""
    snap = REMOTE.snapshot(with_doc=True)
    snap["recent"] = _recent_payload()
    snap["desktop_online"] = bool(REMOTE.clients("desktop"))
    return jsonify(snap)


@app.post("/api/remote/push")
def api_remote_push():
    """Телефон присылает изменённый документ."""
    if not REMOTE.enabled:
        return jsonify({"error": "Сессия закрыта."}), 409
    data = request.get_json(silent=True) or {}
    document = data.get("document")
    if not isinstance(document, dict):
        return jsonify({"error": "Нет документа."}), 400
    cid = str(data.get("cid") or "mobile")
    REMOTE.touch(cid, "mobile", str(data.get("name") or ""))
    version = REMOTE.publish(document, REMOTE.path, cid, True)
    return jsonify({"ok": True, "version": version})


@app.post("/api/remote/command")
def api_remote_command():
    """Телефон просит компьютер сохранить отчёт или открыть другой файл."""
    if not REMOTE.enabled:
        return jsonify({"error": "Сессия закрыта."}), 409
    data = request.get_json(silent=True) or {}
    kind = str(data.get("type") or "")
    if kind not in {"save", "open", "new"}:
        return jsonify({"error": "Неизвестная команда."}), 400
    payload: dict[str, Any] = {}
    if kind == "open":
        path = str(data.get("path") or "")
        if not path or not os.path.exists(path):
            return jsonify({"error": "Файл не найден."}), 404
        payload["path"] = os.path.abspath(path)
    version = REMOTE.issue_command(kind, **payload)
    return jsonify({"ok": True, "version": version})


@app.post("/api/remote/leave")
def api_remote_leave():
    data = request.get_json(silent=True) or {}
    REMOTE.drop(str(data.get("cid") or ""))
    return jsonify({"ok": True})


@app.post("/api/quit")
def api_quit():
    global FORCE_CLOSE, DIRTY
    FORCE_CLOSE = True
    DIRTY = False
    REMOTE.stop()
    window = WINDOW
    if window is not None:
        threading.Timer(0.05, window.destroy).start()
    return jsonify({"ok": True})


def pick_port() -> int:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("0.0.0.0", 0))
        return int(sock.getsockname()[1])


def run_server(port: int) -> None:
    # Слушаем всю локальную сеть, но чужие адреса пускает только guard_remote_clients.
    app.run(host="0.0.0.0", port=port, threaded=True, use_reloader=False)


def main() -> None:
    global WINDOW, FORCE_CLOSE, DIRTY, SERVER_PORT

    port = pick_port()
    SERVER_PORT = port
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

    WINDOW = webview.create_window(
        "FinMaster — учёт заказов",
        url,
        width=1440,
        height=920,
        min_size=(1180, 740),
        background_color="#0b1220",
    )

    def on_closing():
        # Never call evaluate_js on this stack: WebView2 deadlocks the window.
        if FORCE_CLOSE or not DIRTY:
            return True
        window = WINDOW

        def ask():
            time.sleep(0.2)
            try:
                window.evaluate_js("window.__finmasterAskClose && window.__finmasterAskClose()")
            except Exception:
                try:
                    window.destroy()
                except Exception:
                    pass

        threading.Thread(target=ask, daemon=True).start()
        return False

    WINDOW.events.closing += on_closing
    webview.start()


if __name__ == "__main__":
    sys.exit(main() or 0)
