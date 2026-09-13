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
from backend.remote import lan_candidates
from backend.telegram import BOT as TELEGRAM
from backend.telegram import send_link as telegram_send_link
from backend.tunnel import TUNNEL

ROOT = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.join(ROOT, "frontend")

app = Flask(__name__, static_folder=FRONTEND, static_url_path="")
WINDOW = None
FORCE_CLOSE = False
DIRTY = False
SERVER_PORT = 0

LOCAL_ADDRS = {"127.0.0.1", "::1", "localhost"}
MOBILE_FILES = {"/m", "/mobile.html", "/mobile.js", "/mobile.css", "/favicon.ico", "/favicon.svg"}


def _is_tunneled() -> bool:
    """Запрос пришёл через ngrok: Flask видит 127.0.0.1, но это телефон из интернета."""
    forwarded = request.headers.get("X-Forwarded-For") or request.headers.get("X-Forwarded-Host")
    host = (request.headers.get("Host") or "").lower()
    return bool(forwarded) or "ngrok" in host


def _is_local() -> bool:
    if _is_tunneled():
        return False
    return (request.remote_addr or "") in LOCAL_ADDRS


def _is_public_asset(path: str) -> bool:
    if path in MOBILE_FILES:
        return True
    name = path.rsplit("/", 1)[-1].lower()
    return name.startswith("favicon") or name.startswith("apple-touch-icon") or name == "robots.txt"


def _remote_token() -> str:
    return str(request.headers.get("X-FM-Token") or request.args.get("t") or "")


@app.before_request
def guard_remote_clients():
    """Телефон видит только мобильный интерфейс и только с действующим токеном."""
    if _is_local():
        return None
    path = request.path
    if _is_public_asset(path):
        return None
    if path.startswith("/api/remote/"):
        if not REMOTE.enabled:
            return jsonify({"error": "Удалённый доступ выключен на компьютере."}), 403
        if not REMOTE.check(_remote_token()):
            return jsonify({"error": "Сессия недействительна — отсканируйте QR-код заново."}), 401
        return None
    return jsonify({"error": "Доступ запрещён."}), 403


@app.get("/")
def index():
    return send_from_directory(FRONTEND, "index.html")


def _no_cache(response):
    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["Pragma"] = "no-cache"
    return response


@app.get("/m")
def mobile_index():
    return _no_cache(send_from_directory(FRONTEND, "mobile.html"))


@app.get("/favicon.ico")
@app.get("/favicon.svg")
def favicon():
    return send_from_directory(FRONTEND, "favicon.svg", mimetype="image/svg+xml")


@app.get("/<path:filename>")
def static_files(filename: str):
    response = send_from_directory(FRONTEND, filename)
    if filename in {"mobile.js", "mobile.css", "mobile.html"}:
        return _no_cache(response)
    return response


def _recent_payload() -> list[dict[str, Any]]:
    cfg = storage.load_config()
    recent = []
    for item in cfg.get("recent", []):
        path = item.get("path")
        if not path:
            continue
        recent.append({**item, "exists": os.path.exists(path)})
    return recent


def _mobile_url(base: str, token: str) -> str:
    return f"{base.rstrip('/')}/m?t={token}"


def _qr_svg(url: str) -> str:
    try:
        return qr.svg(url, module=6)
    except Exception:
        return ""


def _telegram_live_url(chat_id: str = "") -> str:
    """Включает доступ при запросе из бота и возвращает свежую ссылку."""
    settings = storage.remote_settings()
    if chat_id and chat_id != settings.get("telegram_chat_id"):
        settings = storage.save_remote_settings(telegram_chat_id=str(chat_id))
    if not REMOTE.enabled:
        REMOTE.start(settings["token"])
    if settings.get("ngrok"):
        _ensure_tunnel(settings)
    return str(_remote_public().get("url") or "")


def _start_telegram(settings: dict[str, Any] | None = None) -> None:
    cfg = settings or storage.remote_settings()
    token = str(cfg.get("telegram_bot_token") or "")
    if not token:
        TELEGRAM.stop()
        return
    TELEGRAM.start(
        token,
        int(cfg.get("telegram_offset") or 0),
        on_request=_telegram_live_url,
        on_offset=lambda value: storage.save_remote_settings(telegram_offset=value),
    )


