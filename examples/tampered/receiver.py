#!/usr/bin/env python3
"""
DEMO ONLY - the "attacker's server" for the privacy check in docs/verify-privacy.md.

  python receiver.py          (Windows: py receiver.py)
  then open  http://127.0.0.1:8765/          the tampered page that leaks file names
        or   http://127.0.0.1:8765/blocked   the same tampered code, stopped by DataBrief's security policy

It serves the two tampered pages of this folder and prints every file name they send.
It listens on 127.0.0.1 only: nothing can reach it from another computer, and nothing leaves yours.
Python 3.8+, standard library only. Stop it with Ctrl+C.
GPL-3.0-or-later - https://github.com/Arfo-du-blo/DataBrief
"""
import http.server
import os
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
HOST, PORT = "127.0.0.1", 8765
PAGES = {
    "/": "corrupted_databrief.html",
    "/corrupted_databrief.html": "corrupted_databrief.html",
    "/blocked": "corrupted_databrief_blocked.html",
    "/corrupted_databrief_blocked.html": "corrupted_databrief_blocked.html",
}


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "DemoReceiver"
    sys_version = ""

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/collect":
            # This is what the injected code sends: ?name=<the file name>
            name = urllib.parse.parse_qs(url.query).get("name", ["?"])[0]
            print("\n  >>> RECEIVED from the browser: file name = %r\n" % name, flush=True)
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
        elif url.path in PAGES:
            with open(os.path.join(HERE, PAGES[url.path]), "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404)

    def log_message(self, fmt, *args):
        sys.stdout.write("  %s %s\n" % (self.command, self.path.split("?")[0]))
        sys.stdout.flush()


def main():
    for page in set(PAGES.values()):
        if not os.path.exists(os.path.join(HERE, page)):
            sys.exit("Missing %s: run build.ps1 from the repository root first." % page)
    server = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
    print("DEMO receiver (the 'attacker'), listening on http://%s:%d only" % (HOST, PORT))
    print("  Tampered page that leaks file names:  http://%s:%d/" % (HOST, PORT))
    print("  Same code, blocked by the policy:     http://%s:%d/blocked" % (HOST, PORT))
    print("Open one of them, press F12 > Network, load any data file, and watch this window. Ctrl+C to stop.",
          flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
