#!/usr/bin/env python3
"""Tiny static-file server for the microduck PWA.

Stdlib only — runs on stock Raspberry Pi OS with no apt-install. Two
improvements over `python3 -m http.server`:

  - ThreadingHTTPServer: serves concurrent requests instead of one at
    a time. The PWA's first load fans out ~30 mesh fetches; a serial
    server stalls them and the install fails.

  - Transparent gzip: serves `.stl` (and other compressible types)
    pre-compressed when a `.gz` neighbour exists. Cuts the first
    install download by ~3×.

The PWA's service worker fetches each mesh exactly once and caches it,
so this only matters on first install + updates.
"""

from __future__ import annotations

import argparse
import gzip
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

_GZIPPABLE = {
    ".html", ".js", ".css", ".json", ".svg", ".webmanifest",
    ".stl", ".wasm",
}


class Handler(SimpleHTTPRequestHandler):
    # SimpleHTTPRequestHandler logs every request — drown out under
    # service-worker fan-outs. Keep error logs.
    def log_message(self, format: str, *args):
        pass

    def end_headers(self):
        # Long cache for hashed asset paths (`/assets/<hash>.{js,css}`).
        # The HTML shell + service worker registration stay short-lived
        # so updates roll out promptly.
        path = self.path.split("?", 1)[0]
        if path.startswith("/assets/") and "." in path:
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_head(self):
        # If a precomputed `.gz` exists next to the requested file and
        # the client accepts gzip, serve that. Falls back to the normal
        # path otherwise.
        path = self.translate_path(self.path)
        if not os.path.isdir(path) and os.path.isfile(path + ".gz"):
            accepts = self.headers.get("Accept-Encoding", "")
            if "gzip" in accepts:
                ext = Path(path).suffix.lower()
                ctype = self.guess_type(path)
                try:
                    f = open(path + ".gz", "rb")
                except OSError:
                    return super().send_head()
                fs = os.fstat(f.fileno())
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Encoding", "gzip")
                self.send_header("Content-Length", str(fs[6]))
                self.send_header("Vary", "Accept-Encoding")
                self.end_headers()
                _ = ext  # quiet linters
                return f
        return super().send_head()


def precompress(root: Path) -> None:
    """Generate `.gz` copies of compressible files. Idempotent."""
    count = 0
    for f in root.rglob("*"):
        if not f.is_file():
            continue
        if f.suffix.lower() not in _GZIPPABLE:
            continue
        gz = f.with_suffix(f.suffix + ".gz")
        if gz.exists() and gz.stat().st_mtime >= f.stat().st_mtime:
            continue
        with open(f, "rb") as inp, gzip.open(gz, "wb", compresslevel=9) as out:
            out.write(inp.read())
        count += 1
    if count:
        print(f"[serve] precompressed {count} file(s)", file=sys.stderr)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--directory", default="/var/www/microduck")
    p.add_argument("--port", type=int, default=8080)
    p.add_argument("--bind", default="0.0.0.0")
    p.add_argument("--no-precompress", action="store_true",
                   help="skip the precompression pass at startup")
    args = p.parse_args()

    root = Path(args.directory).resolve()
    if not root.is_dir():
        sys.exit(f"directory not found: {root}")
    os.chdir(root)

    if not args.no_precompress:
        precompress(root)

    class HandlerWithDir(Handler):
        # The handler resolves paths relative to cwd, which we've
        # already chdir'd to `root`. No extra config needed.
        pass

    server = ThreadingHTTPServer((args.bind, args.port), HandlerWithDir)
    server.daemon_threads = True
    print(f"[serve] http://{args.bind}:{args.port}/  (dir={root})", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
