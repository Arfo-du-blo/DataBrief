# DataBrief on a Raspberry Pi (Ubuntu Server 26.04 LTS)

A Raspberry Pi makes a perfect **always-on DataBrief server** for a home, a classroom or a small team. It's silent,
uses about as much power as a phone charger, and serves DataBrief to everyone at **<http://databrief.local>**.

Along the way you'll learn the basics of running a real Linux server: SSH, packages, services that start at boot,
local network names, and a firewall.

**Contents**

1. [What you need](#1-what-you-need)
2. [Install Ubuntu Server](#2-install-ubuntu-server)
3. [Connect over SSH](#3-connect-over-ssh)
4. [Get DataBrief](#4-get-databrief)
5. [Option A: Python server + systemd (recommended)](#5-option-a-python-server--systemd-recommended)
6. [Option B: Docker](#6-option-b-docker)
7. [Use it](#7-use-it)
8. [Your team's settings](#8-your-teams-settings)
9. [Optional: HTTPS with Caddy](#9-optional-https-with-caddy)
10. [Maintenance](#10-maintenance)
11. [Troubleshooting](#11-troubleshooting)

[← Back to the README](../README.md) · [Learning path](learn.md) · Code: [`deploy/raspberry-pi/`](../deploy/raspberry-pi/)

---

## 1. What you need

- **A Raspberry Pi 4 or 5** with at least 2 GB of RAM. DataBrief itself needs very little; the RAM is for Ubuntu.
  For other models, check that Ubuntu Server 26.04 supports them.
- A **microSD card** of 16 GB or more (or an SSD), and the **official power supply**.
- A network connection: Ethernet cable (most reliable) or Wi-Fi.
- A computer to prepare the card and to connect to the Pi. No screen or keyboard on the Pi is needed.

**Why Ubuntu Server 26.04 LTS?** *LTS* means *Long Term Support*: five years of free security updates (until 2031).
"Server" means no desktop, which is lighter and faster, and exactly what an appliance needs. It's 64-bit, and the
DataBrief Docker images exist for 64-bit ARM.

## 2. Install Ubuntu Server

1. On your computer, install **[Raspberry Pi Imager](https://www.raspberrypi.com/software/)** and insert the microSD card.
2. **Choose Device:** your Pi model.
3. **Choose OS:** *Other general-purpose OS → Ubuntu → **Ubuntu Server 26.04 LTS (64-bit)***.
4. **Choose Storage:** your microSD card.
5. When Imager offers **OS customisation**, fill in:
   - **Hostname:** `databrief` (this gives the address `databrief.local`)
   - **Username and password:** your choice (you'll use them to connect)
   - **Wi-Fi:** your network name, password and country, unless you use Ethernet
   - **Services → Enable SSH:** on. Use a password, or better, your public key.
6. Write the card, put it in the Pi, connect the network and power it on.

The first boot takes **a few minutes**: Ubuntu sets itself up (users, Wi-Fi, SSH keys) with a tool called
*cloud-init*. Be patient before connecting.

## 3. Connect over SSH

*SSH* gives you a terminal on the Pi from your own computer. It's built into Windows 10+, macOS and Linux.

```bash
ssh your-username@databrief.local
```

- The first time, type `yes` to trust the Pi's key.
- If `databrief.local` isn't found yet, use the Pi's IP address instead (shown in your router's list of devices).

Then bring the system up to date (do this first on any new server):

```bash
sudo apt update && sudo apt full-upgrade -y
sudo reboot            # then reconnect with ssh after a minute
```

## 4. Get DataBrief

On the Pi:

```bash
git clone https://github.com/Arfo-du-blo/DataBrief.git
cd DataBrief
```

(No Git? `sudo apt install -y git`.) The repository contains everything: the page, the server, and the setup script.

## 5. Option A: Python server + systemd (recommended)

**The lightest option: nothing to install**, since Ubuntu already includes Python. One command does it all:

```bash
sudo bash deploy/raspberry-pi/setup.sh
```

```
==> Packages: avahi (makes databrief.local work) and ufw (firewall)
==> Host name: databrief
==> DataBrief: Python server as a systemd service
==> Firewall: allow SSH, DataBrief (port 80) and mDNS; block everything else
==> Done
Open  http://databrief.local/   (or http://192.168.1.50/)
Logs: journalctl -u databrief-python -f
```

Options: `--hostname NAME`, `--port N` (default 80), `--html FILE` (your team's page), `--no-firewall`, and
`--dry-run` to see every command without running anything. You can run it again safely, for example to change the
port.

### What the script does, step by step

Reading [`setup.sh`](../deploy/raspberry-pi/setup.sh) is a good way to learn. Here is what it does, with the
equivalent manual commands:

**1. Installs two packages.**
```bash
sudo apt install -y avahi-daemon ufw
```
- **avahi** implements *mDNS*: it announces the Pi's name on the local network, so `databrief.local` works without
  any DNS server. Windows 10+, macOS, iOS and most Linux systems understand `.local` names.
- **ufw** (*Uncomplicated Firewall*) is a simple front-end to Linux's firewall.

**2. Sets the host name** (in case you didn't in Imager) and makes it stick:
```bash
sudo hostnamectl set-hostname databrief
echo 'preserve_hostname: true' | sudo tee /etc/cloud/cloud.cfg.d/99-databrief-hostname.cfg
```
The second line stops cloud-init from putting the old name back at the next reboot.

**3. Installs DataBrief as a service.** It creates a dedicated system user with no login and no home folder, so the
server can't touch anything else, and copies the files:
```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin databrief
sudo install -d /opt/databrief /etc/databrief
sudo install -m 644 databrief.html deploy/python/serve.py /opt/databrief/
sudo install -m 644 deploy/databrief.conf /etc/databrief/databrief.conf      # the settings, with DATABRIEF_PORT=80
sudo install -m 644 deploy/systemd/databrief-python.service /etc/systemd/system/
```
**systemd** is the program that starts and supervises services on Linux. The
[unit file](../deploy/systemd/databrief-python.service) tells it how to run DataBrief: as the `databrief` user, started
at boot, restarted if it stops, with strong restrictions (read-only system, no access to home folders…).

Port 80 normally requires root. Instead of running as root, a small
[drop-in file](../deploy/raspberry-pi/low-port.conf) gives the service **only** the permission to use low ports:
```ini
[Service]
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
```
```bash
sudo systemctl daemon-reload                 # re-read the unit files
sudo systemctl enable databrief-python       # start at every boot
sudo systemctl restart databrief-python      # start now
```

**4. Closes everything except what's needed:**
```bash
sudo ufw allow OpenSSH        # first! otherwise you could lock yourself out
sudo ufw allow 80/tcp         # DataBrief
sudo ufw allow 5353/udp       # mDNS (databrief.local)
sudo ufw --force enable
```

## 6. Option B: Docker

If you already use Docker, or want to practise with it:

```bash
sudo bash deploy/raspberry-pi/setup.sh --docker
```

It installs Docker from Ubuntu's packages, then starts DataBrief with
[`deploy/raspberry-pi/docker-compose.yml`](../deploy/raspberry-pi/docker-compose.yml), copied to `/opt/databrief/`.
The container restarts automatically, including after a reboot (`restart: unless-stopped`).

**Multi-architecture images.** The image `ghcr.io/arfo-du-blo/databrief` is published for both PCs (`amd64`) and ARM
boards (`arm64`). The Pi pulls the ARM version automatically, under the same name. You can check:
```bash
docker image inspect ghcr.io/arfo-du-blo/databrief:latest --format '{{.Architecture}}'    # arm64
```

Settings are `DATABRIEF_*` variables in `/opt/databrief/docker-compose.yml`
(every one is explained in the [README](../README.md#settings)). After editing:
```bash
sudo docker compose -f /opt/databrief/docker-compose.yml up -d
```

## 7. Use it

On any computer or phone on the same network, open **<http://databrief.local>**. That's it!

- If `.local` doesn't work on a device (some Android phones, some company networks), use the IP address printed by
  the script. Tip: reserve that address for the Pi in your router (*DHCP reservation*), so it never changes.
- Your data never goes to the Pi: it only delivers the page. You can
  [check it yourself](verify-privacy.md) in the browser's Network tab.

## 8. Your team's settings

**Option A (Python):** two ways.

- **Edit the settings file** on the Pi, then restart:
  ```bash
  sudo nano /etc/databrief/databrief.conf       # e.g. DATABRIEF_LANG=fr, DATABRIEF_LOCK=lang,mode
  sudo systemctl restart databrief-python
  ```
- **Or use a page made with the settings page.** On your computer, make it with `databrief_set_default.html`, copy it
  to the Pi, then run the setup with it:
  ```bash
  scp databrief.html your-username@databrief.local:~/team-databrief.html     # from your computer
  sudo bash deploy/raspberry-pi/setup.sh --html ~/team-databrief.html        # on the Pi
  ```

**Option B (Docker):** edit the `DATABRIEF_*` variables in `/opt/databrief/docker-compose.yml`, then `up -d` again.

## 9. Optional: HTTPS with Caddy

On a home or office network, plain HTTP to the Pi is usually fine: the data never travels anyway, only the page does.
If your organisation requires HTTPS, [Caddy](https://caddyserver.com/) is the simplest way:

```bash
sudo bash deploy/raspberry-pi/setup.sh --port 8080     # DataBrief moves to port 8080, behind Caddy
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
databrief.local {
	tls internal
	reverse_proxy 127.0.0.1:8080
}
EOF
sudo systemctl reload caddy
sudo ufw allow 80,443/tcp && sudo ufw delete allow 8080/tcp
```

Open **<https://databrief.local>**.

- **`tls internal`:** public certificate authorities don't issue certificates for `.local` names, so Caddy creates its
  own small certificate authority. Browsers will warn until you install Caddy's root certificate on each device
  (`/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`), which is typical for internal networks.
- **With a real domain name** (e.g. `databrief.example.com`), replace `databrief.local` and remove `tls internal`.
  Caddy then gets a free, trusted certificate automatically, but the Pi must be reachable from the internet for
  that. A [Cloudflare Tunnel](../README.md#expose-it-outside-your-network-cloudflare-tunnel) is a safer way to do
  it: no open port, HTTPS included.

## 10. Maintenance

| Task | Option A (Python) | Option B (Docker) |
|---|---|---|
| Status | `systemctl status databrief-python` | `sudo docker ps` |
| Logs | `journalctl -u databrief-python -f` | `sudo docker compose -f /opt/databrief/docker-compose.yml logs -f` |
| Restart | `sudo systemctl restart databrief-python` | `sudo docker compose -f /opt/databrief/docker-compose.yml restart` |
| Update DataBrief | `cd ~/DataBrief && git pull && sudo bash deploy/raspberry-pi/setup.sh` | `sudo docker compose -f /opt/databrief/docker-compose.yml pull && sudo docker compose -f /opt/databrief/docker-compose.yml up -d` |
| Uninstall | `sudo systemctl disable --now databrief-python && sudo rm -r /etc/systemd/system/databrief-python.service* /opt/databrief /etc/databrief && sudo userdel databrief` | `sudo docker compose -f /opt/databrief/docker-compose.yml down && sudo rm -r /opt/databrief` |

**Security updates:** Ubuntu Server installs security updates automatically (*unattended-upgrades*). Still run
`sudo apt update && sudo apt full-upgrade` now and then, and reboot when asked.

## 11. Troubleshooting

| Problem | Fix |
|---|---|
| `ssh: Could not resolve hostname databrief.local` | Wait a few minutes after the first boot; or use the Pi's IP address from your router |
| `databrief.local` works on some devices only | Some Android versions and some networks don't support mDNS: use the IP address |
| The page doesn't open, but SSH works | `systemctl status databrief-python` and `journalctl -u databrief-python -n 50`; check `sudo ufw status` lists your port |
| *Address already in use* in the logs | Another program uses the port (e.g. a web server): `sudo ss -ltnp \| grep :80`, or choose `--port 8080` |
| Locked out after enabling the firewall | Connect a screen and keyboard, then `sudo ufw allow OpenSSH` (the script always allows SSH first) |
| Host name back to `ubuntu` after a reboot | Run the setup again; it sets `preserve_hostname: true` for cloud-init |

**What was tested:** `setup.sh` (Option A) was run for real on Ubuntu Server 26.04 with systemd, in a container;
both options are checked with ShellCheck and a dry run. The ARM64 Docker images are built and started under emulation by the
automated tests. A physical Raspberry Pi wasn't available, so feedback from real boards is welcome.

[← Back to the README](../README.md) · [Learning path](learn.md)
