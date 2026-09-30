from __future__ import annotations

import base64
import json
import os
import sys
import threading
import time
import webbrowser
from typing import Any

from flask import Flask, g, jsonify, request, send_from_directory

from backend import netlog, qr, storage
from backend.dialogs import open_report_dialog, save_csv_dialog, save_pdf_dialog, save_png_dialog, save_report_dialog
from backend.document import empty_document, normalize_document, now_iso
from backend.remote import SESSION as REMOTE
from backend.remote import lan_candidates
from backend.telegram import BOT as TELEGRAM
from backend.telegram import send_link as telegram_send_link
from backend.telegram import set_menu_button as telegram_set_menu
from backend.telegram import push_open_controls as telegram_push_open
from backend.tunnel import TUNNEL
from backend.watch import WATCHER

ROOT = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.join(ROOT, "frontend")

app = Flask(__name__, static_folder=FRONTEND, static_url_path="")
WINDOW = None
WINDOW_FULLSCREEN = False
FORCE_CLOSE = False
DIRTY = False
SERVER_PORT = 0

LOCAL_ADDRS = {"127.0.0.1", "::1", "localhost"}
MOBILE_FILES = {"/m", "/mobile.html", "/mobile.js", "/mobile.css", "/favicon.ico", "/favicon.svg", "/favicon.png"}
ICON_PATH = os.path.join(FRONTEND, "favicon.ico")


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


def _device_info() -> dict[str, Any]:
    raw = (request.headers.get("X-FM-Device") or "").strip()
    if not raw:
        return {}
    try:
        if not raw.startswith("{"):
            raw = base64.b64decode(raw).decode("utf-8")
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _net_peer() -> str:
    forwarded = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
    ip = forwarded or (request.remote_addr or "")
    if _is_tunneled():
        return forwarded or "интернет"
    if (request.remote_addr or "") in LOCAL_ADDRS:
        return "компьютер"
    return ip


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
            netlog.add("http", "Запрос отклонён: доступ выключен", level="warn", source=_net_peer(), detail=path, key="deny-off")
            return jsonify({"error": "Удалённый доступ выключен на компьютере."}), 403
        if not REMOTE.check(_remote_token()):
            netlog.add("http", "Запрос отклонён: неверный токен", level="err", source=_net_peer(), detail=path, key="deny-token")
            return jsonify({"error": "Сессия недействительна — отсканируйте QR-код заново."}), 401
        return None
    return jsonify({"error": "Доступ запрещён."}), 403


@app.after_request
def log_remote_http(response):
    path = request.path
    if path in {"/m", "/mobile.html"} and response.status_code < 400:
        netlog.add("http", "Телефон открыл страницу", source=_net_peer(), key="open-m")
        return response
    if not path.startswith("/api/remote/"):
        return response
    if path.startswith("/api/remote/log") or path in {"/api/remote/info", "/api/remote/pull", "/api/remote/publish"}:
        return response
    if getattr(g, "netlog_skip", False):
        return response
    if response.status_code >= 400:
        netlog.add(
            "http",
            f"{request.method} {path} → {response.status_code}",
            level="err",
            source=_net_peer(),
            key=f"http-err-{path}",
        )
        return response
    text = getattr(g, "netlog_text", "")
    if text:
        netlog.add(
            "http",
            text,
            level=getattr(g, "netlog_level", "info") or "info",
            source=_net_peer(),
            key=getattr(g, "netlog_key", "") or "",
        )
    return response


@app.get("/")
def index():
    return _no_cache(send_from_directory(FRONTEND, "index.html"))


def _no_cache(response):
    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["Pragma"] = "no-cache"
    return response


@app.get("/m")
def mobile_index():
    return _no_cache(send_from_directory(FRONTEND, "mobile.html"))


@app.get("/favicon.ico")
def favicon_ico():
    return send_from_directory(FRONTEND, "favicon.ico", mimetype="image/x-icon")


@app.get("/favicon.png")
def favicon_png():
    return send_from_directory(FRONTEND, "favicon.png", mimetype="image/png")


@app.get("/favicon.svg")
def favicon_svg():
    return send_from_directory(FRONTEND, "favicon.svg", mimetype="image/svg+xml")


