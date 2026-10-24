# -*- coding: utf-8 -*-
"""Web 控制台 HTTP 服务端与路由处理。"""

from __future__ import annotations

import json
import mimetypes
import pathlib
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qs, unquote, urlparse

from ..auth.login import AigisRequired
from ..core.logs import print_startup_banner

if TYPE_CHECKING:
    from .web import WebApp

WEB_ROOT = pathlib.Path(__file__).resolve().parents[1] / "webui"
AUTH_COOKIE = "myq_token"


def first_query(query: dict[str, list[str]], key: str, default: str = "") -> str:
    """提取 Query 参数中的首个值。"""
    values = query.get(key)
    if not values:
        return default
    return values[0]


class Handler(BaseHTTPRequestHandler):
    """Web 控制台 RESTful API 与静态资源 HTTP 处理器。"""

    app: Any

    def log_message(self, format: str, *args: object) -> None:
        return

    def _get_cookie(self, name: str) -> str:
        cookie_header = self.headers.get("Cookie", "")
        for part in cookie_header.split(";"):
            part = part.strip()
            if part.startswith(f"{name}="):
                return part[len(name) + 1:]
        return ""

    def _is_authenticated(self) -> bool:
        return True

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        try:
            if path == "/api/auth/status":
                self.send_json(self.app.auth_status())
                return
            if path == "/api/config":
                self.send_json(self.app.get_config())
                return
            if path == "/api/status":
                self.send_json(self.app.status())
                return
            if path == "/api/records":
                try:
                    limit_val = int(first_query(query, "limit", "50") or 50)
                except (ValueError, TypeError):
                    limit_val = 50
                records = self.app.get_records(limit_val)
                self.send_json({"records": records, "total": len(records)})
                return
            if path == "/api/shop/goods":
                game_param = first_query(query, "game")
                if game_param is None:
                    game_param = "hk4e"
                self.send_json(self.app.shop_goods(str(game_param)))
                return
            if path == "/api/shop/good-detail":
                self.send_json(self.app.shop_good_detail(str(first_query(query, "goods_id"))))
                return
            if path == "/api/shop/account-meta":
                try:
                    account_index = int(first_query(query, "account_index", "0") or 0)
                except (ValueError, TypeError):
                    account_index = 0
                game_biz = str(first_query(query, "game_biz", ""))
                self.send_json(self.app.shop_account_meta(account_index, game_biz))
                return
            if path == "/api/shop/device-fp":
                self.send_json(self.app.ensure_shop_device_fp())
                return
            self.serve_static(path)
        except Exception as exc:
            self.send_error_json(str(exc), HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            payload = self.read_json()
            if path in ("/api/auth/setup", "/api/auth/login"):
                self.send_json({"ok": True})
                return
            if path == "/api/config":
                self.app.set_config(payload)
                self.send_json({"ok": True})
                return
            if path == "/api/run":
                self.app.log("收到手动执行请求", "web")
                force = bool(payload.get("force", False)) if isinstance(payload, dict) else False
                if not force and self.app.scheduler.get_records_fn:
                    try:
                        records = self.app.scheduler.get_records_fn()
                        today_records = self.app.scheduler._get_today_signin_records(records, datetime.now().date())
                        if any(r.get("status") == "success" for r in today_records):
                            self.send_json({"ok": False, "already_signed": True, "message": "今日已完成打卡签到，无需重复签到"})
                            return
                    except Exception:
                        pass
                started = self.app.scheduler.run_now(force=force)
                if not started:
                    self.app.log("手动执行请求被拒绝：任务正在运行", "scheduler")
                    self.send_error_json("任务正在运行", HTTPStatus.CONFLICT)
                    return
                self.send_json({"ok": True})
                return
            if path == "/api/records/clear":
                self.app.clear_records()
                self.send_json({"ok": True})
                return
            if path == "/api/login/start":
                account_index = int(payload.get("account_index", -1))
                timeout = int(payload.get("timeout") or 120)
                account_payload = payload.get("account")
                if account_payload is not None and not isinstance(account_payload, dict):
                    raise ValueError("账号数据必须是 JSON 对象")
                self.app.start_login(account_index, timeout, account_payload, bool(payload.get("draft")))
                self.send_json({"ok": True})
                return
            if path == "/api/login/captcha/send":
                account_index = int(payload.get("account_index", -1))
                account_payload = payload.get("account")
                if account_payload is not None and not isinstance(account_payload, dict):
                    raise ValueError("账号数据必须是 JSON 对象")
                result = self.app.send_login_captcha(
                    account_index,
                    str(payload.get("phone") or ""),
                    account_payload,
                    bool(payload.get("draft")),
                    str(payload.get("aigis") or ""),
                )
                self.send_json({"ok": True, **result})
                return
            if path == "/api/login/captcha/verify":
                account_index = int(payload.get("account_index", -1))
                account_payload = payload.get("account")
                if account_payload is not None and not isinstance(account_payload, dict):
                    raise ValueError("账号数据必须是 JSON 对象")
                result = self.app.complete_login_captcha(
                    account_index,
                    str(payload.get("phone") or ""),
                    str(payload.get("captcha") or ""),
                    str(payload.get("action_type") or ""),
                    account_payload,
                    bool(payload.get("draft")),
                    str(payload.get("aigis") or ""),
                )
                self.send_json({"ok": True, **result})
                return
            if path == "/api/login/refresh":
                self.app.refresh_login_qr()
                self.send_json({"ok": True})
                return
            if path == "/api/login/cancel":
                self.app.cancel_login()
                self.send_json({"ok": True})
                return
            if path == "/api/shop/exchange":
                if "plan_index" in payload:
                    result = self.app.shop_exchange_plan_once(int(payload.get("plan_index")))
                    self.send_json({"ok": True, "result": result, "config": self.app.get_config()})
                    return
                plan = payload.get("plan")
                if not isinstance(plan, dict):
                    raise ValueError("兑换计划必须是 JSON 对象")
                result = self.app.shop_exchange_once(plan)
                self.send_json({"ok": True, "result": result})
                return
            self.send_error_json("接口不存在", HTTPStatus.NOT_FOUND)
        except AigisRequired as exc:
            self.send_json(
                {
                    "ok": False,
                    "error": str(exc),
                    "code": "aigis_required",
                    "aigis": exc.aigis,
                },
                HTTPStatus.PRECONDITION_REQUIRED,
            )
        except Exception as exc:
            self.send_error_json(str(exc), HTTPStatus.BAD_REQUEST)

    def serve_static(self, path: str) -> None:
        if path == "/":
            path = "/index.html"
        relative = pathlib.Path(unquote(path).lstrip("/"))
        if len(relative.parts) > 0:
            file_part = relative.parts[-1]
            if "?" in file_part:
                file_part = file_part.split("?")[0]
                relative = pathlib.Path(*relative.parts[:-1], file_part)

        target = (WEB_ROOT / relative).resolve()
        root = WEB_ROOT.resolve()
        if root not in target.parents and target != root:
            self.send_error_json("路径非法", HTTPStatus.FORBIDDEN)
            return
        if target.name in ("index.html", "app.js"):
            try:
                from ..webui.bundle import ensure_bundled
                ensure_bundled()
            except Exception:
                pass
        if not target.exists() or not target.is_file():
            self.send_error_json("文件不存在", HTTPStatus.NOT_FOUND)
            return
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        data = target.read_bytes()

        if content_type == "text/html":
            html_content = data.decode("utf-8")
            app_js_path = WEB_ROOT / "app.js"
            if app_js_path.exists():
                mtime = int(app_js_path.stat().st_mtime)
                html_content = html_content.replace('src="/app.js"', f'src="/app.js?v={mtime}"')
            data = html_content.encode("utf-8")

        mtime = target.stat().st_mtime
        size = target.stat().st_size
        etag = f'"{int(mtime)}-{size}"'

        if self.headers.get("If-None-Match") == etag:
            self.send_response(HTTPStatus.NOT_MODIFIED)
            self.end_headers()
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("ETag", etag)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("请求体必须是 JSON 对象")
        return data

    def send_json(self, data: dict[str, Any], status: HTTPStatus = HTTPStatus.OK, set_cookie: str = "") -> None:
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        if set_cookie:
            self.send_header("Set-Cookie", f"{AUTH_COOKIE}={set_cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800")
        self.end_headers()
        self.wfile.write(raw)

    def send_error_json(self, message: str, status: HTTPStatus) -> None:
        self.send_json({"ok": False, "error": message}, status=status)


def create_server(host: str, port: int) -> tuple[ThreadingHTTPServer, int]:
    """创建并绑定 ThreadingHTTPServer，端口被占用时自动递增重试。"""
    last_error: OSError | None = None
    for candidate in range(port, port + 30):
        try:
            return ThreadingHTTPServer((host, candidate), Handler), candidate
        except OSError as exc:
            last_error = exc
            if getattr(exc, "winerror", None) not in (10013, 10048):
                raise
    raise OSError(f"端口 {port}-{port + 29} 都无法监听: {last_error}")


def serve(config_path: pathlib.Path, host: str, port: int) -> None:
    """启动本地 Web 控制台服务。"""
    from .web import WebApp
    try:
        from ..webui.bundle import ensure_bundled
        ensure_bundled()
    except Exception:
        pass

    app = WebApp(config_path, host, port)
    Handler.app = app
    print_startup_banner("MYQ")
    app.log(f"正在启动 Web 控制台，配置文件: {config_path.resolve()}", "startup")
    server, actual_port = create_server(host, port)
    app.port = actual_port
    if actual_port != port:
        app.log(f"端口 {port} 被占用，已切换到 {actual_port}", "startup")
    app.start()

    if host == "0.0.0.0":
        local_url = f"http://127.0.0.1:{actual_port}"
        app.log(f"Web 控制台已启动: {local_url}", "web")
        app.log("外网访问请替换为实际 IP 地址", "web")
    else:
        url = f"http://{host}:{actual_port}"
        app.log(f"Web 控制台已启动: {url}", "web")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        app.log("收到退出信号，正在停止 Web 控制台", "startup")
    finally:
        app.stop()
        server.server_close()
        app.log("Web 控制台已停止", "startup")
