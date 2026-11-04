# The hosted MCP server

DataBrief can open as an interactive widget inside a chat of **Claude** (web, desktop, mobile) and **ChatGPT**. A small server makes that
possible: it tells the chat app which tool to offer and hands it the DataBrief page to display. This page is for people who run their own
copy of that server (`mcp/server.js`).

**The server never receives your files.** The page runs inside the chat, in your browser, and reads the file there; what leaves the page is
only what you choose to put in the chat. The server serves the page and answers the chat app's requests, and that is all it does.

- [What it does](#what-it-does)
- [The widget page](#the-widget-page)
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
| Tool | one: `databrief_open` (title "DataBrief", read-only, takes no argument). Its descriptions are facts only (what the tool shows, what happens to the file, what the widget offers), because the directory's review rejects tool texts that tell the AI how to behave |
| Resource | one: the widget page, served as `text/html;profile=mcp-app` with the clipboard permission and a border |
| Other addresses | `/healthz` (for health checks), `/` (a short page that says what this is), `/icon.svg` and `/favicon.ico` |
| Dependencies | none: Node.js 18 or newer, built-in modules only, no `npm install` |

## The widget page

`node tools/build-widget.cjs` writes `dist/databrief-widget.html`: the plain `databrief.html`, **unchanged**, plus a small layer (in
`widget/`) that talks to the chat app. Opened on its own, that file is the normal page: the layer does nothing unless the page sits in a
frame whose host answers the MCP Apps handshake. The layer makes no network request; it only exchanges messages with the host.

The page is the same everywhere, and it adapts to what each app says it supports, not to guesses:

| | Claude | ChatGPT | An app we have not tested |
|---|---|---|---|
| **Put in the chat** | the whole prompt goes into your message box; you press send | the prompt goes into the chat context and a short line is **sent at once** | the same as ChatGPT, with wording that says "sent, or placed in your message box, depending on the app" |
| **Add to context** | in the browser and in the Desktop app's Code tab: the data goes into the context and a short line into your message box. Not offered in the Desktop home chat (see below) | not offered | not offered |
| **Ask about this data** | the data goes into the context and a short line with your question into your message box (in the Desktop home chat: your question and the whole prompt go into your message box, as one message) | the data goes into the context and the question is sent at once | the same as ChatGPT, with neutral wording |
| **Downloads** (.md, CSV, zip) | through the app, which asks you to confirm | hidden: the app cannot download | shown only if the app says it can |
| **Links** | opened by the app, which asks you to confirm | opened by the app | only if the app says it can |

An app that does not support messages or context gets none of those buttons: **Copy** is always there. Before anything is sent, the button
turns into **Confirm** (amber when the prompt holds your data, green when "Do not share data" is on) and a box says how big it is, whether it
holds the data, and what will happen. A prompt that is larger than an app is known to accept only gets a warning: you can still try.
On every button, in every app, Confirm appears at once but stays grey with a spinner for 2 seconds before it can be clicked: Claude Desktop refuses a message sent too soon after the first click (tested: it fails when confirmed at once and works after about 2 seconds, whichever button). It also keeps a double-click from sending before you could read the box. A button that is armed is cancelled when the page changes under it
(another file, another option, another question), so what is sent is always what the box described. When you switch to "Do not share
data", change file, or a send fails, a context that held your data is taken back. The widget follows the app's light or dark theme.

**Add to context depends on Claude's AI opening the context.** Claude keeps the context out of the conversation until the AI decides to open it. In the browser and in the Desktop app's Code tab it does. The Desktop app's home chat is a Claude Code session of the app and its AI has no way to open it (its own log and the AI say so), so the widget does not offer Add to context there: it recognises that chat by what it announces (the Desktop app, with downloads). **Put in the chat** sends everything in the message itself, and in that chat so does **Ask about this data**, so both work in all three. Where a host does not offer downloads (the Desktop Code tab, ChatGPT), the download buttons are hidden.

**Tested:** Claude (browser and Desktop app) and ChatGPT (browser). Other apps that speak MCP Apps get only what they confirm, but nobody has tried them yet. The
labels and boxes are in the page's 15 languages; the short line that goes into the chat follows the **prompt** language.

`tests/test_widget.cjs` checks the texts and the build, and `tests/test_widget_browser.cjs` opens the page in Chrome inside fake hosts (Claude, ChatGPT,
an unknown app, a silent one) with a real file, and checks that what the host receives is exactly the prompt the page shows, and nothing of
the data when "Do not share data" is on.

## Run it

It needs the widget page, which `node tools/build-widget.cjs` writes to `dist/databrief-widget.html` (the plain `databrief.html`, unchanged,
plus the layer that talks to the chat app: see [The widget page](#the-widget-page)). By default the server looks for `widget.html` next to
`server.js`, then for that file; or name any file with `DATABRIEF_WIDGET`. Without the page it stops and says so.

```bash
node tools/build-widget.cjs             # once, and after every change of the page
node mcp/server.js                      # http://localhost:8787/mcp
DATABRIEF_WIDGET=./my-widget.html node mcp/server.js
node mcp/server.js --help               # every setting
```

With Docker, from the repository root. The image builds the widget page itself, from `databrief.html` and `widget/`, so it can never
serve a stale copy:

```bash
docker build -f mcp/Dockerfile -t databrief-mcp .
docker run -d -p 8787:8787 --read-only --cap-drop ALL --security-opt no-new-privileges databrief-mcp
```

or with Compose, which also starts the Cloudflare Tunnel that gives the server a public address, from a `.env` file that holds every setting.
How to set it up on a server, update it and find out why it is down is in [Running the hosted MCP server](mcp-operations.md):

```bash
cd mcp && cp .env.example .env     # edit .env
docker compose up -d --build
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
| `DATABRIEF_WIDGET` | next to the server, or `dist/databrief-widget.html` | the widget page to serve |
| `DATABRIEF_PUBLIC_URL` | empty | public address, e.g. `https://databrief.example.com`; gives the server's icon an absolute address |
| `DATABRIEF_RATE_PER_MIN` | `600` | flood guard: requests per minute per source, `0` = off (see below) |
| `DATABRIEF_TRUST_PROXY_HEADER` | empty | the header that carries the real client address behind a proxy, e.g. `CF-Connecting-IP`; set it **only** behind that proxy |
| `DATABRIEF_ALLOWED_ORIGINS` | empty | extra browser origins allowed to call `/mcp`, comma-separated; `https://claude.ai`, `https://claude.com` and `https://chatgpt.com` are always allowed |
| `DATABRIEF_LOG` | `on` | request log: `on` or `off` |

**The flood guard is generous on purpose.** Claude and ChatGPT call from shared cloud addresses, so one address stands for many users. The
default of 600 requests a minute only stops a flood. Reading the widget page counts as five requests, because it is the heavy one, and a request may ask for the page only
once (a batch with several page reads gets the page once and an error for the others). An IPv6 address counts with its whole /64 network (one computer usually holds a whole
/64), so a source cannot fill the guard's memory with addresses of its own network.

Requests that carry an `Origin` header (a web page calling the server) are refused unless the origin is in the list; an allowed origin
gets the CORS answers a browser needs, the preflight included. The chat apps call server to server and send none.

## What it logs and what it keeps

It keeps **nothing**: no file, no conversation, no session, no database, and its code has no call that writes to disk (a test checks that).

The log has one line per request: the time, the route, the HTTP status, the duration, the **method names** it knows (`tools/call`, `resources/read`; any other is logged as `other`, never with the client's text), the
tool name, the name the chat app gives itself, and the first word of its user agent. It has no tool argument, no header, no cookie, no token
and **no IP address**; `tests/test_mcp.cjs` plants canaries in all of those and checks they never appear. At start, one line states the
version, the address it listens on, the size and the SHA-256 of the widget page it serves, so you can compare it with the one you built.

A proxy or tunnel in front of the server has its own logs and sees the traffic; read its settings too.

## Behind a proxy or a tunnel

Any reverse proxy (Caddy, nginx, Traefik) or tunnel that gives the server an HTTPS address works: forward `/mcp` and `/healthz` to the port.
No login, no challenge page and no bot protection may sit in front of `/mcp`: the chat apps' servers cannot answer them.

Behind Cloudflare, set `DATABRIEF_TRUST_PROXY_HEADER=CF-Connecting-IP` so the flood guard counts real addresses. Without it, every request
seems to come from the proxy itself. The header is believed **only when the connection itself comes from this machine or a private network** (the tunnel in the same Docker network, a reverse proxy on the same
host); from a public address the server ignores it and counts the connection's own address. Even so, do not set it when the server is reachable directly.

## Updating the widget page

Claude and ChatGPT remember a widget by its address and keep an old tool list until it is refreshed. So `mcp/uris.json` holds:

- `current`: the address of the widget in use;
- `previous`: every address ever used, which keep answering with the **current** page.

When the widget changes, run `node tools/build-widget.cjs --new-address`: it gives the page a new `current` address, moves the old one to
`previous` and records the SHA-256 of the page (`widgetSha256`). Never remove an address: an app that still asks for it would show "cannot
reach" instead of the page. `tests/test_mcp.cjs` checks that every listed address answers, and `tests/test_widget.cjs` fails when the page
changed but its address did not.

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

For Claude Desktop there is also an extension that needs no server at all: see [DataBrief for Claude Desktop](extension.md).
