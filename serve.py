"""Local development server. Tries port 8080, falls back to a random free port.

Usage:
    python serve.py                      # plain file server
    python serve.py --json hooks.json    # also serve hooks.json at /api/hooks.json
"""

import argparse
import http.server
import os
import socket
import socketserver
import sys

# ── ANSI styling ──────────────────────────────────────────────

_IS_TTY = sys.stdout.isatty()

_BOLD = "\033[1m"
_DIM = "\033[2m"
_RESET = "\033[0m"
_CYAN = "\033[36m"
_GREEN = "\033[32m"
_YELLOW = "\033[33m"


def _style(text, *codes):
    if not _IS_TTY or not codes:
        return str(text)
    return "".join(codes) + str(text) + _RESET

DEFAULT_PORT = 8080

_json_path = None


_script_dir = os.path.dirname(os.path.abspath(__file__))
_dist_dir = os.path.join(_script_dir, "dist")
_serve_dir = _dist_dir if os.path.isdir(_dist_dir) else _script_dir


class _Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=_serve_dir, **kwargs)

    def do_GET(self):
        if self.path == "/api/hooks.json" and _json_path:
            try:
                data = open(_json_path, "rb").read()
            except FileNotFoundError:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()


def _find_port():
    try:
        with socketserver.TCPServer(("127.0.0.1", DEFAULT_PORT), None) as s:
            s.server_close()
        return DEFAULT_PORT
    except OSError:
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]


def main():
    global _json_path
    parser = argparse.ArgumentParser(description="Local dev server for Hooks Graph")
    parser.add_argument("--json", metavar="PATH", help="Serve this file at /api/hooks.json for auto-load")
    args = parser.parse_args()

    if args.json:
        _json_path = os.path.abspath(args.json)

    port = _find_port()
    with socketserver.TCPServer(("127.0.0.1", port), _Handler) as httpd:
        line = _style("─" * 45, _DIM)
        header = _style(" Server", _BOLD, _CYAN)
        print(f"\n{line}\n{header}\n{line}")
        if port != DEFAULT_PORT:
            print(f"  {_style('Port', _DIM)} {DEFAULT_PORT} busy — using {_style(port, _BOLD)}")
        url = f"http://localhost:{port}"
        print(f"  {_style('URL', _BOLD)}     {_style(url, _CYAN)}")
        print(f"\n  Visit the URL above in your browser to explore the graph.")
        print(f"  {_style('Press Ctrl+C to stop', _DIM)}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print(f"\n  {_style('Stopped', _YELLOW)}")
            sys.exit(0)


if __name__ == "__main__":
    main()