@app.get("/<path:filename>")
def static_files(filename: str):
    response = send_from_directory(FRONTEND, filename)
    if filename in {"mobile.js", "mobile.css", "mobile.html", "app.js", "cloud.js", "calc.js", "presentation.js", "pdf.js", "vault.js", "datepicker.js", "styles.css", "charts.js"}:
        return _no_cache(response)
    return response


def _recent_payload() -> list[dict[str, Any]]:
    cfg = storage.load_config()
    recent = []
    for item in cfg.get("recent", []):
        path = item.get("path")
        if not path:
            continue
        exists = os.path.exists(path)
        row = {**item, "exists": exists}
        if exists:
            row = storage.with_volume(row)
        recent.append(row)
    return recent


def _autosave_on() -> bool:
    return bool(storage.load_config().get("autosave"))


def _mobile_url(base: str, token: str) -> str:
    return f"{base.rstrip('/')}/m?t={token}"


def _share_profiles() -> list[dict[str, Any]]:
    """Профили полей снимка для заказчика — те же, что в окне на компьютере."""
    raw = storage.ui_prefs().get("share_profiles")
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = " ".join(str(item.get("name") or "").split())
        fields = item.get("fields")
        if not name or not isinstance(fields, list):
            continue
        out.append(
            {
                "name": name[:80],
                "fields": [str(field) for field in fields if isinstance(field, str)],
                "hideLabels": bool(item.get("hideLabels")),
                "hideStamp": bool(item.get("hideStamp")),
            }
        )
        if len(out) >= 40:
            break
    return out


def _qr_svg(url: str) -> str:
    try:
        return qr.svg(url, module=6)
    except Exception:
        return ""


def _telegram_sync_menu() -> None:
    """Кнопка Mini App в меню бота. Не поднимает туннель — только текущий HTTPS."""
    settings = storage.remote_settings()
    token = str(settings.get("telegram_bot_token") or TELEGRAM.token() or "")
    if not token:
        return
    url = ""
    if REMOTE.enabled:
        public_base = str(TUNNEL.snapshot().get("url") or "")
        if public_base.startswith("https://"):
            url = _mobile_url(public_base, REMOTE.token or settings.get("token") or "")
    telegram_set_menu(token, url)


def _telegram_live_url(chat_id: str = "") -> dict[str, Any]:
    """Возвращает ссылку и состояние тумблеров. Выключенный доступ сам не поднимает."""
    settings = storage.remote_settings()
    if chat_id and not settings.get("telegram_chat_id"):
        settings = storage.save_remote_settings(telegram_chat_id=str(chat_id))
    access_on = bool(REMOTE.enabled)
    ngrok_on = bool(settings.get("ngrok"))
    url = ""
    if access_on:
        if ngrok_on:
            _ensure_tunnel(settings)
        public = _remote_public()
        url = str(public.get("public_url") or public.get("url") or "")
    _telegram_sync_menu()
    return {"url": url, "access": access_on, "ngrok": ngrok_on}


def _set_web_access(enabled: bool) -> dict[str, Any]:
    """Тумблер веб-интерфейса: то же, что «Включить доступ» в окне «Телефон»."""
    settings = storage.remote_settings()
    if enabled:
        storage.save_remote_settings(autostart=True)
        REMOTE.start(str(settings.get("token") or ""))
    else:
        REMOTE.stop()
        TUNNEL.stop()
        storage.save_remote_settings(autostart=False)
    return _telegram_live_url()


def _start_telegram(settings: dict[str, Any] | None = None) -> None:
    cfg = settings or storage.remote_settings()
    token = str(cfg.get("telegram_bot_token") or TELEGRAM.token() or "").strip()
    if not token:
        return
    TELEGRAM.start(
        token,
        int(cfg.get("telegram_offset") or 0),
        on_request=_telegram_live_url,
        on_offset=lambda value: storage.save_remote_settings(telegram_offset=value),
        on_rotate=_rotate_remote_link,
        on_access=_set_web_access,
    )
    _telegram_sync_menu()


