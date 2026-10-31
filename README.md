# DataBrief

**Turn any data file into an AI-ready prompt.**

DataBrief is a single, self-contained HTML page. Drop a data file on it, and it produces a Markdown (`.md`) file you can
paste into, or upload to, any AI assistant (Claude, ChatGPT, Gemini, Mistral, local LLMs…). The file contains:

1. **An introduction prompt** telling the AI that this is a file shared by the user, what it contains (sections,
   columns, metadata), and how to behave.
2. **All of the data**, formatted for the AI to read reliably (or, if you prefer, a short sample plus separate CSV files).

**Try it now:** <https://arfo-du-blo.github.io/DataBrief/>

**100% offline and private:** everything happens in your browser. Your data never leaves your computer, even when the
page is hosted on a server: the page itself forbids every network connection.

---

## Contents

- [Choose how to use DataBrief](#choose-how-to-use-databrief)
- [Guides](#guides), one per way of using it
- [Settings](#settings): every setting, for every method
- [Features](#features) · [Supported formats](#supported-formats) · [The generated prompt](#the-generated-prompt) · [Token estimate](#about-the-token-estimate) · [Privacy](#privacy-and-security) · [Limits](#limits)
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

**What is the difference?** The page always does all the work in the user's browser. The methods only change *where the
page comes from* and *which defaults it has* (language, mode, locked settings, your team's instructions…). See
[Settings](#settings).

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

On a version tag (`git tag v1.1.0 && git push origin v1.1.0`), the same file also creates a GitLab release with both
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

- Tags: `latest` and `nginx` (same image), and one per version (`v1.0.0`, `v1.0.0-nginx`).
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
| `DATABRIEF_SAMPLE_ROWS` | `--sample-rows` | `-SampleRows` | `5` | Sample rows per section in CSV-files mode (1–100) |
| `DATABRIEF_WARN_TOKENS` | `--warn-tokens` | `-WarnTokens` | `150000` | Large-file warning threshold |
| `DATABRIEF_LOCK` | `--lock` | `-Lock` | *(none)* | Comma-separated: `lang`, `promptLang`, `mode`, `layout`, `theme` (value fixed, control hidden); `limit`, `edit`, `view` (row-limit control / Edit / View formatted hidden) |
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
- **Format notes** in the prompt ("How this file is formatted": sections, CSV rules, empty cells, flattened columns,
  truncation) so the AI reads the data correctly.
- **15 languages** for the page and the prompt: English, French, Spanish, German, Italian, Portuguese, Dutch, Polish,
  Russian, Turkish, Chinese, Japanese, Korean, Hindi, Arabic (right-to-left). The prompt follows the page language
  by default and has its own selector.
- **Light and dark** themes, mobile-friendly.

## Supported formats

| Category | Formats |
|---|---|
| Delimited text | CSV, TSV, TXT (delimiter auto-detected: `,` `;` tab `\|`) |
| Spreadsheets | XLSX, XLSM, XLS, ODS (**all sheets**) |
| Structured | JSON, NDJSON / JSONL, XML, YAML (nested data is flattened, e.g. `address.city`) |
| Web | HTML (**every** `<table>` on the page) |
| Statistics | SPSS `.sav` and `.zsav` |
| Data engineering | Parquet |
| Databases | SQLite (`.db`, `.sqlite`, `.sqlite3`; **all tables**) |

When a file holds several sheets or tables, each one becomes its own section, and the AI is told that they are separate.

**Metadata** added to the prompt when the format provides it:
- **SPSS:** variable labels, value labels (`1 = Male`, shown as words in the data), type and format, measurement level,
  missing values, file label, notes.
- **SQLite:** column types, primary and foreign keys, NOT NULL constraints, views.
- **Parquet:** schema types and embedded metadata.
- **Excel / ODS:** sheet names, hidden sheets, cell comments, detected column types.
- **JSON / XML / YAML:** the original path of each flattened field; XML attributes.
- **CSV / TSV / HTML:** the detected type of each column; table captions for HTML.

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
- A Content-Security-Policy inside the page blocks every network connection (`connect-src 'none'`, no external
  scripts, styles, fonts, images or frames). Even a faulty library could not send data out.
- The servers in this repository only send the page; they never receive the data. They add `frame-ancestors`,
  `X-Content-Type-Options` and `Referrer-Policy` headers.
- In **View formatted**, HTML found in the data is shown as text, never executed, and images are never loaded.

## Limits

- Encrypted or password-protected files (Excel, SQLite) cannot be read: save a copy without the password first.
- Parquet: Snappy, Gzip, Zstd and LZ4 (raw) compression are supported; Brotli and Hadoop-LZ4 are not.
- Everything happens in the browser's memory: files of a few hundred MB may be slow, depending on the computer.
- The settings page and the interactive setups are in English (the tool itself has 15 languages).
- Tested automatically: the page (Chrome), the Python, Node.js and PowerShell servers, both Docker images, and the
  nginx, Apache and Caddy files (syntax). Checked for syntax only: IIS `web.config`, Kubernetes manifest, systemd units, `.gitlab-ci.yml`,
  GitHub workflows. SharePoint and Teams depend on your tenant's policies.

---

## For developers

### Project structure

```
databrief.html                the tool (built, self-contained)
databrief_set_default.html    the team settings page (built, contains a compressed copy of databrief.html)
build.ps1                     builds both HTML files from src/ and vendor/
src/
  template.html               page markup and build directives
  setdefault.html/.css/.js    the settings page
  styles.css                  light/dark theme
  i18n.js, i18n-modes.js      15 languages (interface + prompt)
  config.js                   settings: config block, URL parameters, locks
  util.js                     type detection, flattening, CSV parsing, token estimate
  parsers.js                  format detection and readers (CSV…SQLite)
  spss.js                     SPSS .sav / .zsav reader (original code)
  markdown.js                 builds the prompt (locked parts and editable regions)
  app.js                      page logic
deploy/
  databrief.conf              shared configuration file (every setting commented)
  python/serve.py             Python server (--setup)
  node/server.js              Node.js server (--setup)
  powershell/serve.ps1        PowerShell server (-Setup)
  docker/                     Dockerfile (nginx), Dockerfile.python, 40-databrief.sh, docker-compose.yml
  nginx/ apache/ iis/ caddy/ systemd/ kubernetes/
.github/workflows/            pages.yml (GitHub Pages), release.yml (release + Docker images)
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
git tag v1.0.0 && git push origin v1.0.0
```

`.github/workflows/release.yml` creates the GitHub release (with both HTML files) and publishes the Docker images to
`ghcr.io/<owner>/databrief`. After the first release, make the package public: **your GitHub profile → Packages →
databrief → Package settings → Change visibility → Public**.

On GitLab, the same tag runs `.gitlab-ci.yml`: GitLab release, HTML files in the Package Registry, Docker images in
the Container Registry ([guide](#your-own-gitlab-pages)).

Versions follow [semantic versioning](https://semver.org/): `vMAJOR.MINOR.PATCH`. New features or deployment options
→ minor (`v1.1.0`); fixes only → patch (`v1.0.1`); changes that break existing settings or URLs → major (`v2.0.0`).

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
  team settings and locks, the settings page, mobile layout, and **zero network requests**.
- **Servers** (`test_servers.sh`, `test_powershell.ps1`): settings priority, page settings, gzip, headers, health
  check, base path, 404, parallel requests, invalid values, interactive setup.
- **Docker** (`test_docker.sh`): both images (settings, non-root, health check, interactive setup saved to `/config`),
  Compose, and `nginx -t`, `httpd -t`, `caddy validate` on the configuration files. It removes every image it pulled.

## License

DataBrief is free software, released under the [GNU General Public License v3.0 or later](LICENSE).
The embedded libraries keep their own licenses (Apache-2.0, MIT): see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Powered by [L'Arfo](https://github.com/Arfo-du-blo/DataBrief).
