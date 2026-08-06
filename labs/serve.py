"""Servidor estático de labs/ en :8912 con Cache-Control: no-store — los
reports y demos de todos los benches se sirven frescos (el http.server de
serie deja a Chrome revalidar a su aire y una recarga puede ejecutar código
viejo). Sustituye al serve.py de render y al http.server suelto de
escenografia, que competían por el mismo puerto."""

import http.server
import os
import sys

os.chdir(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8912
    print(f"→ labs @ http://127.0.0.1:{port}/")
    http.server.ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()
