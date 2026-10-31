# Learn deployment with DataBrief

Most deployment tutorials use a "Hello world" that nobody will ever use. This one uses a **real tool**: DataBrief.
You'll take it from a file on your desktop all the way to a Kubernetes cluster, a Raspberry Pi and a microcontroller,
and you'll end up with something your team can actually use.

**Why DataBrief is a great teaching example**

- **It's one file with no backend.** No database, no build step, no secrets. Every deployment method works with it,
  so you can focus on the deployment itself.
- **It's realistic.** It has settings, a health check, HTTP headers, compression and a security policy: the things
  real apps need.
- **It's safe to experiment with.** The data never leaves the browser, so a misconfigured server can't leak anyone's
  files.

[← Back to the README](../README.md)

---

## The big picture

Every method in this tutorial answers the same question: **where does the page come from?** The work itself always
happens in the user's browser.

```
                ┌─────────── where the page comes from (this tutorial) ───────────┐
                │  your disk · GitHub/GitLab Pages · a server · Docker · a proxy  │
                │  Cloudflare · a Raspberry Pi · an ESP32 · Kubernetes            │
                └────────────────────────────────┬────────────────────────────────┘
                                                 │  databrief.html (once)
                                                 ▼
          your data file ──────────────►  the browser runs DataBrief  ──────────►  prompt for your AI
          (never leaves the browser)
```

Each level adds **one new idea**. You can stop at any level: each one gives you a working DataBrief.

## The levels at a glance