def _ensure_tunnel(settings: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = settings or storage.remote_settings()
    snap = TUNNEL.snapshot()
    if not cfg.get("ngrok"):
        return {**snap, "wanted": False}
    if snap.get("url"):
        _telegram_sync_menu()
        return {**snap, "wanted": True}
    try:
        TUNNEL.start(SERVER_PORT, str(cfg.get("ngrok_token") or ""))
        snap = TUNNEL.snapshot()
        _telegram_sync_menu()
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
    # Адрес агента есть и без интернета. Наружу отдаём его только если связь реально есть.
    public_base = str(tunnel.get("url") or "") if tunnel.get("online") else ""
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
            "online": bool(tunnel.get("online")),
        },
    }


@app.get("/api/bootstrap")
def api_bootstrap():
    cfg = storage.load_config()
    return jsonify(
        {
            "recent": _recent_payload(),
            "library": storage.list_library_reports(),
            "autosave": bool(cfg.get("autosave")),
            "history_limit": storage.history_limit(),
            "last_dir": cfg.get("last_dir") or "",
            "theme": "dark" if cfg.get("theme") == "dark" else "light",
            "ui_prefs": storage.ui_prefs(),
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
    version = REMOTE.notify() if REMOTE.enabled else 0
    return jsonify({"ok": True, "autosave": enabled, "version": version})


@app.post("/api/history")
def api_history():
    data = request.get_json(silent=True) or {}
    path = str(data.get("path") or "")
    if not path:
        return jsonify({"error": "Нет пути файла."}), 400
    saved = storage.save_doc_history(path, data)
    return jsonify({"ok": True, "history": saved, "history_limit": storage.history_limit()})


@app.get("/api/history/library")
def api_history_library():
    path = str((request.args.get("path") if request.args else "") or "")
    return jsonify({"ok": True, **storage.list_histories(path)})


@app.post("/api/history/delete")
def api_history_delete():
    data = request.get_json(silent=True) or {}
    name = str(data.get("folder") or "")
    try:
        storage.delete_history_folder(name)
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"ok": True, **storage.list_histories(str(data.get("path") or ""))})


@app.post("/api/history/limit")
def api_history_limit():
    n = storage.set_history_limit((request.get_json(silent=True) or {}).get("limit"))
    return jsonify({"ok": True, "history_limit": n})


@app.post("/api/theme")
def api_theme():
    data = request.get_json(silent=True) or {}
    theme = storage.set_theme(data.get("theme") or "light")
    return jsonify({"ok": True, "theme": theme})


