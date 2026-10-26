"""
nova.server - Nova Studio: the whole glass-box compiler behind a local web page.

    python -m nova serve                  http://127.0.0.1:8765 and open a browser
    python -m nova serve --port 9000      another port
    python -m nova serve --no-browser     just serve

Standard library only (http.server), like the rest of the project.  The page in
nova/web/ talks to a small JSON API:

    GET  /api/health      liveness and version
    GET  /api/examples    the example programs, with their first comment line
    GET  /api/grammar     the grammar, FIRST/FOLLOW, LL(1), ambiguity demo
    POST /api/compile     {source, optimise, mode: "live"|"run"} -> every phase
    POST /api/report      {source, optimise} -> the HTML report, as a download
    GET  /api/attacks     hostile bytecode against the verifier and sandbox

It binds to 127.0.0.1 by default.  Because a browser on the same machine can be
pointed at it by any web page, POSTs must be application/json (which forces a
CORS preflight that is never granted) and the Host header must name this
machine, which defeats DNS-rebinding.
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import sys
import threading
import time
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional, Tuple
from urllib.parse import urlparse

from .attacks import run_demo
from .pipeline import compile_source
from .report_html import build_report
from .report_json import build_json, grammar_view

VERSION = "1.1"
HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "web")
EXAMPLES = os.path.join(os.path.dirname(HERE), "examples")

MAX_BODY = 512 * 1024            # half a megabyte of source is plenty
LIVE_BUDGET = 250_000            # instructions per execution while typing
RUN_BUDGET = 2_000_000           # the pipeline's normal sandbox budget

STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/studio.css": ("studio.css", "text/css; charset=utf-8"),
    "/studio.js": ("studio.js", "text/javascript; charset=utf-8"),
    "/favicon.svg": ("favicon.svg", "image/svg+xml"),
}

CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data:; connect-src 'self'; object-src 'none'; "
       "base-uri 'none'; frame-ancestors 'none'")

# The compiler keeps no per-request state, but one compilation at a time keeps
# CPU-heavy runs from starving each other on a single interpreter.
_COMPILE_LOCK = threading.Lock()


def asset_version() -> str:
    """A content hash for studio.css/js, so a browser never runs stale assets."""
    h = hashlib.sha1()
    for name in ("studio.css", "studio.js"):
        with open(os.path.join(WEB, name), "rb") as fh:
            h.update(fh.read())
    return h.hexdigest()[:10]


def index_page() -> bytes:
    with open(os.path.join(WEB, "index.html"), "rb") as fh:
        page = fh.read()
    v = asset_version().encode()
    for asset in (b"/studio.css", b"/studio.js"):
        page = page.replace(b'"' + asset + b'"', b'"' + asset + b"?v=" + v + b'"')
    return page


def examples() -> list:
    out = []
    if not os.path.isdir(EXAMPLES):
        return out
    for name in sorted(os.listdir(EXAMPLES)):
        if not name.endswith(".nova"):
            continue
        with open(os.path.join(EXAMPLES, name), encoding="utf-8") as fh:
            src = fh.read()
        first = next((l.lstrip("# ").strip() for l in src.splitlines()
                      if l.startswith("#") and l.strip("# ")), "")
        title = name[:-5].split("_", 1)[-1].replace("_", " ")
        out.append({"file": name, "title": title, "summary": first, "source": src})
    return out


def _compile(body: dict) -> Tuple[int, dict]:
    source = body.get("source")
    if not isinstance(source, str):
        return 400, {"error": "'source' must be a string"}
    optimise = bool(body.get("optimise", True))
    budget = RUN_BUDGET if body.get("mode") == "run" else LIVE_BUDGET
    name = str(body.get("name") or "editor buffer")[:120]
    with _COMPILE_LOCK:
        t0 = time.perf_counter()
        res = compile_source(source, name, optimise=optimise, max_steps=budget)
        elapsed = time.perf_counter() - t0
    data = build_json(res, optimise=optimise, max_steps=budget)
    data["elapsed_ms"] = round(elapsed * 1000, 2)
    return 200, data


class Handler(BaseHTTPRequestHandler):
    server_version = f"NovaStudio/{VERSION}"
    protocol_version = "HTTP/1.1"
    quiet = False

    # ------------------------------------------------------------- plumbing
    def log_message(self, fmt, *args) -> None:          # noqa: D401
        if not self.quiet:
            sys.stderr.write(f"  {self.log_date_time_string()}  {fmt % args}\n")

    def _send(self, status: int, body: bytes, ctype: str,
              extra: Optional[dict] = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status: int, data) -> None:
        self._send(status, json.dumps(data, separators=(",", ":")).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _host_ok(self) -> bool:
        """Refuse requests whose Host is not this machine (DNS rebinding)."""
        bound = self.server.server_address[0]
        if bound not in ("127.0.0.1", "localhost", "::1"):
            return True
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]").lower()
        return host in ("127.0.0.1", "localhost", "::1")

    def _body(self) -> Optional[dict]:
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            self.close_connection = True                # the body was not read
            self._json(415, {"error": "send application/json"})
            return None
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            self.close_connection = True
            self._json(413, {"error": f"request larger than {MAX_BODY // 1024} KB"})
            return None
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            self._json(400, {"error": "body is not valid JSON"})
            return None
        if not isinstance(data, dict):
            self._json(400, {"error": "body must be a JSON object"})
            return None
        return data

    def _guard(self, fn) -> None:
        if not self._host_ok():
            self.close_connection = True
            self._json(403, {"error": "unexpected Host header"})
            return
        try:
            fn()
        except Exception as exc:                        # never kill the server
            traceback.print_exc()
            self._json(500, {"error": f"internal error: {type(exc).__name__}: {exc}"})

    # --------------------------------------------------------------- routes
    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        self._guard(self._get)

    def do_POST(self) -> None:
        self._guard(self._post)

    def _get(self) -> None:
        path = urlparse(self.path).path
        if path == "/":
            self._send(200, index_page(), STATIC["/"][1])
        elif path in STATIC:
            fname, ctype = STATIC[path]
            with open(os.path.join(WEB, fname), "rb") as fh:
                self._send(200, fh.read(), ctype)
        elif path == "/api/health":
            self._json(200, {"ok": True, "version": VERSION,
                             "python": platform.python_version(),
                             "budgets": {"live": LIVE_BUDGET, "run": RUN_BUDGET}})
        elif path == "/api/examples":
            self._json(200, examples())
        elif path == "/api/grammar":
            self._json(200, grammar_view())
        elif path == "/api/attacks":
            self._json(200, run_demo())
        else:
            self._json(404, {"error": f"no such page: {path}"})

    def _post(self) -> None:
        path = urlparse(self.path).path
        if path not in ("/api/compile", "/api/report"):
            self._json(404, {"error": f"no such endpoint: {path}"})
            return
        body = self._body()
        if body is None:
            return
        if path == "/api/compile":
            self._json(*_compile(body))
            return
        source = body.get("source")
        if not isinstance(source, str):
            self._json(400, {"error": "'source' must be a string"})
            return
        name = str(body.get("name") or "editor buffer")[:120]
        with _COMPILE_LOCK:
            res = compile_source(source, name,
                                 optimise=bool(body.get("optimise", True)))
        stem = "".join(c if c.isalnum() or c in "-_" else "-"
                       for c in os.path.splitext(name)[0]) or "nova"
        self._send(200, build_report(res).encode("utf-8"), "text/html; charset=utf-8",
                   {"Content-Disposition":
                    f'attachment; filename="{stem}-report.html"'})


def warm_up() -> None:
    """Build the LR tables (about a second) before the first visitor waits."""
    compile_source("print 1;", "warm-up")
    grammar_view()


def serve(host: str = "127.0.0.1", port: int = 8765, open_browser: bool = True,
          quiet: bool = False) -> int:
    Handler.quiet = quiet
    httpd = None
    for p in range(port, port + 20):
        try:
            httpd = ThreadingHTTPServer((host, p), Handler)
            break
        except OSError:
            continue
    if httpd is None:
        print(f"no free port between {port} and {port + 19}")
        return 1
    httpd.daemon_threads = True
    shown = "127.0.0.1" if host in ("0.0.0.0", "") else host
    url = f"http://{shown}:{httpd.server_address[1]}/"
    print(f"Nova Studio {VERSION}  -  building parse tables...", flush=True)
    warm_up()
    print(f"Nova Studio is running at {url}\nPress Ctrl+C to stop.", flush=True)
    if open_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        httpd.server_close()
    return 0


def main(args) -> int:
    host, port, browser = "127.0.0.1", 8765, True
    it = iter(args)
    for a in it:
        if a == "--port":
            value = next(it, "")
            if not value.isdigit():
                print(f"--port needs a number, not {value!r}")
                return 2
            port = int(value)
        elif a == "--host":
            host = next(it, host)
        elif a == "--no-browser":
            browser = False
        else:
            print(f"unknown option {a!r}\nusage: python -m nova serve "
                  f"[--port N] [--host ADDR] [--no-browser]")
            return 2
    return serve(host, port, browser)