def _ensure_tunnel(settings: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = settings or storage.remote_settings()
    snap = TUNNEL.snapshot()
    if not cfg.get("ngrok"):
        return {**snap, "wanted": False}
    if snap.get("url"):
        return {**snap, "wanted": True}
    try:
        TUNNEL.start(SERVER_PORT, str(cfg.get("ngrok_token") or ""))
        snap = TUNNEL.snapshot()
        return {**snap, "wanted": True}
    except Exception as exc:
        return {**TUNNEL.snapshot(), "wanted": True, "error": str(exc)}


def _remote_public(ip: str | None = None, via: str | None = None) -> dict[str, Any]:
    settings = storage.remote_settings()
    ips = lan_candidates()
    chosen = ip if ip in ips else ips[0]
    token = REMOTE.token or settings["token"]
    lan_url = _mobile_url(f"http://{chosen}:{SERVER_PORT}", token)
    tunnel = TUNNEL.snapshot()
    if settings.get("ngrok") and not tunnel.get("url") and REMOTE.enabled:
        tunnel = _ensure_tunnel(settings)
    public_base = str(tunnel.get("url") or "")
    public_url = _mobile_url(public_base, token) if public_base else ""
    mode = via or settings.get("via") or "lan"
    if mode == "ngrok" and public_url:
        url = public_url
        mode = "ngrok"
    else:
        url = lan_url
        mode = "lan"
    return {
        "enabled": REMOTE.enabled,
        "url": url,
        "lan_url": lan_url,
        "public_url": public_url,
        "via": mode,
        "token": token,
        "ip": chosen,
        "ips": ips,
        "port": SERVER_PORT,
        "qr": _qr_svg(url),
        "version": REMOTE.version,
        "autostart": bool(settings.get("autostart")),
        "devices": settings.get("devices") or [],
        "clients": REMOTE.clients(),
        "ngrok": bool(settings.get("ngrok")),
        "ngrok_ready": bool(settings.get("ngrok_token")),
        "telegram_ready": bool(settings.get("telegram_bot_token")),
        "telegram_chat_id": str(settings.get("telegram_chat_id") or ""),
        "telegram_listening": bool(TELEGRAM.snapshot().get("listening")),
        "telegram_error": TELEGRAM.snapshot().get("error") or "",
        "ngrok_installed": bool(tunnel.get("available")),
        "tunnel": {
            "wanted": bool(settings.get("ngrok")),
            "url": public_base,
            "error": tunnel.get("error") or "",
            "running": bool(tunnel.get("running")),
        },
    }


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
            "remote": _remote_public(),
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
    settings = storage.save_remote_settings(autostart=True)
    token = REMOTE.start(settings["token"])
    REMOTE.publish(data.get("document"), data.get("path") or "", "desktop", bool(data.get("dirty")))
    payload = _remote_public(str(data.get("ip") or "") or None)
    payload["ok"] = True
    payload["token"] = token
    return jsonify(payload)


@app.post("/api/remote/address")
def api_remote_address():
    """Перерисовать QR для другого сетевого адреса, не разрывая сессию."""
    if not REMOTE.enabled:
        return jsonify({"error": "Сессия не запущена."}), 409
    data = request.get_json(silent=True) or {}
    via = str(data.get("via") or "")
    ip = str(data.get("ip") or "")
    if via == "ngrok":
        storage.save_remote_settings(via="ngrok")
        payload = _remote_public(via="ngrok")
        if not payload.get("public_url"):
            return jsonify({"error": payload.get("tunnel", {}).get("error") or "Интернет-туннель ещё не готов."}), 409
        payload["ok"] = True
        return jsonify(payload)
    if ip not in lan_candidates():
        return jsonify({"error": "Неизвестный адрес."}), 400
    storage.save_remote_settings(via="lan")
    payload = _remote_public(ip, via="lan")
    payload["ok"] = True
    return jsonify(payload)


@app.post("/api/remote/ngrok")
def api_remote_ngrok():
    data = request.get_json(silent=True) or {}
    updates: dict[str, Any] = {}
    if "authtoken" in data:
        updates["ngrok_token"] = str(data.get("authtoken") or "")
    if "enabled" in data:
        updates["ngrok"] = bool(data.get("enabled"))
        if updates["ngrok"]:
            updates["via"] = "ngrok"
        else:
            updates["via"] = "lan"
    settings = storage.save_remote_settings(**updates) if updates else storage.remote_settings()
    if settings.get("ngrok") and REMOTE.enabled:
        _ensure_tunnel(settings)
    elif not settings.get("ngrok"):
        TUNNEL.stop()
    payload = _remote_public()
    payload["ok"] = True
    if settings.get("ngrok") and REMOTE.enabled and not payload.get("public_url"):
        return jsonify({**payload, "error": payload.get("tunnel", {}).get("error") or "Не удалось поднять ngrok."}), 400
    return jsonify(payload)


@app.post("/api/remote/telegram")
def api_remote_telegram():
    """Сохраняет токен бота и шлёт актуальную ссылку в Telegram."""
    if not _is_local():
        return jsonify({"error": "Доступ запрещён."}), 403
    data = request.get_json(silent=True) or {}
    updates: dict[str, Any] = {}
    if "token" in data:
        updates["telegram_bot_token"] = str(data.get("token") or "")
    if "chat_id" in data:
        updates["telegram_chat_id"] = str(data.get("chat_id") or "")
    settings = storage.save_remote_settings(**updates) if updates else storage.remote_settings()
    _start_telegram(settings)
    if data.get("send"):
        if not REMOTE.enabled:
            REMOTE.start(settings["token"])
        if settings.get("ngrok"):
            _ensure_tunnel(settings)
        payload = _remote_public()
        try:
            chat_id = telegram_send_link(
                str(settings.get("telegram_bot_token") or ""),
                str(data.get("chat_id") or settings.get("telegram_chat_id") or ""),
                str(payload.get("url") or ""),
            )
            if chat_id and chat_id != settings.get("telegram_chat_id"):
                storage.save_remote_settings(telegram_chat_id=chat_id)
                payload = _remote_public()
        except RuntimeError as exc:
            return jsonify({**payload, "error": str(exc)}), 400
    payload = _remote_public()
    payload["ok"] = True
    return jsonify(payload)


@app.post("/api/remote/stop")
def api_remote_stop():
    REMOTE.stop()
    TUNNEL.stop()
    storage.save_remote_settings(autostart=False)
    return jsonify({"ok": True, **_remote_public()})


@app.post("/api/remote/rotate")
def api_remote_rotate():
    settings = storage.rotate_remote_token()
    if REMOTE.enabled:
        REMOTE.start(settings["token"])
    payload = _remote_public()
    payload["ok"] = True
    return jsonify(payload)


@app.post("/api/remote/forget")
def api_remote_forget():
    data = request.get_json(silent=True) or {}
    devices = storage.forget_device(str(data.get("id") or ""))
    return jsonify({"ok": True, "devices": devices})


@app.get("/api/remote/info")
def api_remote_info():
    snap = REMOTE.snapshot(with_doc=False)
    snap.update(_remote_public())
    return jsonify(snap)


@app.post("/api/remote/publish")
def api_remote_publish():
    """Компьютер отдаёт свежий документ подключённым телефонам."""
    if not REMOTE.enabled:
        return jsonify({"ok": False, "enabled": False})
    data = request.get_json(silent=True) or {}
    if not isinstance(data.get("document"), dict):
        return jsonify({"ok": True, "version": REMOTE.set_history(data.get("history"))})
    version = REMOTE.publish(
        data.get("document"),
        data.get("path") or "",
        "desktop",
        bool(data.get("dirty")),
        data.get("history"),
    )
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
    if kind == "mobile" and cid:
        storage.remember_device(cid, name, request.remote_addr or "")
    snap = REMOTE.wait(since)
    return jsonify(snap)


@app.get("/api/remote/session")
def api_remote_session():
    """Стартовые данные мобильного клиента."""
    snap = REMOTE.snapshot(with_doc=True)
    snap["recent"] = _recent_payload()
    snap["desktop_online"] = bool(REMOTE.clients("desktop"))
    cid = request.args.get("cid") or ""
    name = request.args.get("name") or ""
    if cid:
        REMOTE.touch(cid, "mobile", name)
        storage.remember_device(cid, name, request.remote_addr or "")
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
    if kind not in {"save", "open", "new", "undo", "redo"}:
        return jsonify({"error": "Неизвестная команда."}), 400
    payload: dict[str, Any] = {}
    if kind == "open":
        path = str(data.get("path") or "")
        if not path or not os.path.exists(path):
            return jsonify({"error": "Файл не найден."}), 404
        payload["path"] = os.path.abspath(path)
    version = REMOTE.issue_command(kind, **payload)
    return jsonify({"ok": True, "version": version})


@app.post("/api/remote/nav")
def api_remote_nav():
    """Телефон открыл экран или заказ — компьютер показывает то же самое."""
    if not REMOTE.enabled:
        return jsonify({"error": "Сессия закрыта."}), 409
    data = request.get_json(silent=True) or {}
    view = str(data.get("view") or "")
    if view not in {"orders", "order", "stats", "files", "snapshot"}:
        return jsonify({"error": "Неизвестный экран."}), 400
    version = REMOTE.set_nav(view, str(data.get("order_id") or ""), str(data.get("cid") or ""))
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
    TUNNEL.stop()
    TELEGRAM.stop()
    window = WINDOW
    if window is not None:
        threading.Timer(0.05, window.destroy).start()
    return jsonify({"ok": True})


def _port_free(port: int) -> bool:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("0.0.0.0", port))
        except OSError:
            return False
    return True