@app.post("/api/ui-pref")
def api_ui_pref():
    data = request.get_json(silent=True) or {}
    key = str(data.get("key") or "")
    try:
        prefs = storage.set_ui_pref(key, data.get("value"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    if key == "share_profiles":
        REMOTE.notify()
    return jsonify({"ok": True, "ui_prefs": prefs})


@app.post("/api/recent/remove")
def api_recent_remove():
    data = request.get_json(silent=True) or {}
    path = data.get("path") or ""
    storage.remove_recent(path)
    return jsonify({"ok": True, "recent": _recent_payload()})


@app.get("/api/library")
def api_library():
    return jsonify(storage.list_library_reports())


def _on_library_change() -> None:
    if REMOTE.enabled:
        REMOTE.notify()


def _ensure_library_watch() -> None:
    WATCHER.set_hook(_on_library_change)
    WATCHER.start()


@app.get("/api/library/watch")
def api_library_watch():
    if not _is_local():
        return jsonify({"error": "Список папки можно слушать только на компьютере."}), 403
    _ensure_library_watch()
    since = request.args.get("since", type=int) or 0
    version = WATCHER.wait(since)
    return jsonify(
        {
            "ok": True,
            "version": version,
            "library": storage.list_library_reports(),
            "recent": _recent_payload(),
        }
    )


def _delete_library_file(path: str) -> dict[str, Any]:
    full = storage.delete_library_report(path)
    closed = storage.same_path(REMOTE.path, full)
    if closed:
        REMOTE.clear_document()
    library = storage.list_library_reports()
    recent = _recent_payload()
    if REMOTE.enabled:
        REMOTE.issue_command("delete", path=full, closed=closed, library=library, recent=recent)
    return {
        "ok": True,
        "path": full,
        "closed": closed,
        "library": library,
        "recent": recent,
    }


@app.post("/api/library/delete")
def api_library_delete():
    if not _is_local():
        return jsonify({"error": "Удалять с телефона можно через сессию."}), 403
    data = request.get_json(silent=True) or {}
    try:
        return jsonify(_delete_library_file(str(data.get("path") or "")))
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except OSError as exc:
        return jsonify({"error": f"Не удалось удалить файл: {exc}"}), 500


@app.post("/api/open-folder")
def api_open_folder():
    if not _is_local():
        return jsonify({"error": "Папку можно открыть только на компьютере."}), 403
    path = storage.default_reports_dir()
    try:
        if os.name == "nt":
            os.startfile(path)
        else:
            webbrowser.open(path)
    except OSError as exc:
        return jsonify({"error": str(exc)}), 500
    return jsonify({"ok": True, "path": os.path.abspath(path)})


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
    abs_path = os.path.abspath(path)
    return {
        "path": abs_path,
        "document": doc,
        "recent": recent,
        "cancelled": False,
        "history": storage.load_doc_history(abs_path),
        "history_limit": storage.history_limit(),
    }


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
    abs_path = os.path.abspath(path)
    history = data.get("history")
    if isinstance(history, dict):
        history = {**history, "title": doc.get("title") or history.get("title") or ""}
        storage.save_doc_history(abs_path, history)
    return jsonify(
        {
            "path": abs_path,
            "document": doc,
            "recent": recent,
            "history": storage.load_doc_history(abs_path),
            "history_limit": storage.history_limit(),
        }
    )


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


@app.post("/api/dialog/pdf")
def api_dialog_pdf():
    data = request.get_json(silent=True) or {}
    suggested = data.get("suggested") or "Заказы.pdf"
    path = save_pdf_dialog(suggested, storage.load_config().get("last_dir") or "")
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
    _telegram_sync_menu()
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
        g.netlog_text = "QR переключён на интернет"
        g.netlog_level = "ok"
        g.netlog_key = "addr-ngrok"
        _telegram_sync_menu()
        return jsonify(payload)
    if ip not in lan_candidates():
        return jsonify({"error": "Неизвестный адрес."}), 400
    storage.save_remote_settings(via="lan")
    payload = _remote_public(ip, via="lan")
    payload["ok"] = True
    g.netlog_text = f"QR переключён на {ip}"
    g.netlog_key = "addr-lan"
    return jsonify(payload)


@app.post("/api/remote/ngrok")
def api_remote_ngrok():
    data = request.get_json(silent=True) or {}
    updates: dict[str, Any] = {}
    if "authtoken" in data:
        token = str(data.get("authtoken") or "").strip()
        if token and not storage.valid_ngrok_token(token):
            return jsonify({"error": "Это не токен ngrok. Скопируйте Authtoken с dashboard.ngrok.com."}), 400
        if storage.valid_ngrok_token(token):
            updates["ngrok_token"] = token
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
    _telegram_sync_menu()
    return jsonify(payload)


@app.post("/api/remote/telegram")
def api_remote_telegram():
    """Сохраняет токен бота и шлёт актуальную ссылку в Telegram."""
    if not _is_local():
        return jsonify({"error": "Доступ запрещён."}), 403
    data = request.get_json(silent=True) or {}
    updates: dict[str, Any] = {}
    if "token" in data:
        token = str(data.get("token") or "").strip()
        if token and not storage.valid_telegram_token(token):
            return jsonify({"error": "Это не токен бота. Скопируйте его целиком у @BotFather."}), 400
        if storage.valid_telegram_token(token):
            updates["telegram_bot_token"] = token
    if "chat_id" in data:
        chat = str(data.get("chat_id") or "").strip()
        if chat:
            updates["telegram_chat_id"] = chat
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
                {"access": True, "ngrok": bool(settings.get("ngrok")), "url": payload.get("url") or ""},
            )
            if chat_id and chat_id != settings.get("telegram_chat_id"):
                storage.save_remote_settings(telegram_chat_id=chat_id)
                payload = _remote_public()
        except RuntimeError as exc:
            return jsonify({**payload, "error": str(exc)}), 400
        g.netlog_text = "Ссылка отправлена в Telegram"
        g.netlog_level = "ok"
        g.netlog_key = "tg-send"
    payload = _remote_public()
    payload["ok"] = True
    _telegram_sync_menu()
    return jsonify(payload)


@app.post("/api/remote/stop")
def api_remote_stop():
    REMOTE.stop()
    TUNNEL.stop()
    storage.save_remote_settings(autostart=False)
    _telegram_sync_menu()
    return jsonify({"ok": True, **_remote_public()})


def _rotate_remote_link() -> dict[str, Any]:
    """Новая ссылка для телефона: бот и токены ngrok/Telegram не сбрасываются."""
    settings = storage.rotate_remote_token()
    if REMOTE.enabled:
        REMOTE.start(settings["token"])
    payload = _remote_public()
    link = str(payload.get("public_url") or payload.get("url") or "")
    chats = [str(settings.get("telegram_chat_id") or "")]
    chats.extend(TELEGRAM.chat_ids())
    telegram_push_open(
        str(settings.get("telegram_bot_token") or TELEGRAM.token() or ""),
        chats,
        link,
        "Новая ссылка готова. Старая закладка больше не работает — нажмите <b>Открыть</b>.",
    )
    netlog.add("session", "Выпущена новая ссылка", level="warn", key="rotate")
    return payload


@app.post("/api/remote/rotate")
def api_remote_rotate():
    payload = _rotate_remote_link()
    payload["ok"] = True
    g.netlog_text = "Выпущена новая ссылка"
    g.netlog_level = "warn"
    g.netlog_key = "rotate"
    return jsonify(payload)


@app.post("/api/remote/forget")
def api_remote_forget():
    data = request.get_json(silent=True) or {}
    cid = str(data.get("id") or "")
    devices = storage.forget_device(cid)
    g.netlog_text = f"Устройство забыто: {cid[:12]}" if cid else "Устройство забыто"
    g.netlog_level = "warn"
    g.netlog_key = f"forget-{cid}"
    return jsonify({"ok": True, "devices": devices})


@app.get("/api/remote/log")
def api_remote_log():
    if not _is_local():
        return jsonify({"error": "Только в окне программы."}), 403
    since = request.args.get("since", type=int) or 0
    return jsonify(netlog.since(since))


@app.post("/api/remote/log/clear")
def api_remote_log_clear():
    if not _is_local():
        return jsonify({"error": "Только в окне программы."}), 403
    return jsonify(netlog.clear())


@app.get("/api/remote/info")
def api_remote_info():
    if request.args.get("probe") == "1":
        settings = storage.remote_settings()
        if settings.get("ngrok") and settings.get("ngrok_token"):
            TUNNEL.probe(SERVER_PORT, wanted=True, timeout=2.5)
    snap = REMOTE.snapshot(with_doc=False)
    snap.update(_remote_public())
    snap["autosave"] = _autosave_on()
    return jsonify(snap)


@app.post("/api/remote/check")
def api_remote_check():
    """Явная проверка ngrok или Telegram: запрос в сервис и свежие индикаторы."""
    if not _is_local():
        return jsonify({"error": "Только в окне программы."}), 403
    data = request.get_json(silent=True) or {}
    kind = str(data.get("kind") or "")
    settings = storage.remote_settings()
    if kind == "ngrok":
        if not settings.get("ngrok"):
            payload = _remote_public()
            payload["ok"] = True
            payload["check"] = "Туннель выключен."
            return jsonify(payload)
        if not settings.get("ngrok_token"):
            payload = _remote_public()
            payload["ok"] = False
            payload["check"] = "Токен ngrok не сохранён."
            return jsonify(payload)
        TUNNEL.probe(SERVER_PORT, wanted=True, force=True)
        payload = _remote_public()
        tunnel = payload.get("tunnel") or {}
        if settings.get("ngrok") and payload.get("public_url") and (payload.get("tunnel") or {}).get("online", True):
            text = "Туннель открыт. Связь с ngrok есть."
            ok = True
        elif not settings.get("ngrok"):
            text = "Туннель выключен. Токен сохранён."
            ok = True
        else:
            text = str(tunnel.get("error") or "Туннель сейчас не открыт.")
            ok = False
        payload["ok"] = ok
        payload["check"] = text
        g.netlog_text = text
        g.netlog_level = "ok" if ok else "err"
        g.netlog_key = "ngrok-check"
        return jsonify(payload)
    if kind == "telegram":
        token = str(data.get("token") or settings.get("telegram_bot_token") or "").strip()
        result = TELEGRAM.probe(token)
        payload = _remote_public()
        username = str(result.get("username") or "")
        who = f"@{username}" if username else "бот"
        if result.get("ok") and result.get("listening"):
            text = f"Связь есть: {who} слушает сообщения."
            ok = True
        elif result.get("ok"):
            text = f"Токен верный ({who}), но бот сейчас не слушает."
            ok = False
        else:
            text = str(result.get("error") or "Нет связи с Telegram.")
            ok = False
        payload["ok"] = ok
        payload["check"] = text
        g.netlog_text = text
        g.netlog_level = "ok" if ok else "err"
        g.netlog_key = "tg-check"
        return jsonify(payload)
    return jsonify({"error": "Нечего проверять."}), 400


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
    info = _device_info()
    name = name or str(info.get("name") or "")
    REMOTE.touch(cid, kind, name)
    if kind == "mobile" and cid:
        storage.remember_device(cid, name, request.remote_addr or "", info)
    snap = REMOTE.wait(since)
    if "clients" not in snap:
        snap["clients"] = REMOTE.clients()
    snap["devices"] = storage.remote_settings().get("devices") or []
    snap["recent"] = _recent_payload()
    snap["library"] = storage.list_library_reports()
    snap["autosave"] = _autosave_on()
    snap["share_profiles"] = _share_profiles()
    return jsonify(snap)


@app.get("/api/remote/session")
def api_remote_session():
    """Стартовые данные мобильного клиента."""
    snap = REMOTE.snapshot(with_doc=True)
    snap["recent"] = _recent_payload()
    snap["library"] = storage.list_library_reports()
    snap["desktop_online"] = bool(REMOTE.clients("desktop"))
    snap["autosave"] = _autosave_on()
    snap["share_profiles"] = _share_profiles()
    cid = request.args.get("cid") or ""
    name = request.args.get("name") or ""
    if cid:
        info = _device_info()
        name = name or str(info.get("name") or "")
        REMOTE.touch(cid, "mobile", name)
        storage.remember_device(cid, name, request.remote_addr or "", info)
        g.netlog_text = f"Телефон открыл сессию: {name or cid[:8]}"
        g.netlog_level = "ok"
        g.netlog_key = f"sess-{cid}"
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
    if kind not in {"save", "open", "new", "undo", "redo", "delete", "history_jump", "history_limit"}:
        return jsonify({"error": "Неизвестная команда."}), 400
    payload: dict[str, Any] = {}
    if kind == "open":
        path = str(data.get("path") or "")
        if not path or not os.path.exists(path):
            return jsonify({"error": "Файл не найден."}), 404
        payload["path"] = os.path.abspath(path)
    if kind == "history_jump":
        payload["id"] = str(data.get("id") or "")
    if kind == "history_limit":
        payload["limit"] = storage.set_history_limit(data.get("limit"))
    if kind == "delete":
        try:
            result = _delete_library_file(str(data.get("path") or ""))
        except FileNotFoundError as exc:
            return jsonify({"error": str(exc)}), 404
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        except OSError as exc:
            return jsonify({"error": f"Не удалось удалить файл: {exc}"}), 500
        return jsonify({**result, "version": REMOTE.version})
    if kind == "new":
        title = storage.safe_report_title(str(data.get("title") or "Новый отчёт"))
        path = storage.default_report_path(title)
        if os.path.exists(path):
            return (
                jsonify(
                    {
                        "error": "Файл с таким названием уже есть.",
                        "code": "exists",
                        "title": title,
                        "suggested": storage.suggest_report_title(title),
                    }
                ),
                409,
            )
        try:
            doc = empty_document(title)
            storage.atomic_write(path, json.dumps(doc, ensure_ascii=False, indent=2))
            storage.add_recent(path, title)
        except OSError as exc:
            return jsonify({"error": f"Не удалось сохранить отчёт: {exc}"}), 500
        version = REMOTE.issue_command("open", path=os.path.abspath(path))
        return jsonify({"ok": True, "version": version, "path": os.path.abspath(path), "title": title})
    version = REMOTE.issue_command(kind, **payload)
    return jsonify({"ok": True, "version": version})


@app.post("/api/remote/nav")
def api_remote_nav():
    """Телефон открыл экран или заказ — компьютер показывает то же самое."""
    if not REMOTE.enabled:
        return jsonify({"error": "Сессия закрыта."}), 409
    data = request.get_json(silent=True) or {}
    view = str(data.get("view") or "")
    if view not in {"orders", "order", "stats", "files", "snapshot", "calendar"}:
        return jsonify({"error": "Неизвестный экран."}), 400
    version = REMOTE.set_nav(
        view,
        str(data.get("order_id") or ""),
        str(data.get("cid") or ""),
        period=str(data.get("period") or ""),
        order_filter=str(data.get("filter") or ""),
        status=str(data.get("status") or ""),
        line_id=str(data.get("line_id") or ""),
    )
    return jsonify({"ok": True, "version": version})


@app.post("/api/remote/autosave")
def api_remote_autosave():
    """Телефон включает или выключает автосохранение на компьютере."""
    if not REMOTE.enabled:
        return jsonify({"error": "Сессия закрыта."}), 409
    data = request.get_json(silent=True) or {}
    enabled = bool(data.get("enabled"))
    storage.set_autosave(enabled)
    version = REMOTE.notify()
    g.netlog_text = "Автосохранение включено" if enabled else "Автосохранение выключено"
    g.netlog_level = "ok"
    g.netlog_key = "autosave"
    return jsonify({"ok": True, "autosave": enabled, "version": version})


@app.post("/api/remote/leave")
def api_remote_leave():
    data = request.get_json(silent=True) or {}
    REMOTE.drop(str(data.get("cid") or ""))
    return jsonify({"ok": True})


@app.post("/api/remote/snapshot-png")
def api_remote_snapshot_png():
    """Mini App не умеет сохранить blob в Загрузки — бот кладёт PNG в Telegram."""
    if not REMOTE.enabled:
        return jsonify({"error": "Сессия закрыта."}), 409
    data = request.get_json(silent=True) or {}
    raw = str(data.get("png") or "").strip()
    if raw.startswith("data:") and "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        png = base64.b64decode(raw, validate=False)
    except (ValueError, TypeError):
        return jsonify({"error": "Не удалось прочитать картинку."}), 400
    if len(png) < 32 or png[:8] != b"\x89PNG\r\n\x1a\n":
        return jsonify({"error": "Это не PNG-снимок."}), 400
    if len(png) > 6 * 1024 * 1024:
        return jsonify({"error": "Снимок слишком большой для Telegram."}), 400
    mode = str(data.get("mode") or "share").strip().lower()
    if mode not in {"share", "save"}:
        mode = "share"
    try:
        user_id = int(data.get("user_id") or 0)
    except (TypeError, ValueError):
        user_id = 0
    try:
        result = TELEGRAM.deliver_webapp_snapshot(
            png,
            str(data.get("filename") or "finmaster-snapshot.png"),
            str(data.get("caption") or "Снимок заказа"),
            mode,
            user_id,
        )
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 409
    g.netlog_text = "Mini App отправил снимок в Telegram"
    g.netlog_level = "ok"
    g.netlog_key = "snap-png"
    return jsonify(result)


def _window_is_fullscreen() -> bool:
    window = WINDOW
    native = getattr(window, "native", None) if window is not None else None
    if native is not None and hasattr(native, "is_fullscreen"):
        try:
            return bool(native.is_fullscreen)
        except Exception:
            pass
    return WINDOW_FULLSCREEN


@app.post("/api/window/fullscreen")
def api_window_fullscreen():
    global WINDOW_FULLSCREEN
    if not _is_local():
        return jsonify({"error": "Только в окне программы."}), 403
    window = WINDOW
    if window is None or not hasattr(window, "toggle_fullscreen"):
        return jsonify({"ok": False, "desktop": False, "fullscreen": False})
    current = _window_is_fullscreen()
    data = request.get_json(silent=True) or {}
    want = data.get("on")
    target = (not current) if want is None else bool(want)
    if target != current:
        try:
            window.toggle_fullscreen()
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc), "fullscreen": current}), 500
        WINDOW_FULLSCREEN = target
    return jsonify({"ok": True, "desktop": True, "fullscreen": _window_is_fullscreen()})


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


