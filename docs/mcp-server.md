# The hosted MCP server

DataBrief can open as an interactive widget inside a chat of **Claude** (web, desktop, mobile) and **ChatGPT**. A small server makes that
possible: it tells the chat app which tool to offer and hands it the DataBrief page to display. This page is for people who run their own
copy of that server (`mcp/server.js`).

**The server never receives your files.** The page runs inside the chat, in your browser, and reads the file there; what leaves the page is
only what you choose to put in the chat. The server serves the page and answers the chat app's requests, and that is all it does.

- [What it does](#what-it-does)
- [Run it](#run-it)
- [Settings](#settings)
- [What it logs and what it keeps](#what-it-logs-and-what-it-keeps)
- [Behind a proxy or a tunnel](#behind-a-proxy-or-a-tunnel)
- [Updating the widget page](#updating-the-widget-page)
- [Check that it works](#check-that-it-works)
- [What it does not do](#what-it-does-not-do)

## What it does

| | |
|---|---|
| Protocol | MCP over Streamable HTTP at `/mcp`, stateless: JSON answers, no session, no stream. Versions 2025-11-25, 2025-06-18 and 2025-03-26 |
| Tool | one: `databrief_open` (title "DataBrief", read-only, takes no argument). Its text answer points terminal users at the command-line tool |
| Resource | one: the widget page, served as `text/html;profile=mcp-app` with the clipboard permission and a border |
| Other addresses | `/healthz` (for health checks), `/` (a short page that says what this is), `/icon.svg` and `/favicon.ico` |
| Dependencies | none: Node.js 18 or newer, built-in modules only, no `npm install` |

## Run it

It needs the widget page. By default it looks for `widget.html` next to `server.js`, then for `widget/databrief-widget.html` in the
repository; or name any file with `DATABRIEF_WIDGET`. Without the page it stops and says so.

```bash
node mcp/server.js                      # http://localhost:8787/mcp
DATABRIEF_WIDGET=./my-widget.html node mcp/server.js
node mcp/server.js --help               # every setting
```

With Docker, from the repository root:

```bash
docker build -f mcp/Dockerfile -t databrief-mcp .
docker run -d -p 8787:8787 --read-only --cap-drop ALL --security-opt no-new-privileges databrief-mcp
```

or with Compose (the port is open on this computer only unless `DATABRIEF_MCP_BIND=0.0.0.0` is set):

```bash
docker compose -f mcp/docker-compose.yml up -d --build
```

The image runs as a user that is not root, writes nothing, and needs no capability. `tests/test_mcp_docker.sh` builds it with a stand-in
page and checks all of that.

Claude and ChatGPT call the server **from their own cloud**, so its address must be public and use HTTPS: put a reverse proxy or a tunnel
in front of it (below). `localhost` does not work for them.

## Settings

Environment variables; `node mcp/server.js --help` prints the same list.

| Variable | Default | What it does |
|---|---|---|
| `DATABRIEF_MCP_PORT` | `8787` | port to listen on |
| `DATABRIEF_MCP_HOST` | `0.0.0.0` | address to listen on (`127.0.0.1` = this computer only) |
| `DATABRIEF_WIDGET` | next to the server, or `widget/databrief-widget.html` | the widget page to serve |
| `DATABRIEF_PUBLIC_URL` | empty | public address, e.g. `https://databrief.example.com`; gives the server's icon an absolute address |
| `DATABRIEF_RATE_PER_MIN` | `600` | flood guard: requests per minute per source, `0` = off (see below) |
| `DATABRIEF_TRUST_PROXY_HEADER` | empty | the header that carries the real client address behind a proxy, e.g. `CF-Connecting-IP`; set it **only** behind that proxy |
| `DATABRIEF_ALLOWED_ORIGINS` | empty | extra browser origins allowed to call `/mcp`, comma-separated; `https://claude.ai`, `https://claude.com` and `https://chatgpt.com` are always allowed |
| `DATABRIEF_LOG` | `on` | request log: `on` or `off` |

**The flood guard is generous on purpose.** Claude and ChatGPT call from shared cloud addresses, so one address stands for many users. The
default of 600 requests a minute only stops a flood. Reading the widget page counts as five requests, because it is the heavy one.

Requests that carry an `Origin` header (a web page calling the server) are refused unless the origin is in the list: the chat apps call
server to server and send none.

## What it logs and what it keeps

It keeps **nothing**: no file, no conversation, no session, no database, and its code has no call that writes to disk (a test checks that).

The log has one line per request: the time, the route, the HTTP status, the duration, the **method names** (`tools/call`, `resources/read`), the
tool name, the name the chat app gives itself, and the first word of its user agent. It has no tool argument, no header, no cookie, no token
and **no IP address**; `tests/test_mcp.cjs` plants canaries in all of those and checks they never appear. At start, one line states the
version, the address it listens on, the size and the SHA-256 of the widget page it serves, so you can compare it with the one you built.

A proxy or tunnel in front of the server has its own logs and sees the traffic; read its settings too.

## Behind a proxy or a tunnel

Any reverse proxy (Caddy, nginx, Traefik) or tunnel that gives the server an HTTPS address works: forward `/mcp` and `/healthz` to the port.
No login, no challenge page and no bot protection may sit in front of `/mcp`: the chat apps' servers cannot answer them.

Behind Cloudflare, set `DATABRIEF_TRUST_PROXY_HEADER=CF-Connecting-IP` so the flood guard counts real addresses. Without it, every request
seems to come from the proxy itself. Do not set it when the server is reachable directly, because anyone could then put any address in that
header.

## Updating the widget page

Claude and ChatGPT remember a widget by its address and keep an old tool list until it is refreshed. So `mcp/uris.json` holds:

- `current`: the address of the widget in use;
- `previous`: every address ever used, which keep answering with the **current** page.

When the widget changes, give it a new `current` address and move the old one to `previous`. Never remove an address: an app that still
asks for it would show "cannot reach" instead of the page. `tests/test_mcp.cjs` checks that every listed address answers.

ChatGPT users must also refresh the plugin in their settings to get a new version.

## Check that it works

```bash
curl -s http://localhost:8787/healthz
curl -s -X POST http://localhost:8787/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The second answers with the `databrief_open` tool. Then add `https://YOUR-ADDRESS/mcp` as a connector in Claude (Settings, Connectors, with no
sign-in) or as a plugin in ChatGPT, and ask for DataBrief in a chat.

## What it does not do

- It does not read, receive or store your files, and it asks for no sign-in.
- It has no tool that takes a path or a file: a hosted server cannot see your computer. To let an AI read a file on your own machine, use the
  [command-line tool](cli.md).
- It does not show the widget in a terminal: a terminal has no place to display it.