def pick_port() -> int:
    import socket

    settings = storage.remote_settings()
    preferred = int(settings.get("port") or storage.DEFAULT_REMOTE_PORT)
    candidates = [preferred] + [p for p in range(storage.DEFAULT_REMOTE_PORT, storage.DEFAULT_REMOTE_PORT + 12) if p != preferred]
    for port in candidates:
        if _port_free(port):
            if port != settings.get("port"):
                storage.save_remote_settings(port=port)
            return port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("0.0.0.0", 0))
        port = int(sock.getsockname()[1])
    storage.save_remote_settings(port=port)
    return port


def run_server(port: int) -> None:
    # Слушаем всю локальную сеть, но чужие адреса пускает только guard_remote_clients.
    app.run(host="0.0.0.0", port=port, threaded=True, use_reloader=False)


def main() -> None:
    global WINDOW, FORCE_CLOSE, DIRTY, SERVER_PORT

    port = pick_port()
    SERVER_PORT = port
    settings = storage.remote_settings()
    if settings.get("autostart"):
        REMOTE.start(settings["token"])
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

    if settings.get("autostart") and settings.get("ngrok"):
        threading.Thread(target=lambda: _ensure_tunnel(settings), daemon=True).start()
    if settings.get("telegram_bot_token"):
        threading.Thread(target=lambda: _start_telegram(settings), daemon=True).start()

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
