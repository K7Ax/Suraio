# Local dev server that disables caching, so the browser always loads the
# latest index.html / app.js / style.css. Run:  python tools/serve.py  (port 8000)
import http.server, socketserver, os

PORT = 8000
# Serve the REPO ROOT, one level up — this file lives in tools/, and serving
# tools/ would hand the browser a directory with no index.html in it.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("0.0.0.0", PORT), NoCacheHandler) as httpd:
    print(f"Sura dev server (no-cache) on http://localhost:{PORT}/index.html")
    httpd.serve_forever()
