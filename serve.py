"""Development server for Pikchr Studio.

Same as `python3 -m http.server`, but every response carries
`Cache-Control: no-cache` so the browser revalidates modules on each load and
never mixes a stale cached module with fresh ones.
"""
import functools, http.server, os, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public')
    handler = functools.partial(NoCache, directory=root)
    http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
