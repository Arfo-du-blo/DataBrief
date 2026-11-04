# Running the hosted MCP server

This page is for whoever runs a copy of the DataBrief MCP server: [what the server is](mcp-server.md), and here how to start it on a server with
Docker Compose, give it a public HTTPS address with a Cloudflare Tunnel, keep it running, update it, and find out why it is down.

**The server never receives your files, stores nothing and writes nothing.** There is nothing to back up and nothing to purge.

- [What you need](#what-you-need)
- [Start it](#start-it)
- [The Cloudflare Tunnel](#the-cloudflare-tunnel)
- [Every day](#every-day)
- [Update it](#update-it)
- [Check it](#check-it)
- [When it does not work](#when-it-does-not-work)
- [What the logs hold](#what-the-logs-hold)
- [Shut it down and revoke it](#shut-it-down-and-revoke-it)
- [Security notes](#security-notes)

## What you need

- A server with **Docker** and **Docker Compose v2** (the `docker compose` command). A small one is enough: the server container is limited to 256 MB.
- A copy of this repository (`git clone`), because the image is built from it: `databrief.html`, `widget/` and `mcp/`.
- For the tunnel: a free **Cloudflare** account and a domain on it. No port has to be opened on your server or router.

## Start it

```bash
cd mcp
cp .env.example .env        # then edit .env: see below
docker compose up -d --build
docker compose ps           # both services should be "running", the server "healthy"
```

`.env` holds every setting, with a comment on each line ([`.env.example`](../mcp/.env.example)). The ones to change:

| Setting | What to put |
|---|---|
| `TUNNEL_TOKEN` | the token of your Cloudflare tunnel (next section). **Keep it secret**: `.env` is never committed |
| `DATABRIEF_PUBLIC_URL` | the public address, for example `https://databrief.example.com` |
| `COMPOSE_PROFILES` | leave `tunnel` to start the tunnel too; empty it to use your own reverse proxy |

The rest has safe defaults. The services are described in [`docker-compose.yml`](../mcp/docker-compose.yml): both containers run read-only, without any
Linux capability, with a memory limit, and restart by themselves after a reboot or a crash.

Without the tunnel (`COMPOSE_PROFILES=` empty), put any reverse proxy with HTTPS in front and forward `/mcp` and `/healthz` to `127.0.0.1:8787`.

## The Cloudflare Tunnel

1. In the Cloudflare dashboard: **Zero Trust**, **Networks**, **Tunnels**, **Create a tunnel**, type **Cloudflared**. Name it, and copy the **token** it shows
   (only the token, not the install command) into `TUNNEL_TOKEN` in `.env`.
2. In the tunnel's **Public hostname** tab, add your hostname (for example `databrief.example.com`) with the service **HTTP** and the address `databrief-mcp:8787`.
   `databrief-mcp` is the server's name on Docker's own network, which is why no port needs publishing.
3. Put that same hostname in `DATABRIEF_PUBLIC_URL`, then `docker compose up -d`.

**No login, no Access policy, no Turnstile and no bot challenge may sit in front of that hostname.** Claude's and ChatGPT's servers call it directly and
cannot answer a challenge. The server defends itself: it accepts only small requests, only POST on `/mcp`, and has a flood guard.

## Every day

```bash
docker compose ps                 # state and health
docker compose logs -f            # follow the logs (Ctrl+C to leave)
docker compose restart            # restart both
docker compose stop               # stop (the connector then shows an error in the chat apps)
docker compose up -d              # start again
```

Both services have `restart: unless-stopped`: they come back after a reboot, unless you stopped them yourself.

## Update it

```bash
git pull
cd mcp
docker compose up -d --build      # rebuilds the image (and the widget page inside it) and replaces the containers
```

The widget page is built into the image from the repository. When the page changes, the repository also changes the widget's **address** in
`mcp/uris.json` (a changed widget needs a new one, and every old address keeps answering), so there is nothing for you to do beyond the update.
The chat apps keep a widget by its address: after an update, **ChatGPT users refresh the plugin** in their settings, and anyone whose app still shows an
old widget removes and adds the connector again.

To update the tunnel software, change the version in `CLOUDFLARED_IMAGE` (the pinned version is on purpose), then `docker compose up -d`.

## Check it

From the server:

```bash
curl -s http://127.0.0.1:8787/healthz                      # ok
curl -s -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'      # the databrief_open tool, with the widget's address
```

**From outside your own network** (this is the check that matters): open `https://YOUR-HOSTNAME/healthz` on a phone on mobile data, or from another
network. It must say `ok`. Then add `https://YOUR-HOSTNAME/mcp` as a connector in Claude (no sign-in) or as a plugin in ChatGPT, and ask for DataBrief.

## When it does not work

| What you see | Probably | What to do |
|---|---|---|
| Cloudflare error **530** or **1033** on the hostname | the tunnel is not connected | `docker compose ps`; `docker compose logs cloudflared`: look for "Registered tunnel connection"; check `TUNNEL_TOKEN` and that the container runs |
| Cloudflare error **502** | the tunnel is up but the server is down or unhealthy | `docker compose ps`; `docker compose logs databrief-mcp`; `docker compose restart databrief-mcp` |
| `curl http://127.0.0.1:8787/healthz` answers, the public address does not | the hostname's service address is wrong | in the dashboard it must be **HTTP** and `databrief-mcp:8787` |
| The chat app says it cannot reach the connector | the server or the tunnel is down, or the app holds an old widget address | check `/healthz` from outside; then remove and add the connector again |
| HTTP **403** on `/mcp` | a browser page from an origin that is not allowed | add the origin to `DATABRIEF_ALLOWED_ORIGINS` (the chat apps send none and are never affected) |
| HTTP **429** | the flood guard | wait the seconds in `Retry-After`, or raise `DATABRIEF_RATE_PER_MIN` |
| The server stops at start and says the widget page does not exist | the image was built without the widget | `docker compose build --no-cache`, with `databrief.html` and `widget/` present in the repository |
| After a reboot nothing runs | Docker itself does not start at boot | `systemctl enable docker` (Linux) |

## What the logs hold

One line per request: time, route, HTTP status, duration, the **names** of the MCP methods it knows (any other is logged as `other`), the tool name, the name the chat
app gives itself, and the first word of its user agent. **No file content, no tool argument, no header, no cookie, no token and no IP address.** They rotate
by themselves (3 files of 10 MB). `DATABRIEF_LOG=off` turns them off. The tunnel and Cloudflare have their own logs: read their settings too.

## Shut it down and revoke it

- Stop it: `docker compose down` (add `--rmi local` to remove the image).
- Cut the public address at once, without touching the server: in the Cloudflare dashboard, delete the public hostname or the tunnel. To rotate the token
  instead, refresh the tunnel's token in the dashboard, put the new one in `.env` and `docker compose up -d`.
- Users remove the connector in Claude or the plugin in ChatGPT. Nothing about them is stored on the server, so there is nothing to delete.

## Security notes

- What is reachable: `/mcp` (POST only), `/healthz`, a short home page, the icon. There is no way to upload or read a file, and the code has no call that
  writes to disk or reaches out to the network (a test checks it).
- `DATABRIEF_TRUST_PROXY_HEADER` makes the flood guard believe a header. Set it only when every request really comes through that proxy (the tunnel);
  on a server reachable directly, anyone could put any address in it.
- The flood guard is generous on purpose, because Claude and ChatGPT call from shared cloud addresses.
- `.env` holds the tunnel token: protect the file (`chmod 600 .env`), and rotate the token if it ever leaks.
