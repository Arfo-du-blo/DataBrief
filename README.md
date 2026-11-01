# DataBrief

**Give AI the data context it is missing. 100% offline, in your browser.**

This repository is two things at once:

- 📊 **A tool you can use today.** One private, self-contained page that turns your data into a prompt any AI
  assistant understands: not just the values, but the structure, the metadata and the **relationships** that give them
  meaning. It works everywhere, on any computer, with no installation, and is easy to share with your whole team. Your
  files never leave your browser. And when your data **cannot be shared even with an AI**, it can describe it
  without a single record: [Do not share data](#do-not-share-data).
- 🎓 **A complete deployment tutorial built on that tool.** Because DataBrief is a single file with no backend, it's
  the perfect real-world example for learning how a web app gets from your laptop to the world: GitHub/GitLab Pages,
  local servers, Docker, reverse proxies and HTTPS, a Raspberry Pi, an ESP32, Kubernetes, and Cloudflare Zero Trust.
  Along the way, you'll learn to check for yourself that a page really keeps your data private.

Use it, share it, or learn from it, or all three.

**Try it now:** <https://arfo-du-blo.github.io/DataBrief/> · **Start the tutorial:** [docs/learn.md](docs/learn.md)

---

## What DataBrief does

DataBrief is a single, self-contained HTML page. Drop a data file on it, and it produces a Markdown (`.md`) file you can
paste into, or upload to, any AI assistant (Claude, ChatGPT, Gemini, Mistral, local LLMs…). The file contains:

1. **An introduction prompt** telling the AI that this is a file shared by the user, what it contains (sections,
   columns, metadata), and how to behave.
2. **All of the data**, formatted for the AI to read reliably (or, if you prefer, a short sample plus separate CSV files).

**100% offline and private:** everything happens in your browser. Your data never leaves your computer, even when the
page is hosted on a server, and it works with no internet at all: the page's security policy stops it from loading or
sending anything (requests, scripts, images, frames…), and you can check it yourself.
[Check it yourself →](docs/verify-privacy.md)

### Why a layer between your data and the AI?

The same AI model can give very different answers depending on the application around it: a mainstream assistant may
have a sophisticated way of reading files, while the same model reached through a basic integration may have almost
none. DataBrief prepares the information the AI receives, whatever the AI is. It does **not** claim to improve every
case: when an assistant already handles your file well, the original file may be enough.

- **Mainstream assistants** (Claude, ChatGPT, Gemini…): when your format is not accepted, or when the structure,
  metadata and relationships of the file add something the assistant would not see.
- **Local AI** (small context windows, no file handling, no database connectors): a compact, structured prompt.
- **Company AI** (custom applications and API calls): better data preparation than a plain file upload.

---

## Contents

- [Choose how to use DataBrief](#choose-how-to-use-databrief)
- [Learn deployment with DataBrief](#learn-deployment-with-databrief): the tutorial, from a single file to an ESP32
- [Do not share data](#do-not-share-data): describe your data to an AI **without its records**
- [Guides](#guides), one per way of using it
- [Expose it outside your network](#expose-it-outside-your-network-cloudflare-tunnel) (Cloudflare Tunnel)
- [Settings](#settings): every setting, for every method
- [Features](#features) · [Supported formats](#supported-formats) (one guide per format) · [The generated prompt](#the-generated-prompt) · [Token estimate](#about-the-token-estimate) · [Privacy](#privacy-and-security) · [Limits](#limits)
- [For developers](#for-developers): project structure, building, tests
- [License](#license)

---

## Choose how to use DataBrief

Start at the top: the first rows need nothing at all; the last ones are for IT teams. Click a row to open its guide.

| # | Way | Alone or team | For | You need | Guide |
|---|---|---|---|---|---|
| 1 | **Online** | Alone | Everyone | A web browser | [Open](#online) |
| 2 | **HTML file on your computer** | Alone, or share the file | Everyone | A web browser | [Open](#html-file-alone) |
| 3 | **Team defaults** (settings page) | Team | Anyone preparing it for a team | A web browser | [Open](#team-defaults-settings-page) |
| 4 | **Your own GitHub Pages** | Team | Anyone with a GitHub account | GitHub account | [Open](#your-own-github-pages) |
| 5 | **Your own GitLab Pages** (can be private) | Team | GitLab users (gitlab.com or your company's GitLab) | GitLab account | [Open](#your-own-gitlab-pages) |
| 6 | **SharePoint / Microsoft Teams** | Team | Microsoft 365 users | A hosted copy (2, 4, 5 or a server) + admin | [Open](#sharepoint-and-teams) |
| 7 | **PowerShell server** | Team (local network) | Windows users | Windows (built in) | [Open](#powershell-server-windows) |
| 8 | **Python server** | Team | IT / developers | Python 3.8+ | [Open](#python-server) |
| 9 | **Node.js server** | Team | IT / developers | Node.js 18+ | [Open](#nodejs-server) |
| 10 | **Docker (nginx image)** | Team | IT | Docker | [Open](#docker-nginx-image) |
| 11 | **Docker (Python image, interactive setup)** | Team | IT | Docker | [Open](#docker-python-image-interactive) |
| 12 | **Docker Compose** | Team | IT | Docker | [Open](#docker-compose) |
| 13 | **IIS** | Team (intranet) | Windows server admins | IIS | [Open](#iis-windows-server) |
| 14 | **Apache** | Team | Server admins / shared hosting | Apache 2.4 | [Open](#apache) |
| 15 | **nginx** (+ HTTPS, passwords, reverse proxy) | Team | Server admins | nginx | [Open](#nginx-https-passwords-reverse-proxy) |
| 16 | **Caddy** (automatic HTTPS) | Team | Server admins | Caddy | [Open](#caddy) |
| 17 | **systemd service** | Team | Linux admins | Linux + Python or Node | [Open](#systemd-linux-service) |
| 18 | **Kubernetes** | Team | Cluster admins | Kubernetes | [Open](#kubernetes) |
| 19 | **Raspberry Pi** (Ubuntu Server 26.04 LTS) | Team (local network) | Home, classroom, small teams | A Raspberry Pi 4 or 5 | [Open](#raspberry-pi) |
| 20 | **ESP32 / Arduino Nano ESP32** (pocket server, own Wi-Fi) | Team (local network) | Makers, offline sites | An ESP32 board (4 MB+) | [Open](#esp32-and-arduino) |

**What is the difference?** The page always does all the work in the user's browser. The methods only change *where the
page comes from* and *which defaults it has* (language, mode, locked settings, your team's instructions…). See
[Settings](#settings). To reach a server from outside your network, see
[Cloudflare Tunnel](#expose-it-outside-your-network-cloudflare-tunnel).

---

## Learn deployment with DataBrief

DataBrief doubles as a hands-on deployment course. Each level adds **one new idea**, gives you a working DataBrief,
and points to its guide. Stop wherever you like.

| Level | Deploy it… | What you learn |
|---|---|---|
| **0** | [as a file](#html-file-alone) | A web page is just a file; the browser is the runtime |
| **1** | on [GitHub](#your-own-github-pages) / [GitLab Pages](#your-own-gitlab-pages) | Git, CI/CD, static hosting, HTTPS, releases |
| **2** | with a server on your PC ([PowerShell](#powershell-server-windows), [Python](#python-server), [Node.js](#nodejs-server)) | Ports, `localhost` vs network, HTTP headers, configuration |
| **3** | in a container ([Docker](#docker-nginx-image), [Compose](#docker-compose)) | Images, registries, environment variables, multi-architecture |
| **4** | behind a reverse proxy ([nginx](#nginx-https-passwords-reverse-proxy), [Apache](#apache), [Caddy](#caddy), [IIS](#iis-windows-server)) | TLS certificates, passwords, sub-paths |
| **4b** | through a [Cloudflare Tunnel](#expose-it-outside-your-network-cloudflare-tunnel) | Outbound tunnels, Zero Trust access |
| **5** | on a [Raspberry Pi](docs/raspberry-pi.md) | Linux server basics: SSH, systemd, mDNS, firewall, ARM |
| **6** | on an [ESP32 microcontroller](docs/esp32-arduino.md) | Embedded constraints, compression, Wi-Fi modes, firmware |
| **7** | on [Kubernetes](#kubernetes) | Declarative deployment, probes, Services, Ingress |
| **★** | [Check it yourself](docs/verify-privacy.md) | Prove the page sends nothing, and catch a tampered copy |

**→ The full tutorial, with the concepts behind each level: [docs/learn.md](docs/learn.md)**

---

## Do not share data

Your data cannot leave your computer, and sometimes it cannot even be shared with an AI. DataBrief can still help.

Tick **Do not share data** to get an AI-ready **description** of your file: its structure, its metadata and, if you
allow it, aggregate statistics, **without a single record**. Then ask the AI how to analyse your data, which
statistical methods to use, which relationships to investigate and which questions to ask, without giving it access to
the underlying observations.

- **Three levels:** structure only (default) → + counts → + summaries (opt-in, with a warning; groups of fewer than 5
  records are hidden).
- **You choose what to include:** table and column names (or neutral ones), labels, relationships, file name, free
  text from the file, SQL definitions.
- **A different prompt, not the normal one with rows removed:** it tells the AI it has **not** received the data, not
  to invent values or conclusions, and asks for an analysis *plan* and code you run locally.
- **Built so a record cannot slip in:** the parsed rows are released and a separate builder only sees a record-free
  copy. Canary tests check every format, every level and every switch, and an independent review tried to break it.
- **Honest limits:** it reduces the risk, it does not anonymise. Read the prompt before you send it.

**→ The full guide: [docs/no-share.md](docs/no-share.md)** · Team setting: `DATABRIEF_SHARE=no`, lock `share`, link `?share=no`.

---

## Guides

### Online

1. Open <https://arfo-du-blo.github.io/DataBrief/>.
2. Drop a data file on the page, or click to browse.
3. Click **Copy** or **Download .md**, and give it to your AI.

Optional: add settings to the link, for example
<https://arfo-du-blo.github.io/DataBrief/?lang=fr&mode=files> (see [URL parameters](#url-parameters)).

[↑ Back to the table](#choose-how-to-use-databrief)

### HTML file alone

1. Download `databrief.html` from the [latest release](https://github.com/Arfo-du-blo/DataBrief/releases/latest)
   (or from this repository).
2. Double-click it: it opens in your browser. It works without internet.
3. To share it, send the file (email, chat, shared folder): each person opens it on their own computer.

[↑ Back to the table](#choose-how-to-use-databrief)

### Team defaults (settings page)

`databrief_set_default.html` creates a `databrief.html` with **your team's defaults**, without any technical step.

1. Open `databrief_set_default.html` ([latest release](https://github.com/Arfo-du-blo/DataBrief/releases/latest),
   or [online](https://arfo-du-blo.github.io/DataBrief/databrief_set_default.html)).
2. Choose the defaults: interface language, prompt language, data mode, layout, theme, sample rows, warning threshold.
3. **Lock** what people should not change: a locked setting uses your value and its control is hidden.
   You can also hide the row-limit control, the **Edit** button or the **View formatted** button.
4. Optional: write **your team's prompt text** (introduction, "How to respond" for each data mode).
   "Start from DataBrief's text" fills the box with the generated text so you can adapt it.
5. Click **Try it in a new tab** to check, then **Download databrief.html**, and share that file
   (or host it with any of the methods below).

To change it later, open the settings page again and click **Load databrief.html…** to reload its settings.
The same box shows the equivalent `DATABRIEF_*` variables, ready for a server or Docker.

[↑ Back to the table](#choose-how-to-use-databrief)

### Your own GitHub Pages

Free hosting with HTTPS, updated automatically.

1. Fork this repository (or push your copy to a new repository).
2. Optional: replace `databrief.html` with your own file from the [settings page](#team-defaults-settings-page)
   (commit it) to give everyone your defaults.
3. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Push to `main`. The workflow `.github/workflows/pages.yml` publishes the site at
   `https://<your-account>.github.io/<repository>/` (the settings page is at `…/databrief_set_default.html`).

Your own domain: add it in **Settings → Pages → Custom domain** and create the DNS record GitHub shows you.

> The workflow rebuilds `databrief.html` from the sources. If you committed a customised `databrief.html`, remove the
> "Build the HTML files from the sources" step from `pages.yml` so your file is published as it is.

[↑ Back to the table](#choose-how-to-use-databrief)

### Your own GitLab Pages

The GitLab equivalent of GitHub Pages, on gitlab.com or on your company's own GitLab server. Its main advantage for a
team: the site can be **private**, visible only to members of the project.

1. Create a GitLab project and push this repository to it (or import it: **New project → Import project → Repository
   by URL**, with `https://github.com/Arfo-du-blo/DataBrief.git`).
2. Optional: replace `databrief.html` with your own file from the [settings page](#team-defaults-settings-page)
   (then remove `pwsh ./build.ps1` from the `build` job in `.gitlab-ci.yml`, so your file is published as it is).
3. Push to the default branch. The `pages` job in [`.gitlab-ci.yml`](.gitlab-ci.yml) publishes the site; find its
   address in **Deploy → Pages** (usually `https://<group>.gitlab.io/<project>/`).
4. **Private site:** **Settings → General → Visibility → Pages: Only Project Members**. Users then sign in to GitLab
   to open DataBrief.
5. Own domain: **Deploy → Pages → New Domain**, then create the DNS records GitLab shows you.

On a version tag (`git tag v1.2.0 && git push origin v1.2.0`), the same file also creates a GitLab release with both
HTML files (stored in the project's **Package Registry**) and pushes the Docker images to the project's
**Container Registry**: `registry.gitlab.com/<group>/<project>:latest`, `:nginx`, `:python`, `:<tag>`…
These images work exactly like the [Docker](#docker-nginx-image) ones.

Self-managed GitLab: an administrator must enable GitLab Pages (and the Container Registry for the images). On GitLab
versions older than 18, change the `release` job image to `registry.gitlab.com/gitlab-org/release-cli:latest`.

[↑ Back to the table](#choose-how-to-use-databrief)

### SharePoint and Teams

Modern SharePoint does not run HTML files from a document library (it downloads them instead). Host DataBrief
somewhere first ([GitHub Pages](#your-own-github-pages), [GitLab Pages](#your-own-gitlab-pages), [Online](#online),
or one of the servers below), then:

**SharePoint page (Embed web part)**

1. A SharePoint admin allows the host: **Site settings → HTML Field Security** (or the tenant setting for embedded
   content) → add your DataBrief domain (e.g. `arfo-du-blo.github.io` or `databrief.yourcompany.com`).
2. Edit a SharePoint page → **+ → Embed** → paste the DataBrief address (or `<iframe src="…" width="100%" height="900"></iframe>`).
3. If you host DataBrief with a server from this repository, allow SharePoint to show it in a frame:
   `DATABRIEF_FRAME_ANCESTORS='self' https://yourcompany.sharepoint.com` (see [Settings](#settings)).

**Microsoft Teams (Website tab)**

1. In a channel: **+ (Add a tab) → Website** → paste the DataBrief address.
2. With a DataBrief server, also allow Teams: `DATABRIEF_FRAME_ANCESTORS='self' https://teams.microsoft.com https://*.teams.microsoft.com`.

Check with your Microsoft 365 admin: tenant policies can block frames or file downloads inside SharePoint and Teams.
A SharePoint Framework (SPFx) web part could show DataBrief natively inside SharePoint, but it is not provided here.

[↑ Back to the table](#choose-how-to-use-databrief)

### PowerShell server (Windows)

Built into Windows: nothing to install, no administrator rights.

```powershell
# from the repository folder (or a folder with databrief.html and deploy\powershell\serve.ps1)
powershell -ExecutionPolicy Bypass -File deploy\powershell\serve.ps1            # start
powershell -ExecutionPolicy Bypass -File deploy\powershell\serve.ps1 -Setup     # answer questions first
powershell -ExecutionPolicy Bypass -File deploy\powershell\serve.ps1 -Port 9000 -Lang fr -Lock "lang,mode"
```

- Open <http://localhost:8080/>. Colleagues use `http://<your-computer-name>:8080/` (allow it in the Windows firewall
  if asked).
- **Configure:** `-Setup` asks each question and can save the answers in `deploy\databrief.conf`; or edit that file;
  or use parameters (`Get-Help deploy\powershell\serve.ps1 -Full`). The listening address parameter is `-Address`.
- **Stop:** Ctrl+C.

[↑ Back to the table](#choose-how-to-use-databrief)

### Python server

Python 3.8 or newer, standard library only (no `pip install`).

```bash
python3 deploy/python/serve.py              # start (Windows: py deploy\python\serve.py)
python3 deploy/python/serve.py --setup      # answer questions, optionally save them, then start
python3 deploy/python/serve.py --port 9000 --lang fr --lock lang,mode
python3 deploy/python/serve.py --help       # every option
```

- Open <http://localhost:8080/>.
- **Configure:** `--setup`, or `deploy/databrief.conf` (found automatically; or `--config PATH`), or environment
  variables, or options. `--check` validates the settings and exits.
- **Concurrency:** `--threads` / `DATABRIEF_THREADS` (default 8).
- **Run it permanently:** [systemd](#systemd-linux-service). **HTTPS / password:** put [nginx](#nginx-https-passwords-reverse-proxy) or [Caddy](#caddy) in front.

[↑ Back to the table](#choose-how-to-use-databrief)

### Node.js server

Node.js 18 or newer, built-in modules only (no `npm install`).

```bash
node deploy/node/server.js                  # start
node deploy/node/server.js --setup          # answer questions, optionally save them, then start
node deploy/node/server.js --port 9000 --lang fr --lock lang,mode
node deploy/node/server.js --help
```

Same settings, file and behaviour as the [Python server](#python-server). Concurrency:
`--max-connections` / `DATABRIEF_MAX_CONNECTIONS` (default 256).

[↑ Back to the table](#choose-how-to-use-databrief)

### Docker (nginx image)

Small image (nginx, runs without root). The default image.

```bash
docker run -d --name databrief -p 8080:8080 ghcr.io/arfo-du-blo/databrief:latest
docker run -d --name databrief -p 8080:8080 \
  -e DATABRIEF_LANG=fr -e DATABRIEF_MODE=files -e DATABRIEF_LOCK=lang,mode \
  ghcr.io/arfo-du-blo/databrief:latest
```

- Tags: `latest` and `nginx` (same image), and one per version (`v1.2.0`, `v1.2.0-nginx`).
- Multi-architecture: every tag works on PCs and servers (`amd64`) and on ARM boards such as the Raspberry Pi
  (`arm64`); Docker picks the right one.
- Every setting is a `DATABRIEF_*` variable ([Settings](#settings)); they are applied at each container start.
- Health check: `GET /healthz` (used by Docker's `HEALTHCHECK`).
- Build it yourself: `docker build -f deploy/docker/Dockerfile -t databrief .` (from the repository root).

[↑ Back to the table](#choose-how-to-use-databrief)

### Docker (Python image, interactive)

The same server as the [Python server](#python-server), with its interactive setup.

```bash
# questions, answers saved in ./config for the next starts
mkdir -p config
docker run -it --rm -p 8080:8080 -v "$PWD/config:/config" ghcr.io/arfo-du-blo/databrief:python setup

# later, without questions (uses ./config/databrief.conf)
docker run -d --name databrief -p 8080:8080 -v "$PWD/config:/config" ghcr.io/arfo-du-blo/databrief:python

# or with variables only
docker run -d --name databrief -p 8080:8080 -e DATABRIEF_LANG=fr ghcr.io/arfo-du-blo/databrief:python
```

At the end of `setup`, it also prints the equivalent `docker run` command and the `docker-compose.yml` lines.
If the answers cannot be saved (folder not writable by the container user, uid 10001), they are used for that run only:
`chmod 777 config` or use the printed command.

[↑ Back to the table](#choose-how-to-use-databrief)

### Docker Compose

`deploy/docker/docker-compose.yml` lists **every** setting with a comment, CPU/memory limits and restart policy.

```bash
docker compose -f deploy/docker/docker-compose.yml up -d                     # nginx variant, port 8080
docker compose -f deploy/docker/docker-compose.yml --profile python up -d    # also the Python variant, port 8081
docker compose -f deploy/docker/docker-compose.yml run --rm databrief-python setup   # interactive setup
docker compose -f deploy/docker/docker-compose.yml down
```

Works with Podman too (`podman compose …`).

[↑ Back to the table](#choose-how-to-use-databrief)

### IIS (Windows Server)

1. Make your `databrief.html` with the [settings page](#team-defaults-settings-page) (or use the default one).
2. Create a folder (e.g. `C:\inetpub\databrief`) with `databrief.html` and [`deploy/iis/web.config`](deploy/iis/web.config).
3. **IIS Manager → Sites → Add Website** (or **Add Application** under a site) → physical path = that folder.
4. HTTPS: add an `https` binding with your certificate. Access control: **Authentication → Windows Authentication**.

`web.config` sets the default document, security headers (edit `frame-ancestors` for SharePoint/Teams) and compression.

[↑ Back to the table](#choose-how-to-use-databrief)

### Apache

- **Own server:** [`deploy/apache/databrief.conf`](deploy/apache/databrief.conf) is a virtual host with HTTPS, headers
  and an optional password. Block A serves `databrief.html` directly; block B is a reverse proxy to a DataBrief server.
  ```bash
  sudo a2enmod headers ssl proxy proxy_http deflate rewrite
  sudo cp deploy/apache/databrief.conf /etc/apache2/sites-available/ && sudo a2ensite databrief
  sudo apachectl configtest && sudo systemctl reload apache2
  ```
- **Shared hosting / existing site:** upload `databrief.html` and [`deploy/apache/.htaccess`](deploy/apache/.htaccess)
  to a folder.

[↑ Back to the table](#choose-how-to-use-databrief)

### nginx (HTTPS, passwords, reverse proxy)

[`deploy/nginx/databrief.conf`](deploy/nginx/databrief.conf) covers both uses:

- **A. nginx serves `databrief.html`** (make it with the [settings page](#team-defaults-settings-page)), from `/var/www/databrief`.
- **B. nginx is a reverse proxy** in front of a [Python](#python-server), [Node.js](#nodejs-server) or
  [PowerShell](#powershell-server-windows) server or a [Docker](#docker-nginx-image) container listening on
  `127.0.0.1:8080`. The settings then come from that server.

```bash
sudo cp deploy/nginx/databrief.conf /etc/nginx/conf.d/databrief.conf   # edit server_name, certificates, block A or B
sudo nginx -t && sudo systemctl reload nginx
```

**HTTPS.** The DataBrief servers speak plain HTTP on purpose: HTTPS is handled by the proxy. Get a certificate
(for example `sudo certbot --nginx -d databrief.example.com`) and set `ssl_certificate` / `ssl_certificate_key`.
The file also redirects HTTP to HTTPS and sends `Strict-Transport-Security`.

**Passwords (basic auth).** Also handled by the proxy:
```bash
sudo apt install apache2-utils
sudo htpasswd -c /etc/nginx/databrief.htpasswd alice     # -c only for the first user
```
then uncomment `auth_basic` and `auth_basic_user_file`. To allow only your network, uncomment the `allow` / `deny` lines.

**Sub-path** (e.g. `https://intranet.example.com/databrief/`): set `DATABRIEF_BASE_PATH=/databrief/` on the DataBrief
server and use the `location /databrief/` example at the end of the file.

The same principles apply to [Apache](#apache) (block B, `AuthType Basic`) and [Caddy](#caddy) (`reverse_proxy`, `basic_auth`).

[↑ Back to the table](#choose-how-to-use-databrief)

### Caddy

Automatic HTTPS in a few lines: [`deploy/caddy/Caddyfile`](deploy/caddy/Caddyfile).

```bash
caddy run --config deploy/caddy/Caddyfile
```

Replace `:8080` with your host name (e.g. `databrief.example.com`) and Caddy gets a free certificate automatically.
Block A serves `databrief.html` from `/srv/databrief`; block B (`reverse_proxy`) sits in front of a DataBrief server.
Password: `caddy hash-password`, then the `basic_auth` block.

[↑ Back to the table](#choose-how-to-use-databrief)

### systemd (Linux service)

Runs the [Python](#python-server) or [Node.js](#nodejs-server) server in the background, starts it at boot and restarts
it if it stops. Step-by-step commands are at the top of each file:
[`databrief-python.service`](deploy/systemd/databrief-python.service),
[`databrief-node.service`](deploy/systemd/databrief-node.service).

```bash
sudo systemctl enable --now databrief-python      # after copying the files as described in the unit file
journalctl -u databrief-python -f                 # logs
```

[↑ Back to the table](#choose-how-to-use-databrief)

### Kubernetes

[`deploy/kubernetes/databrief.yaml`](deploy/kubernetes/databrief.yaml): a ConfigMap with every `DATABRIEF_*` setting,
a Deployment (nginx image, non-root, probes on `/healthz`, resource limits) and a Service. An Ingress example is at the end.

```bash
kubectl apply -f deploy/kubernetes/databrief.yaml
kubectl port-forward svc/databrief 8080:80
```

[↑ Back to the table](#choose-how-to-use-databrief)

### Raspberry Pi

An always-on, silent DataBrief server for a home, a classroom or a small team, at `http://databrief.local`.
Ubuntu Server 26.04 LTS on a Raspberry Pi 4 or 5, then one command on the Pi:

```bash
git clone https://github.com/Arfo-du-blo/DataBrief.git && cd DataBrief
sudo bash deploy/raspberry-pi/setup.sh             # Python server + systemd (recommended)
sudo bash deploy/raspberry-pi/setup.sh --docker    # or Docker (the images exist for ARM)
```

The script installs the service, sets up `databrief.local` (mDNS) and a firewall, and explains every step it takes.

**→ Step-by-step guide, from flashing the card to HTTPS: [docs/raspberry-pi.md](docs/raspberry-pi.md)**

[↑ Back to the table](#choose-how-to-use-databrief)

### ESP32 and Arduino

A €5–15 ESP32 board serves DataBrief over Wi-Fi: it joins your network (`http://databrief.local`), or creates its own,
with no router and no internet. The page is stored compressed (about 1 MB) inside the firmware.

- **Boards:** any ESP32 with 4 MB of flash or more, the ESP32-S3, and the **Arduino Nano ESP32**. Classic Arduinos
  (Uno, Nano, Mega) are far too small; the guide explains why.
- **Toolchains:** PlatformIO (`deploy/esp32/platformio.ini`) or the Arduino IDE 2 (`deploy/esp32/DataBrief/DataBrief.ino`),
  with the same code.

```bash
cd deploy/esp32 && pio run -e esp32dev -t upload     # PlatformIO; Arduino IDE: see the guide
```

**→ Step-by-step guide, specs, Wi-Fi modes and troubleshooting: [docs/esp32-arduino.md](docs/esp32-arduino.md)**

[↑ Back to the table](#choose-how-to-use-databrief)

---

## Expose it outside your network (Cloudflare Tunnel)

To reach a DataBrief server (PowerShell, Python, Node.js, Docker, Raspberry Pi…) from outside your network, a
**Cloudflare Tunnel** avoids opening any port on your router. A small program, `cloudflared`, runs next to DataBrief
and opens an *outgoing* connection to Cloudflare. Visitors use `https://databrief.yourdomain.com` (HTTPS is
automatic), and with **Cloudflare Access** (Zero Trust) they must first prove who they are, for example with an e-mail
code or your company login. Since files are processed in the browser, **Cloudflare carries the page, never your
data.** For an ESP32, run `cloudflared` on another machine on the same network. GitHub and GitLab Pages don't need it.

> ⚠️ **Be extra careful: this puts a service on the internet.** Always put an Access policy in front, never a public
> tunnel without one. Protect your Cloudflare account with two-factor authentication, keep `cloudflared` updated,
> and turn off features that rewrite pages (Rocket Loader, minification) for the DataBrief address. Read Cloudflare's
> documentation before you start.

More: [the principle, explained](docs/learn.md#level-4b-cloudflare-tunnel-and-zero-trust) ·
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) ·
[Self-hosted application with Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) ·
[Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)

---

## Settings

The same settings work everywhere. Where they come from depends on the method:

| Method | How to set them |
|---|---|
| HTML file, GitHub Pages, IIS, Apache/nginx/Caddy serving the file | Written into the file by the [settings page](#team-defaults-settings-page) |
| Python, Node.js, PowerShell servers | `--setup` / `-Setup`, `deploy/databrief.conf`, environment variables, command-line options |
| Docker, Compose, Kubernetes | `DATABRIEF_*` environment variables (Python image: also `setup` and `/config/databrief.conf`) |
| Anyone, any method | [URL parameters](#url-parameters) for settings that are not locked |

Priority for the servers: **command-line option > environment variable > databrief.conf > built-in default**.
An empty value means "not set".

### Page settings

| Variable / `databrief.conf` key | Option (Python, Node) | PowerShell | Default | Meaning |
|---|---|---|---|---|
| `DATABRIEF_LANG` | `--lang` | `-Lang` | *(visitor's choice, English)* | Interface language: `en fr es de it pt nl pl ru tr zh ja ko hi ar` |
| `DATABRIEF_PROMPT_LANG` | `--prompt-lang` | `-PromptLang` | *(same as interface)* | Language of the generated prompt |
| `DATABRIEF_MODE` | `--mode` | `-Mode` | `inline` | `inline` = data inside the prompt, `files` = separate CSV files + sample |
| `DATABRIEF_LAYOUT` | `--layout` | `-Layout` | `auto` | `auto`, `table` or `csv` |
| `DATABRIEF_THEME` | `--theme` | `-Theme` | `system` | `system`, `light` or `dark` |
| `DATABRIEF_SHARE` | `--share` | `-Share` | `yes` | `no` = "Do not share data": the prompt describes the file without any of its records. Lock it (`share`) to impose it |
| `DATABRIEF_PROFILE` | `--profile` | `-DataProfile` | `yes` | `no` = the statistics about each column ("data profile") are off by default; users can switch them on. Lock it (`profile`) to fix the value and hide the checkbox |
| `DATABRIEF_SAMPLE_ROWS` | `--sample-rows` | `-SampleRows` | `5` | Sample rows per section in CSV-files mode (1–100) |
| `DATABRIEF_WARN_TOKENS` | `--warn-tokens` | `-WarnTokens` | `150000` | Large-file warning threshold |
| `DATABRIEF_LOCK` | `--lock` | `-Lock` | *(none)* | Comma-separated: `lang`, `promptLang`, `mode`, `layout`, `theme`, `share`, `profile` (value fixed, control hidden); `limit`, `edit`, `view` (row-limit control / Edit / View formatted hidden) |
| `DATABRIEF_PROMPT_INTRO` | `--prompt-intro` | `-PromptIntro` | *(DataBrief's text)* | Your introduction (under the title) |
| `DATABRIEF_PROMPT_RESPOND` | `--prompt-respond` | `-PromptRespond` | *(DataBrief's text)* | Your "How to respond" part, data inside the prompt |
| `DATABRIEF_PROMPT_RESPOND_FILES` | `--prompt-respond-files` | `-PromptRespondFiles` | *(DataBrief's text)* | Same, CSV-files mode |

Your own texts are used as written, in every language; empty = DataBrief's text, translated automatically. The
overview, column details, data and "How this file is formatted" notes are always generated for each file. Users can
still edit the prompt before copying it, unless `edit` is locked. In `databrief.conf`, write new lines as `\n`
inside double quotes; in Compose/Kubernetes use a YAML block (`|`).

### Server settings

| Variable / `databrief.conf` key | Option (Python, Node) | PowerShell | Default | Meaning |
|---|---|---|---|---|
| `DATABRIEF_HOST` | `--host` | `-Address` | `0.0.0.0` | Listening address (`0.0.0.0` = network, `127.0.0.1` = this computer only) |
| `DATABRIEF_PORT` | `--port` | `-Port` | `8080` | Port |
| `DATABRIEF_THREADS` | `--threads` (Python) | `-Threads` | `8` | Requests served at the same time |
| `DATABRIEF_MAX_CONNECTIONS` | `--max-connections` (Node) | — | `256` (Docker nginx: `1024`) | Maximum open connections (nginx: `worker_connections`) |
| `DATABRIEF_BASE_PATH` | `--base-path` | `-BasePath` | `/` | URL path, e.g. `/databrief/` |
| `DATABRIEF_ACCESS_LOG` | `--access-log` | `-AccessLog` | `true` | Log every request |
| `DATABRIEF_FRAME_ANCESTORS` | `--frame-ancestors` | `-FrameAncestors` | `'self'` | Sites allowed to show DataBrief in a frame (SharePoint, Teams…) |
| `DATABRIEF_HTML` | `--html` | `-Html` | *(found automatically)* | Path of `databrief.html` |
| `DATABRIEF_CONFIG` | `--config` | `-Config` | *(see below)* | Path of `databrief.conf` |

`databrief.conf` is searched in this order: `--config`, `DATABRIEF_CONFIG`, the current folder, `deploy/` next to the
server script, `/config/` (Docker).

### URL parameters

For settings that are **not locked**, a link can choose them: `?lang=fr`, `?prompt=en`, `?mode=files`,
`?layout=csv`, `?theme=dark` (combine with `&`). Example: `…/databrief.html?lang=de&mode=files`.
`?share=no` opens DataBrief in "Do not share data" mode. A link can switch this mode on, never off.

---

## Features

- **Data layout:** Markdown table or CSV block. **Auto** (default) uses tables for small sections and CSV for large ones.
- **Two ways to give the data to the AI** (switch at the top of the result):
  - **Inside the prompt** (default): one `.md` file with everything.
  - **As separate CSV files**, for AIs that run code: the prompt keeps the instructions, the column details and a
    short sample per section, names the CSV file of each section, and tells the AI that the rows shown are only a
    sample and to ask for the files if they were not attached. Buttons: Copy, Download `.md`, Download data
    (`.csv`, or `.zip` for several sections), Download all (`.zip` with the prompt and the CSV files).
- **Token estimate** with an explanation (ⓘ), and a **large-file warning** with an optional "keep only the first *N*
  rows per section". Nothing is ever cut without your choice.
- **Edit the prompt** in the preview: **Edit**, rewrite, then **Confirm** (or **Cancel**). Free text: the
  introduction, "How to respond" and "How this file is formatted". Locked: the title, the overview, the sections and
  columns, the data and the closing line. The token estimate updates live. When a setting change would regenerate
  text you edited, DataBrief asks **Keep my text** or **Regenerate**. Each data mode keeps its own edits.
- **View formatted:** the prompt rendered as a document (headings, bold, tables…) in a large window.
- **Relationships between tables or sheets:** declared ones (SQLite foreign keys, composite and self-referencing keys,
  one-to-one, junction tables as many-to-many) and **inferred candidates** for files that declare none: the column names
  must correspond, the parent column must be unique and the values must agree. Inferred relationships are always
  labelled as candidates to validate, with their evidence; a name alone is never enough.
- **Data profile**, on by default and optional ("Add statistics about each column"): missing and distinct values, the kind of each column
  (identifier, categorical, continuous, date), category frequencies, minimum, maximum, mean, standard deviation,
  median and outliers, duplicate rows. Numbers in an ambiguous format are reported as such, never guessed.
- **Click a format** at the top of the page for what DataBrief reads from it and the best file to give, and see
  **what it found** in your file (sections, columns, relationships).
- **Format notes** in the prompt ("How this file is formatted": sections, CSV rules, empty cells, flattened columns,
  truncation) so the AI reads the data correctly.
- **15 languages** for the page and the prompt: English, French, Spanish, German, Italian, Portuguese, Dutch, Polish,
  Russian, Turkish, Chinese, Japanese, Korean, Hindi, Arabic (right-to-left). The prompt follows the page language
  by default and has its own selector.
- **Light and dark** themes, mobile-friendly.

## Supported formats

Click a format in the page for a short card, or read its **guide**: what DataBrief extracts, the best file to give,
how to export it, and its limits.

| Category | Formats | Guide |
|---|---|---|
| Delimited text | CSV, TSV, TXT (delimiter auto-detected: `,` `;` tab `\|`) | [CSV, TSV, TXT](docs/formats/csv.md) |
| Spreadsheets | XLSX, XLSM, XLS, ODS (**all sheets**) | [Excel and OpenDocument](docs/formats/excel.md) |
| Structured | JSON, NDJSON / JSONL | [JSON](docs/formats/json.md) |
| | XML | [XML](docs/formats/xml.md) |
| | YAML (several documents = one row each) | [YAML](docs/formats/yaml.md) |
| Web | HTML (**every** `<table>` on the page) | [HTML tables](docs/formats/html.md) |
| Statistics | SPSS `.sav` and `.zsav` | [SPSS](docs/formats/spss.md) |
| Data engineering | Parquet | [Parquet](docs/formats/parquet.md) |
| Databases | SQLite (`.db`, `.sqlite`, `.sqlite3`; **all tables**) | [SQLite](docs/formats/sqlite.md) |

When a file holds several sheets or tables, each one becomes its own section, and the AI is told that they are separate.

**What is extracted** (when the format provides it):

| Format | Beyond the values |
|---|---|
| SPSS | variable labels, **value labels** (`1 = Male`, shown as words in the data), type and format, measurement level, missing-value definitions, file label, notes |
| SQLite | types, primary keys (in order), **foreign keys** (composite, with `ON DELETE`), unique constraints, indexes, `CREATE TABLE`, views with their SQL, **relationships**, generated columns, exact 64-bit integers |
| Parquet | the **type of every nested field** (`STRUCT`, `LIST`, `MAP`), required fields, decimals, timestamp units, pandas metadata, row groups, compression |
| Excel / ODS | sheet names, hidden sheets, cell comments, **merged cells, hidden rows and columns, defined names**, the number of formulas (those without a stored result are counted, not lost) |
| JSON / XML / YAML | the original path of each flattened field; XML attributes; YAML documents |
| CSV / TSV / HTML | the detected type of each column; table captions and merged cells for HTML |

## The generated prompt

The prompt tells the AI to:

1. Open with a **short summary** of the data (2–4 sentences).
2. Ask **1 to 3 blocking questions at most**, starting with the most important one: *what does the user want to
   understand, find or decide?* Column questions only if a column's meaning is unclear and it matters to that goal.
3. Wait for the answer, then base every later answer on the data, **reuse it throughout the conversation**, and
   **use tools or run code when available** rather than reading values by eye.

In CSV-files mode, it also tells the AI to check that the files are attached, and to ask for them if they are not.

## About the token estimate

Language models read text as *tokens*, chunks of a few characters. DataBrief estimates about **1 token per 4
characters** of ordinary text; numbers, symbols and non-Latin scripts (Chinese, Japanese, Korean, Hindi, Arabic) use
more. It is an approximation (about ±20%): each AI counts tokens slightly differently. Typical context windows range
from about 128k to 200k+ tokens, depending on the model.

## Privacy and security

- The page processes files **only in the browser**. No upload, no analytics, no external fonts or scripts.
- A Content-Security-Policy inside the page stops it from loading or sending anything: requests (`connect-src 'none'`),
  external scripts, styles, fonts, images and frames. Even a faulty library could not send data out that way.
  A security policy cannot stop a page from *navigating* to another address, which is why the checks below matter:
  a modified page that did so would still show up in your browser's Network tab.
- The servers in this repository only send the page; they never receive the data. They add `frame-ancestors`,
  `X-Content-Type-Options` and `Referrer-Policy` headers.
- In **View formatted**, HTML found in the data is shown as text, never executed, and images are never loaded.

**Wherever it's hosted, an unmodified page keeps your data private**: on your computer, GitHub or GitLab Pages,
Cloudflare, your own server, a Raspberry Pi or an ESP32. Whoever controls the hosting *could* modify the page, as with
any website, which is why you can check it yourself: the browser's Network tab shows every request a page makes, and
each release publishes `SHA256SUMS.txt` so you can verify you have the official file. The guide walks you through
both, and lets you catch a deliberately tampered copy in the act:
**[Check it yourself →](docs/verify-privacy.md)**

## Limits

- Encrypted or password-protected files (Excel, SQLite) cannot be read: save a copy without the password first.
- JSON and YAML numbers above 2^53 may lose precision (they are read as floating-point numbers); quote very large
  identifiers. SQLite and Parquet 64-bit integers are exact.
- Parquet: Snappy, Gzip, Zstd and LZ4 (raw) compression are supported; Brotli and Hadoop-LZ4 are not.
- Everything happens in the browser's memory: files of a few hundred MB may be slow, depending on the computer.
- The settings page and the interactive setups are in English (the tool itself has 15 languages).
- Tested automatically: the page (Chrome and Firefox), the privacy demo and "Do not share data", the Python, Node.js and PowerShell servers, both Docker
  images (`amd64`, and `arm64` under emulation), the Raspberry Pi setup script (ShellCheck and a dry run on Ubuntu
  26.04), the ESP32 firmware (compiled for three boards), and the nginx, Apache and Caddy files (syntax). Checked for
  syntax only: IIS `web.config`, Kubernetes manifest, systemd units, `.gitlab-ci.yml`, GitHub workflows. Not tested on
  real hardware: a physical Raspberry Pi or ESP32 board. SharePoint and Teams depend on your tenant's policies.

---

## For developers

### Project structure

```
databrief.html                the tool (built, self-contained)
databrief_set_default.html    the team settings page (built, contains a compressed copy of databrief.html)
build.ps1                     builds both HTML files from src/ and vendor/ (+ the demo pages and the ESP32 header)
src/
  template.html               page markup and build directives
  setdefault.html/.css/.js    the settings page
  styles.css                  light/dark theme
  i18n*.js                    15 languages (interface + prompt; one file per feature)
  config.js                   settings: config block, URL parameters, locks
  util.js                     type detection, flattening, CSV parsing, token estimate
  parsers.js                  format detection and readers (CSV…SQLite)
  relationships.js            declared and inferred relationships between sections
  profile.js                  the data profile (statistics of every column; on by default, can be switched off)
  noshare.js                  "Do not share data": the record-free copy of a file
  spss.js                     SPSS .sav / .zsav reader (original code)
  markdown.js                 builds the prompt (locked parts and editable regions) and the no-share prompt
  app.js                      page logic
deploy/
  databrief.conf              shared configuration file (every setting commented)
  python/serve.py             Python server (--setup)
  node/server.js              Node.js server (--setup)
  powershell/serve.ps1        PowerShell server (-Setup)
  docker/                     Dockerfile (nginx), Dockerfile.python, 40-databrief.sh, docker-compose.yml
  nginx/ apache/ iis/ caddy/ systemd/ kubernetes/
  raspberry-pi/               setup.sh (one-command setup), low-port.conf, docker-compose.yml
  esp32/                      DataBrief/DataBrief.ino (firmware), platformio.ini, make_header.ps1/.py
docs/                         learn.md (tutorial), no-share.md, verify-privacy.md, raspberry-pi.md, esp32-arduino.md
  formats/                    one guide per format (what is extracted, the best file, limits)
examples/tampered/            the privacy demo: tampered copies + receiver.py (never published)
.github/workflows/            pages.yml (GitHub Pages), release.yml (release + Docker images), tests.yml (tests on every push)
.gitlab-ci.yml                the same for GitLab: Pages, release, Docker images (Container Registry)
vendor/                       third-party libraries and their licenses
tests/                        test suites
```

### Building

Both HTML files are committed, so you only need to build after changing `src/`. Nothing to install:

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1      # Windows
pwsh ./build.ps1                                          # PowerShell 7 (Windows, Linux, macOS)
```

### Releasing

```bash
git tag v1.2.0 && git push origin v1.2.0
```

`.github/workflows/release.yml` creates the GitHub release (with both HTML files and `SHA256SUMS.txt`, their
fingerprints) and publishes the Docker images, for `amd64` and `arm64`, to `ghcr.io/<owner>/databrief`. After the
first release, make the package public: **your GitHub profile → Packages → databrief → Package settings → Change
visibility → Public**.

On GitLab, the same tag runs `.gitlab-ci.yml`: GitLab release, HTML files and `SHA256SUMS.txt` in the Package
Registry, multi-architecture Docker images in the Container Registry ([guide](#your-own-gitlab-pages)).

Versions follow [semantic versioning](https://semver.org/): `vMAJOR.MINOR.PATCH`. New features or deployment options
→ minor (`v1.2.0`); fixes only → patch (`v1.2.1`); changes that break existing settings or URLs → major (`v2.0.0`).

### Tests

The tests run in an isolated environment (WSL or Linux), created in one folder and deleted afterwards:

```bash
bash tests/setup_testenv.sh   # creates ~/databrief-testenv (Node, Puppeteer + Chrome, Python venv)
bash tests/run_all.sh         # browser tests, server tests, Docker + configuration files
rm -rf ~/databrief-testenv    # removes everything
```

```powershell
powershell -ExecutionPolicy Bypass -File tests\test_powershell.ps1   # PowerShell server, on Windows
```

- **Browser** (`run.sh`): every format (three SPSS compression modes, five Parquet codecs), errors, the 15 languages,
  large files, layouts, downloads, CSV-files mode, formatted view (HTML/script/image injection), prompt editing,
  team settings and locks, the settings page, mobile layout, relationships, the data profile, the format cards, and
  **zero network requests**. **"Do not share data"**: canary values placed in every format must never appear in the
  prompt, preview or page state, at every level and for every switch, plus one test per finding of an independent
  review. Also the privacy demo (`test_privacy_demo.cjs`): the tampered copy leaks only the file name, the blocked
  copy triggers a CSP violation, and the navigation copy shows what a policy cannot stop.
- **Firefox** (`test_firefox.cjs`, run by `run.sh` when Firefox is installed): every reader (including the WebAssembly
  SQLite one), the interface (dialogs, right-to-left, editing), "Do not share data" with its canaries, and zero requests.
- **On every push** (`.github/workflows/tests.yml`): browser and server tests on Linux, the PowerShell server on Windows,
  and a check that the committed `databrief.html` is exactly what `build.ps1` produces. The Docker and ESP32 suites run
  on version tags and on demand.
- **Servers** (`test_servers.sh`, `test_powershell.ps1`): settings priority, page settings, gzip, headers, health
  check, base path, 404, parallel requests, invalid values, interactive setup.
- **Docker** (`test_docker.sh`): both images (settings, non-root, health check, interactive setup saved to `/config`),
  the `arm64` images under emulation, Compose files, the Raspberry Pi script (ShellCheck, dry run on Ubuntu 26.04),
  that the demo pages are never published, and `nginx -t`, `httpd -t`, `caddy validate` on the configuration files.
  It removes every image it pulled.
- **ESP32** (`test_esp32.sh`): both header generators give back `databrief.html` exactly; the firmware compiles for
  three boards if PlatformIO is installed in `~/databrief-esp-testenv`
  (`python3 -m venv ~/databrief-esp-testenv/venv && ~/databrief-esp-testenv/venv/bin/pip install platformio`).

## License

DataBrief is free software, released under the [GNU General Public License v3.0 or later](LICENSE).
The embedded libraries keep their own licenses (Apache-2.0, MIT): see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Powered by [L'Arfo](https://github.com/Arfo-du-blo/DataBrief).