def main(splash=None) -> None:
    global WINDOW, WINDOW_FULLSCREEN, FORCE_CLOSE, DIRTY, SERVER_PORT

    def report(text: str, progress: float | None = None) -> None:
        if splash is not None:
            splash.step(text, progress)

    report("Чтение настроек…", 40)
    cfg = storage.load_config()
    recent = cfg.get("recent") or []
    report(f"Недавних отчётов: {len(recent)}", 46)
    _ensure_library_watch()

    port = pick_port()
    SERVER_PORT = port
    report(f"Свободный порт {port}", 52)
    settings = storage.remote_settings()
    if settings.get("autostart"):
        report("Включаю доступ с телефона…", 56)
        REMOTE.start(settings["token"])
    url = f"http://127.0.0.1:{port}/"
    report("Запуск локального сервера…", 60)
    thread = threading.Thread(target=run_server, args=(port,), daemon=True)
    thread.start()

    ready = False
    for i in range(50):
        try:
            import urllib.request

            urllib.request.urlopen(url, timeout=0.2)
            ready = True
            break
        except Exception:
            # Soft climb 60→82 while waiting — display eases, so no hard jumps
            report("Ожидание ответа сервера…", min(60 + i * 0.45, 82))
            time.sleep(0.1)
    if ready:
        report("Сервер готов", 86)
    else:
        report("Сервер ещё поднимается…", 86)

    if settings.get("autostart") and settings.get("ngrok"):
        report("Подключение интернет-туннеля…", 90)
        threading.Thread(target=lambda: _ensure_tunnel(settings), daemon=True).start()
    if settings.get("telegram_bot_token"):
        report("Запуск Telegram-бота…", 92)
        threading.Thread(target=lambda: _start_telegram(settings), daemon=True).start()

    try:
        import webview
    except ImportError:
        if splash is not None:
            if hasattr(splash, "finish"):
                splash.finish(1.0)
            else:
                splash.close()
        print("pywebview не установлен — открываю системный браузер.")
        print("Для отдельного окна выполните: pip install -r requirements.txt")
        webbrowser.open(url)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            return

    report("Открываю окно…", 96)
    WINDOW = webview.create_window(
        "FinMaster — учёт заказов",
        url,
        width=1440,
        height=920,
        min_size=(1180, 740),
        maximized=storage.window_maximized(),
        background_color="#0b1220",
    )
    WINDOW_FULLSCREEN = False

    def remember_maximized(value: bool) -> None:
        try:
            storage.set_window_maximized(value)
        except Exception:
            pass

    def persist_window_state() -> None:
        try:
            native = getattr(WINDOW, "native", None)
            state = getattr(native, "WindowState", None) if native is not None else None
            if state is not None:
                remember_maximized(str(state) in ("Maximized", "2"))
                return
            if hasattr(WINDOW, "maximized"):
                remember_maximized(bool(WINDOW.maximized))
        except Exception:
            pass

    try:
        WINDOW.events.maximized += lambda: remember_maximized(True)
        WINDOW.events.restored += lambda: remember_maximized(False)
    except Exception:
        pass

    try:
        def restore_window_state() -> None:
            if storage.window_maximized():
                try:
                    WINDOW.maximize()
                except Exception:
                    pass

        WINDOW.events.loaded += restore_window_state
    except Exception:
        pass

    def on_closing():
        persist_window_state()
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
    start_opts = {}
    if os.path.exists(ICON_PATH):
        start_opts["icon"] = ICON_PATH
    report("Открываю окно…", 100)
    if splash is not None:
        if hasattr(splash, "finish"):
            splash.finish(2.0)
        else:
            time.sleep(2.0)
            splash.close()
    webview.start(**start_opts)


if __name__ == "__main__":
    from backend.splash import Splash, hide_console

    hide_console()
    boot = Splash(os.path.join(FRONTEND, "favicon.png"))
    try:
        boot.step("Запуск FinMaster…", 8)
        sys.exit(main(boot) or 0)
    except Exception as exc:
        boot.fail(str(exc))
        sys.exit(1)
