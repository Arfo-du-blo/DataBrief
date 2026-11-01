#!/usr/bin/env python3
"""
DataBrief - small web server for teams (Python 3.8+, standard library only).

It serves databrief.html with your team settings written into it. The data files users open
never reach this server: DataBrief works entirely in the browser.

  python serve.py                      start with databrief.conf / environment variables / defaults
  python serve.py --setup              answer a few questions (and optionally save them), then start
  python serve.py --port 9000 --lang fr --lock lang,mode
  python serve.py --help               every option

Settings priority: command-line option > environment variable > databrief.conf > built-in default.
GPL-3.0-or-later - https://github.com/Arfo-du-blo/DataBrief
"""
import argparse
import gzip
import http.server
import json
import os
import re
import shlex
import socket
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
LANGS = ["en", "fr", "es", "de", "it", "pt", "nl", "pl", "ru", "tr", "zh", "ja", "ko", "hi", "ar"]
LOCKABLE = ["lang", "promptLang", "mode", "layout", "theme", "limit", "edit", "view", "share"]

# name, environment variable, default, page config key (None = server setting), question for --setup
SETTINGS = [
    ("lang", "DATABRIEF_LANG", "", "lang", "Interface language (" + " ".join(LANGS) + "; empty = visitor's choice)"),
    ("prompt_lang", "DATABRIEF_PROMPT_LANG", "", "promptLang", "Prompt language (same codes; empty = same as the interface)"),
    ("mode", "DATABRIEF_MODE", "inline", "mode", "Give the data to the AI: inline (inside the prompt) or files (separate CSV files)"),
    ("layout", "DATABRIEF_LAYOUT", "auto", "layout", "Data layout: auto, table or csv"),
    ("theme", "DATABRIEF_THEME", "system", "theme", "Theme: system, light or dark"),
    ("share", "DATABRIEF_SHARE", "yes", "share", "Share the data with the AI: yes, or no (Do not share data: the prompt describes the file without its records)"),
    ("sample_rows", "DATABRIEF_SAMPLE_ROWS", "5", "sampleRows", "Sample rows per section in CSV-files mode (1-100)"),
    ("warn_tokens", "DATABRIEF_WARN_TOKENS", "150000", "warnTokens", "Large-file warning above how many tokens"),
    ("lock", "DATABRIEF_LOCK", "", "lock", "Settings to lock, comma-separated (" + ",".join(LOCKABLE) + "; empty = none)"),
    ("prompt_intro", "DATABRIEF_PROMPT_INTRO", "", "promptIntro", None),
    ("prompt_respond", "DATABRIEF_PROMPT_RESPOND", "", "promptRespond", None),
    ("prompt_respond_files", "DATABRIEF_PROMPT_RESPOND_FILES", "", "promptRespondFiles", None),
    ("host", "DATABRIEF_HOST", "0.0.0.0", None, "Address to listen on (0.0.0.0 = whole network, 127.0.0.1 = this computer only)"),
    ("port", "DATABRIEF_PORT", "8080", None, "Port"),
    ("threads", "DATABRIEF_THREADS", "8", None, "Requests served at the same time (threads)"),
    ("base_path", "DATABRIEF_BASE_PATH", "/", None, "URL path, e.g. / or /databrief/"),
    ("access_log", "DATABRIEF_ACCESS_LOG", "true", None, "Log every request (true/false)"),
    ("frame_ancestors", "DATABRIEF_FRAME_ANCESTORS", "'self'", None, "Sites allowed to embed DataBrief in a frame ('self' = none other)"),
    ("html", "DATABRIEF_HTML", "", None, None),
]
BY_NAME = {s[0]: s for s in SETTINGS}


