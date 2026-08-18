"""Dev static server for Sura.

Threaded: the stdlib TCPServer serves one request at a time, which queued every
asset behind the 2.5MB dictionary and stalled page loads for ~13s. Also gzips
text assets so transfer sizes here match what production serves.
"""
import gzip
import io
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = 8000
COMPRESS_EXT = {'.json', '.js', '.css', '.html', '.svg', '.map', '.md', '.txt'}
MIN_COMPRESS_BYTES = 1024
NOT_FOUND_PAGE = '404.html'


class DevHandler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'  # keep-alive; requires accurate Content-Length
    # Python's mimetypes has no .webp mapping, so it would fall back to
    # application/octet-stream and misrepresent what production serves.
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.webp': 'image/webp', '.avif': 'image/avif'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def _gzip_candidate(self, path):
        if 'gzip' not in self.headers.get('Accept-Encoding', ''):
            return False
        if os.path.splitext(path)[1].lower() not in COMPRESS_EXT:
            return False
        # Range requests (video scrubbing) must fall through to the base handler.
        if self.headers.get('Range'):
            return False
        return os.path.isfile(path) and os.path.getsize(path) >= MIN_COMPRESS_BYTES

    def _send_404_page(self):
        """Serve the real 404 page, the way Cloudflare Pages does in production.

        Pages answers any unmatched path with the root `404.html`, so dev has to
        do the same or the page is only ever exercised after a deploy. Status
        stays 404 — a 200 here would teach crawlers (and me) the wrong thing.
        The page's own references are all root-absolute, so it renders correctly
        no matter how deep the missing path was.
        """
        page = os.path.join(os.getcwd(), NOT_FOUND_PAGE)
        if not os.path.isfile(page):
            return super().send_head()  # no page authored yet — stdlib's plain 404
        try:
            with open(page, 'rb') as f:
                body = f.read()
        except OSError:
            return super().send_head()
        self.send_response(404)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        return io.BytesIO(body)

    def send_head(self):
        path = self.translate_path(self.path.split('?', 1)[0])
        # A missing path is the ONLY case handed to the 404 page. A directory
        # still falls through to the stdlib listing, and an unreadable file
        # still reports its own error — neither is a "page that isn't here".
        if not os.path.exists(path):
            return self._send_404_page()
        if not self._gzip_candidate(path):
            return super().send_head()
        try:
            with open(path, 'rb') as f:
                body = gzip.compress(f.read(), 6)
        except OSError:
            return super().send_head()
        self.send_response(200)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Encoding', 'gzip')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Vary', 'Accept-Encoding')
        self.end_headers()
        return io.BytesIO(body)


ThreadingHTTPServer.allow_reuse_address = True
ThreadingHTTPServer.daemon_threads = True
with ThreadingHTTPServer(("", PORT), DevHandler) as httpd:
    print(f"no-cache threaded server on http://localhost:{PORT}/")
    httpd.serve_forever()
