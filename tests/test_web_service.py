# -*- coding: utf-8 -*-
import json
import pathlib
import tempfile
import threading
import unittest
from http import HTTPStatus
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer

from miyouqian.core.config import save_config
from miyouqian.service.web import Handler, WebApp


class WebServiceDirectAccessTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.config_path = pathlib.Path(self.temp_dir.name) / "config.json"
        self.config = {
            "enable": True,
            "accounts": [],
            "storage": {
                "data_dir": "data",
                "account_file": "account.json",
                "records_file": "records.json",
                "log_dir": "logs",
                "log_file": "test.log",
            },
            "features": {"game_checkin": False, "cloud_game_checkin": False, "bbs_tasks": False},
            "web": {"host": "0.0.0.0", "port": 0},
        }
        save_config(self.config_path, self.config)

        # 启动测试 HTTP 服务器 (绑定 127.0.0.1 动态端口，模拟外部 host 设定)
        self.app = WebApp(self.config_path, host="0.0.0.0", port=0)
        Handler.app = self.app
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join(timeout=2)
        from loguru import logger
        logger.remove()
        self.temp_dir.cleanup()

    def _request(self, method: str, path: str, body: dict | None = None, headers: dict | None = None):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=5)
        req_headers = {"Content-Type": "application/json"}
        if headers:
            req_headers.update(headers)
        data = json.dumps(body).encode("utf-8") if body is not None else None
        conn.request(method, path, body=data, headers=req_headers)
        res = conn.getresponse()
        resp_data = res.read().decode("utf-8")
        conn.close()
        return res.status, resp_data

    def test_auth_status_returns_no_auth_needed(self) -> None:
        self.assertFalse(self.app.need_auth)
        self.assertFalse(self.app.password_is_set)
        status = self.app.auth_status()
        self.assertEqual(status, {"need_auth": False, "password_set": False})

        code, body = self._request("GET", "/api/auth/status")
        self.assertEqual(code, HTTPStatus.OK)
        payload = json.loads(body)
        self.assertFalse(payload["need_auth"])
        self.assertFalse(payload["password_set"])

    def test_direct_access_get_endpoints_without_login(self) -> None:
        # 无需任何 Cookie，直接访问 /api/status 与 /api/config
        code, body = self._request("GET", "/api/status")
        self.assertEqual(code, HTTPStatus.OK)
        payload = json.loads(body)
        self.assertIn("logs", payload)
        self.assertIn("scheduler", payload)

        code, body = self._request("GET", "/api/config")
        self.assertEqual(code, HTTPStatus.OK)
        cfg = json.loads(body)
        self.assertEqual(cfg["web"]["host"], "0.0.0.0")

    def test_direct_access_post_endpoints_without_login(self) -> None:
        # 无需任何 Cookie，直接提交配置更改
        new_config = dict(self.config)
        new_config["features"]["game_checkin"] = True
        code, body = self._request("POST", "/api/config", body=new_config)
        self.assertEqual(code, HTTPStatus.OK)
        payload = json.loads(body)
        self.assertTrue(payload.get("ok"))

        # 验证更改已生效
        code, body = self._request("GET", "/api/config")
        self.assertEqual(code, HTTPStatus.OK)
        cfg = json.loads(body)
        self.assertTrue(cfg["features"]["game_checkin"])

    def test_legacy_auth_endpoints_compat(self) -> None:
        code, body = self._request("POST", "/api/auth/setup", body={"password": "anypassword"})
        self.assertEqual(code, HTTPStatus.OK)
        self.assertTrue(json.loads(body).get("ok"))

        code, body = self._request("POST", "/api/auth/login", body={"password": "anypassword"})
        self.assertEqual(code, HTTPStatus.OK)
        self.assertTrue(json.loads(body).get("ok"))


if __name__ == "__main__":
    unittest.main()