# ------------------------------------------------------------------ config file ----------
def conf_unquote(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
        out, i, s = [], 0, v[1:-1]
        while i < len(s):
            if s[i] == "\\" and i + 1 < len(s):
                out.append({"n": "\n", "t": "\t", '"': '"', "\\": "\\"}.get(s[i + 1], "\\" + s[i + 1]))
                i += 2
            else:
                out.append(s[i])
                i += 1
        return "".join(out)
    return v


def conf_quote(v):
    v = str(v)
    if v == "" or re.search(r'[\s"#\\]', v):
        return '"' + v.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\t", "\\t") + '"'
    return v


def read_conf(path):
    values = {}
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            values[key.strip()] = conf_unquote(val)
    return values


def write_conf(path, values):
    """Update KEY=value lines in place (keeping comments), append missing keys."""
    lines = []
    if os.path.exists(path):
        with open(path, encoding="utf-8-sig") as f:
            lines = f.read().splitlines()
    done = set()
    for i, line in enumerate(lines):
        m = re.match(r"\s*([A-Z0-9_]+)\s*=", line)
        if m and m.group(1) in values:
            lines[i] = m.group(1) + "=" + conf_quote(values[m.group(1)])
            done.add(m.group(1))
    for key, val in values.items():
        if key not in done:
            lines.append(key + "=" + conf_quote(val))
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")


def find_conf(explicit):
    if explicit:
        return explicit
    for p in [os.environ.get("DATABRIEF_CONFIG"), os.path.join(os.getcwd(), "databrief.conf"),
              os.path.join(HERE, "..", "databrief.conf"), "/config/databrief.conf"]:
        if p and os.path.isfile(p):
            return os.path.abspath(p)
    return None


def find_html(explicit):
    for p in [explicit, os.path.join(os.getcwd(), "databrief.html"), os.path.join(HERE, "databrief.html"),
              os.path.join(HERE, "..", "..", "databrief.html"), "/app/databrief.html"]:
        if p and os.path.isfile(p):
            return os.path.abspath(p)
    return None


# ---------------------------------------------------------------- settings ----------------
def resolve(args):
    conf_path = find_conf(args.config)
    # --config may name a file that does not exist yet: --setup creates it.
    conf = read_conf(conf_path) if conf_path and os.path.isfile(conf_path) else {}
    eff = {}
    for name, env, default, _key, _q in SETTINGS:
        cli = getattr(args, name, None)
        if cli is not None:
            eff[name] = str(cli)
        elif os.environ.get(env, "") != "":   # an empty variable counts as "not set"
            eff[name] = os.environ[env]
        elif conf.get(env, "") != "":
            eff[name] = conf[env]
        else:
            eff[name] = default
    return eff, conf_path


def validate(eff):
    errors = []
    for k in ("lang", "prompt_lang"):
        if eff[k] and eff[k] not in LANGS:
            errors.append(f"{BY_NAME[k][1]}: '{eff[k]}' is not one of {' '.join(LANGS)}")
    choices = {"mode": ("inline", "files"), "layout": ("auto", "table", "csv"), "theme": ("system", "light", "dark"), "share": ("yes", "no")}
    for k, allowed in choices.items():
        if eff[k] not in allowed:
            errors.append(f"{BY_NAME[k][1]}: '{eff[k]}' must be one of {', '.join(allowed)}")
    for k, lo, hi in (("sample_rows", 1, 100), ("warn_tokens", 1000, 100000000), ("port", 1, 65535), ("threads", 1, 1000)):
        try:
            n = int(eff[k])
            if not lo <= n <= hi:
                raise ValueError
        except ValueError:
            errors.append(f"{BY_NAME[k][1]}: '{eff[k]}' must be a number from {lo} to {hi}")
    bad = [x for x in split_list(eff["lock"]) if x not in LOCKABLE]
    if bad:
        errors.append(f"DATABRIEF_LOCK: unknown {', '.join(bad)} (allowed: {', '.join(LOCKABLE)})")
    if eff["access_log"].lower() not in ("true", "false", "1", "0", "yes", "no"):
        errors.append("DATABRIEF_ACCESS_LOG: must be true or false")
    if not eff["base_path"].startswith("/"):
        errors.append("DATABRIEF_BASE_PATH: must start with /")
    return errors


def split_list(v):
    return [x.strip() for x in str(v).split(",") if x.strip()]


def page_config(eff):
    """Settings written into the page (only what differs from the built-in defaults)."""
    c = {}
    for name, _env, default, key, _q in SETTINGS:
        if not key:
            continue
        v = eff[name]
        if key == "lock":
            if split_list(v):
                c["lock"] = split_list(v)
        elif key in ("sampleRows", "warnTokens"):
            if v != default:
                c[key] = int(v)
        elif v and v != default:
            c[key] = v
    return c


BLOCK = re.compile(r'(<script id="databrief-config" type="application/json">)[\s\S]*?(</script>)')


def inject(html, config):
    """Write the settings into the page's config block."""
    data = json.dumps(config, ensure_ascii=False, indent=2).replace("<", "\\u003c")
    out, n = BLOCK.subn(lambda m: m.group(1) + "\n" + data + "\n" + m.group(2), html, count=1)
    if n != 1:
        raise SystemExit("This databrief.html has no settings block: rebuild it with build.ps1.")
    return out


# ------------------------------------------------------------------ setup ----------------
def in_docker():
    return os.path.exists("/.dockerenv") or os.environ.get("DATABRIEF_IN_DOCKER") == "1"


def setup(eff, conf_path):
    print("\nDataBrief setup - press Enter to keep the value in [brackets].\n")
    for name, env, _default, _key, question in SETTINGS:
        if not question:
            continue
        while True:
            try:
                ans = input(f"{question}\n  [{eff[name]}] > ").strip()
            except EOFError:
                ans = ""
            old = eff[name]
            eff[name] = ans if ans else old
            errs = [e for e in validate(eff) if e.startswith(env + ":")]
            if not errs:
                break
            print("  ! " + errs[0])
            eff[name] = old
    print("\nTip: your team's own prompt text is easiest to write in databrief_set_default.html,"
          "\n     or set DATABRIEF_PROMPT_INTRO / _RESPOND / _RESPOND_FILES in databrief.conf.\n")
    values = {BY_NAME[n][1]: eff[n] for n in BY_NAME if BY_NAME[n][4]}
    target = conf_path or ("/config/databrief.conf" if in_docker() and os.path.isdir("/config") else
                           os.path.join(os.getcwd(), "databrief.conf"))
    if in_docker():
        print_docker_commands(eff)
        if not os.path.isdir(os.path.dirname(target)):
            print("(To keep these answers, mount a folder: -v \"$PWD/config:/config\")\n")
            return
    try:
        ans = input(f"Save these answers to {target}? [Y/n] > ").strip().lower()
    except EOFError:
        ans = "y"
    if ans in ("", "y", "yes", "o", "oui"):
        try:
            write_conf(target, values)
            print(f"Saved to {target}\n")
        except OSError as e:
            print(f"Could not save to {target} ({e.strerror}). The answers are used for this run only.\n")


def print_docker_commands(eff):
    env = [(BY_NAME[n][1], eff[n]) for n in BY_NAME if BY_NAME[n][4] and eff[n] != BY_NAME[n][2]
           and n not in ("host", "port")]
    port = eff["port"]
    print("Same configuration without questions next time:\n")
    flags = " ".join(f"-e {k}={shlex.quote(v)}" for k, v in env)
    print(f"  docker run -d -p {port}:{port} -e DATABRIEF_PORT={port} {flags} ghcr.io/arfo-du-blo/databrief:python\n")
    print("  docker-compose.yml, under 'environment:'")
    for k, v in [("DATABRIEF_PORT", port)] + env:
        print(f"      {k}: {json.dumps(v)}")
    print()


# ------------------------------------------------------------------ server ---------------
class PoolServer(http.server.HTTPServer):
    """HTTP server with a fixed number of worker threads."""
    daemon_threads = True

    def __init__(self, addr, handler, threads):
        if ":" in addr[0]:
            self.address_family = socket.AF_INET6
        super().__init__(addr, handler)
        self.pool = ThreadPoolExecutor(max_workers=threads)

    def process_request(self, request, client_address):
        self.pool.submit(self._work, request, client_address)

    def _work(self, request, client_address):
        try:
            self.finish_request(request, client_address)
        except Exception:
            self.handle_error(request, client_address)
        finally:
            self.shutdown_request(request)


def make_handler(page, page_gz, base, log, frame_ancestors):
    base = base if base.endswith("/") else base + "/"
    pages = {base, base + "index.html", base + "databrief.html"}

    class Handler(http.server.BaseHTTPRequestHandler):
        server_version = "DataBrief"
        sys_version = ""

        def log_message(self, fmt, *a):
            if log:
                sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % a))

        def _send(self, code, body, ctype, extra=None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "frame-ancestors " + frame_ancestors)
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def do_GET(self):
            path = self.path.split("?", 1)[0].split("#", 1)[0]
            if path == "/healthz":
                return self._send(200, b"ok\n", "text/plain; charset=utf-8", {"Cache-Control": "no-store"})
            if path + "/" == base:
                query = self.path[len(path):]
                return self._send(301, b"", "text/plain", {"Location": base + query})
            if path in pages:
                gz = "gzip" in self.headers.get("Accept-Encoding", "")
                extra = {"Cache-Control": "no-cache", "Vary": "Accept-Encoding"}
                if gz:
                    extra["Content-Encoding"] = "gzip"
                return self._send(200, page_gz if gz else page, "text/html; charset=utf-8", extra)
            return self._send(404, b"Not found\n", "text/plain; charset=utf-8")

        do_HEAD = do_GET

    return Handler


