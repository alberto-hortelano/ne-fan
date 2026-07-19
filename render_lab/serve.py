"""Servidor de render_lab en :8912 con Cache-Control: no-store — las demos y
reports siempre se sirven frescos (el http.server de serie deja a Chrome
revalidar a su aire y una recarga puede ejecutar código viejo)."""

import http.server
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("", 8912), NoCacheHandler).serve_forever()