| Level | You deploy it… | You learn | Time | Cost | Guide |
|---|---|---|---|---|---|
| **0** | As a file | What a web page is; the browser as a runtime | 1 min | free | [→](../README.md#html-file-alone) |
| **1** | On GitHub or GitLab Pages | Git, CI/CD, static hosting, HTTPS, custom domains | 15 min | free | [GitHub](../README.md#your-own-github-pages) · [GitLab](../README.md#your-own-gitlab-pages) |
| **2** | With a server on your PC | Ports, `localhost` vs network, firewalls, HTTP headers, configuration | 10 min | free | [PowerShell](../README.md#powershell-server-windows) · [Python](../README.md#python-server) · [Node.js](../README.md#nodejs-server) |
| **3** | In a container | Images, containers, registries, environment variables, health checks, multi-architecture | 20 min | free | [Docker](../README.md#docker-nginx-image) · [Compose](../README.md#docker-compose) |
| **4** | Behind a reverse proxy | TLS certificates, Let's Encrypt, passwords, sub-paths | 30 min | a domain | [nginx](../README.md#nginx-https-passwords-reverse-proxy) · [Apache](../README.md#apache) · [Caddy](../README.md#caddy) · [IIS](../README.md#iis-windows-server) |
| **4b** | Through a Cloudflare Tunnel | Outbound tunnels, Zero Trust, identity-aware access | 30 min | a domain | [→](#level-4b-cloudflare-tunnel-and-zero-trust) |
| **5** | On a Raspberry Pi | Linux server basics: SSH, systemd, mDNS, firewall, ARM | 1 h | ~€60–100 | [→](raspberry-pi.md) |
| **6** | On an ESP32 microcontroller | Embedded constraints, flash vs RAM, compression, Wi-Fi modes, firmware | 1 h | ~€5–15 | [→](esp32-arduino.md) |
| **7** | On Kubernetes | Declarative deployment, ConfigMaps, probes, Services, Ingress | 1 h | free locally | [→](../README.md#kubernetes) |
| **★** | Check it yourself | Verifying a page's privacy: Network tab, CSP, fingerprints | 15 min | free | [→](verify-privacy.md) |

---

## Level 0: a single file

Download `databrief.html` and double-click it. It works offline: the browser *is* the runtime.

**What you learn:** a web page is just a file. HTML for the structure, CSS for the look, JavaScript for the
behaviour, all of it inside one file here. "Deploying" a static app simply means **putting that file somewhere
others can reach it**. Everything below is a different answer to "somewhere".

→ [Guide](../README.md#html-file-alone)

## Level 1: static hosting (GitHub Pages, GitLab Pages)

Push the repository to GitHub or GitLab, and a pipeline publishes the page with HTTPS at a public address.

**What you learn:**
- **Git** and **CI/CD**: a push triggers a pipeline (`.github/workflows/pages.yml`, `.gitlab-ci.yml`) that builds
  and publishes automatically.
- **Static hosting:** no server to manage; a CDN delivers your file worldwide.
- **HTTPS and custom domains:** DNS records, automatic certificates.
- **Private sites** (GitLab): access control by the platform, with nothing to code.
- **Releases and versions:** a tag (`v1.1.0`) creates a release with the files and their `SHA256SUMS.txt`.

→ [GitHub Pages](../README.md#your-own-github-pages) · [GitLab Pages](../README.md#your-own-gitlab-pages)

## Level 2: a server on your computer

Run `serve.ps1`, `serve.py` or `server.js`, and colleagues open `http://your-computer:8080`.

**What you learn:**
- **Ports and addresses:** `127.0.0.1` (only this computer) vs `0.0.0.0` (the whole network), and why the firewall
  asks.
- **HTTP in practice:** headers (`Content-Security-Policy`, `Cache-Control`), gzip compression, status codes,
  health checks (`/healthz`).
- **Configuration:** command-line options > environment variables > configuration file > defaults. That's the
  standard priority order in most server software.

→ [PowerShell](../README.md#powershell-server-windows) · [Python](../README.md#python-server) · [Node.js](../README.md#nodejs-server)

## Level 3: containers (Docker)

`docker run -p 8080:8080 ghcr.io/arfo-du-blo/databrief` runs the same thing anywhere.

**What you learn:**
- **Images vs containers:** a recipe (`Dockerfile`) produces an image; a container is a running image.
- **Configuration through environment variables** (`-e DATABRIEF_LANG=fr`), the standard for containers.
- **Registries** (GitHub/GitLab Container Registry), **tags** and **versions**.
- **Good practice:** non-root user, health checks, resource limits, restart policies (Compose).
- **Multi-architecture images:** the same name works on a PC (`amd64`) and a Raspberry Pi (`arm64`). The release
  pipelines build both with QEMU, and Docker picks the right one.

→ [Docker](../README.md#docker-nginx-image) · [Compose](../README.md#docker-compose)

## Level 4: a reverse proxy with HTTPS

Put nginx, Apache, Caddy or IIS in front of DataBrief.

**What you learn:**
- **Reverse proxies:** one front door that handles HTTPS, passwords and routing for many apps behind it.
- **TLS certificates:** Let's Encrypt with `certbot`, or Caddy's fully automatic HTTPS.
- **Access control:** basic authentication, IP allow-lists, Windows authentication (IIS).
- **Sub-paths:** serving DataBrief at `https://intranet.example.com/databrief/`.

→ [nginx](../README.md#nginx-https-passwords-reverse-proxy) · [Apache](../README.md#apache) · [Caddy](../README.md#caddy) · [IIS](../README.md#iis-windows-server)

## Level 4b: Cloudflare Tunnel and Zero Trust

Make a DataBrief that runs at home or in the office reachable from anywhere, **without opening a single port on your
router**, and only for the people you choose.

**The principle**

- **The tunnel:** a small program, `cloudflared`, runs next to DataBrief and opens an **outgoing** connection to
  Cloudflare. Visitors go to `https://databrief.yourdomain.com`, and Cloudflare passes their requests down the tunnel.
  Your network accepts no incoming connection at all: no port forwarding, no public IP address needed, and HTTPS is
  automatic.
- **Zero Trust:** traditional security trusts everyone *inside* the network. *Zero Trust* trusts no one by default:
  every request must prove who it comes from. With **Cloudflare Access** in front of the tunnel, visitors first sign
  in (a one-time code by e-mail, or your company's login), and only the people your policy allows ever see the page.

```
 visitor ──HTTPS──► Cloudflare ──(Access: who are you?)──► tunnel ◄──outgoing── cloudflared ──► DataBrief
                                                                                (your network: no open port)
```

**It fits DataBrief well:** files are processed in the browser, so **Cloudflare carries the page, never your data.**

**It works with every server option** in this tutorial (PowerShell, Python, Node.js, Docker, a Raspberry Pi). For an
ESP32, run `cloudflared` on another machine on the same network and point it to the board's address. It isn't needed
for GitHub or GitLab Pages, which are already hosted.

> ⚠️ **Be extra careful: you're putting a service on the internet.**
> - **Always put an Access policy in front.** Never publish a public tunnel without one.
> - Protect your Cloudflare account with **two-factor authentication**.
> - Keep `cloudflared` **up to date**.
> - **Turn off features that rewrite pages** for the DataBrief address (Rocket Loader, automatic minification,
>   injected analytics). They would modify the page, which DataBrief's security policy blocks.
> - **Read Cloudflare's documentation before you start**, and test with a non-sensitive setup first.

**Learn more (official documentation):**
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) ·
[Publish a self-hosted application with Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) ·
[Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/) ·
[Learning path: clientless access](https://developers.cloudflare.com/learning-paths/clientless-access/)

## Level 5: an always-on Raspberry Pi

A €60–100 computer that serves DataBrief to your home, classroom or team at `http://databrief.local`, 24/7, in
silence.

**What you learn:**
- **Linux server administration:** installing Ubuntu Server 26.04 LTS, SSH, packages, updates.
- **Services with systemd:** start at boot, restart on failure, run as an unprivileged user, least privilege
  (a single capability to use port 80).
- **Local names with mDNS** (`.local`) and a **firewall** with `ufw`.
- **ARM:** the same Docker image name, a different processor architecture.

One command does the whole setup, and the guide explains every step it takes.

→ [Raspberry Pi guide](raspberry-pi.md)

## Level 6: an ESP32 microcontroller

A €5–15 chip with no operating system serves the whole app. It can even create its own Wi-Fi network: DataBrief in
your pocket, no router or internet needed.

**What you learn:**
- **Embedded constraints:** 4 MB of flash and 520 KB of RAM for a 2.3 MB app, and why a classic Arduino (32 KB)
  can't do it.
- **Compression:** gzip once on the PC, decompression in the browser (`Content-Encoding: gzip`).
- **Firmware and partitions:** the page is compiled into the program, and the flash layout is chosen to fit it.
- **Wi-Fi modes:** joining a network (station) vs creating one (access point).
- **Two professional toolchains:** PlatformIO and the Arduino IDE, with the same code.

→ [ESP32 / Arduino guide](esp32-arduino.md)

## Level 7: Kubernetes

Deploy DataBrief the way large organisations run their services.

**What you learn:**
- **Declarative deployment:** describe the desired state in YAML (`kubectl apply -f`), and Kubernetes makes it
  happen and keeps it that way.
- **ConfigMaps** for settings, **liveness and readiness probes** on `/healthz`, **resource limits**, non-root
  security contexts.
- **Services and Ingress:** how traffic finds your pods.
- **Try it locally for free** with Docker Desktop's Kubernetes, kind, minikube or k3s (which also runs on a
  Raspberry Pi).

→ [Kubernetes](../README.md#kubernetes)

## ★ Check it yourself

Whichever level you stopped at, finish with this one. You'll use the browser's developer tools to prove that DataBrief
sends nothing, then catch a **deliberately tampered copy** in the act of leaking a file name, and see how a SHA-256
fingerprint exposes it.

**What you learn:** the Network and Console tabs, Content Security Policy, fingerprints (SHA-256), and the habit of
**checking before you trust**, for any website.

→ [Check it yourself](verify-privacy.md)

---

## Where to go next

- **Combine levels:** a Raspberry Pi (5) running Docker (3) behind Caddy (4), reached through a Cloudflare Tunnel (4b).
- **Automate:** add your own pipeline steps, for example a test that fetches `/healthz` after each deployment.
- **Share your setup:** improvements and feedback from real deployments are welcome on
  [GitHub](https://github.com/Arfo-du-blo/DataBrief).

[← Back to the README](../README.md)