def main(argv=None):
    p = argparse.ArgumentParser(description="DataBrief web server (settings: option > environment > databrief.conf > default)")
    p.add_argument("command", nargs="?", choices=["setup"], help="'setup': same as --setup")
    p.add_argument("--setup", action="store_true", help="ask questions, optionally save them to databrief.conf, then start")
    p.add_argument("--config", help="path of databrief.conf")
    p.add_argument("--check", action="store_true", help="validate the settings and exit")
    for name, env, default, _key, q in SETTINGS:
        p.add_argument("--" + name.replace("_", "-"), dest=name, default=None,
                       help=f"{(q or name).split(' (')[0]} [env {env}, default {default or 'empty'}]")
    args = p.parse_args(argv)

    eff, conf_path = resolve(args)
    if args.setup or args.command == "setup":
        setup(eff, conf_path)
    errors = validate(eff)
    if errors:
        for e in errors:
            print("Error: " + e, file=sys.stderr)
        return 2

    html_path = find_html(eff["html"])
    if not html_path:
        print("Error: databrief.html not found. Use --html PATH or DATABRIEF_HTML.", file=sys.stderr)
        return 2
    with open(html_path, encoding="utf-8") as f:
        page = inject(f.read(), page_config(eff)).encode("utf-8")
    if args.check:
        print("Settings OK. Page config:", json.dumps(page_config(eff), ensure_ascii=False))
        return 0
    page_gz = gzip.compress(page, 9)

    log = eff["access_log"].lower() in ("true", "1", "yes")
    handler = make_handler(page, page_gz, eff["base_path"], log, eff["frame_ancestors"])
    server = PoolServer((eff["host"], int(eff["port"])), handler, int(eff["threads"]))
    shown = "localhost" if eff["host"] in ("0.0.0.0", "::") else eff["host"]
    base = eff["base_path"] if eff["base_path"].endswith("/") else eff["base_path"] + "/"
    print(f"DataBrief is running: http://{shown}:{eff['port']}{base}")
    if eff["host"] in ("0.0.0.0", "::"):
        print(f"Team members can use http://<this computer's name or IP>:{eff['port']}{base}")
    print(f"Settings file: {conf_path or 'none'} - page: {html_path} - press Ctrl+C to stop", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
        server.pool.shutdown(wait=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
