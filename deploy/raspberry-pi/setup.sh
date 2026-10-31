#!/usr/bin/env bash
# DataBrief on a Raspberry Pi (Ubuntu Server 26.04 LTS, 64-bit) - one-command setup.
# Step-by-step guide: docs/raspberry-pi.md
#
# Run it on the Pi, from a copy of this repository:
#   sudo bash deploy/raspberry-pi/setup.sh                 Python server + systemd (recommended: nothing to install)
#   sudo bash deploy/raspberry-pi/setup.sh --docker        Docker + Compose instead
#   options: --hostname NAME   address http://NAME.local (default: databrief)
#            --port N          port (default: 80, so the address needs no port)
#            --html FILE       your own databrief.html (e.g. a team version from databrief_set_default.html)
#            --no-firewall     do not configure ufw
#            --dry-run         print the commands without running them
#
# What it does: installs avahi (for NAME.local) and ufw, sets the host name, installs DataBrief as a service
# that starts at boot, opens only SSH and the DataBrief port in the firewall, and prints the address.
# GPL-3.0-or-later - https://github.com/Arfo-du-blo/DataBrief
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE=python HOST_NAME=databrief PORT=80 HTML="$ROOT/databrief.html" FIREWALL=1 DRY=0

usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
while [ $# -gt 0 ]; do
  case "$1" in
    --docker) MODE=docker ;;
    --python) MODE=python ;;
    --hostname) HOST_NAME="${2:?--hostname needs a value}"; shift ;;
    --port) PORT="${2:?--port needs a value}"; shift ;;
    --html) HTML="${2:?--html needs a file}"; shift ;;
    --no-firewall) FIREWALL=0 ;;
    --dry-run) DRY=1 ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown option: $1" >&2; usage 1 ;;
  esac
  shift
done

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
run()  { if [ "$DRY" = 1 ]; then printf '    %s\n' "$*"; else "$@"; fi; }
fail() { echo "Error: $*" >&2; exit 1; }

[[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || fail "invalid port: $PORT"
[[ "$HOST_NAME" =~ ^[a-zA-Z0-9-]{1,63}$ ]] || fail "invalid host name: $HOST_NAME (letters, digits and - only)"
[ -f "$HTML" ] || fail "$HTML not found"
[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ] || fail "run it with sudo: sudo bash $0 $*"
# shellcheck disable=SC1091
OS="$( (. /etc/os-release 2>/dev/null && echo "${ID:-}|${PRETTY_NAME:-}") || true)"   # subshell: keeps our variables
[ "${OS%%|*}" = ubuntu ] || echo "Note: written for Ubuntu Server; found ${OS#*|}. Continuing."
echo "DataBrief setup: mode=$MODE, address=http://$HOST_NAME.local$([ "$PORT" = 80 ] || echo ":$PORT")/, architecture=$(uname -m)"

step "Packages: avahi (makes $HOST_NAME.local work) and ufw (firewall)"
PKGS="avahi-daemon ufw"
[ "$MODE" = python ] && PKGS="$PKGS python3"
[ "$MODE" = docker ] && PKGS="$PKGS docker.io docker-compose-v2"
run apt-get update
# shellcheck disable=SC2086
run env DEBIAN_FRONTEND=noninteractive apt-get install -y $PKGS

step "Host name: $HOST_NAME"
if run hostnamectl set-hostname "$HOST_NAME"; then
  if grep -q '^127\.0\.1\.1' /etc/hosts; then
    run sed -i "s/^127\.0\.1\.1.*/127.0.1.1 $HOST_NAME/" /etc/hosts
  else
    run sh -c "echo '127.0.1.1 $HOST_NAME' >> /etc/hosts"
  fi
  # Ubuntu Server images for the Pi use cloud-init, which would put the old name back at the next reboot.
  if [ -d /etc/cloud/cloud.cfg.d ]; then
    run sh -c "echo 'preserve_hostname: true' > /etc/cloud/cloud.cfg.d/99-databrief-hostname.cfg"
  fi
else
  echo "    Warning: could not set the host name. Use the Pi's IP address, or set the name in Raspberry Pi Imager."
fi
run systemctl enable --now avahi-daemon
run systemctl restart avahi-daemon

if [ "$MODE" = python ]; then
  step "DataBrief: Python server as a systemd service"
  id databrief >/dev/null 2>&1 || run useradd --system --no-create-home --shell /usr/sbin/nologin databrief
  run install -d -m 755 /opt/databrief /etc/databrief
  run install -m 644 "$HTML" /opt/databrief/databrief.html
  run install -m 644 "$ROOT/deploy/python/serve.py" /opt/databrief/serve.py
  if [ -f /etc/databrief/databrief.conf ]; then
    echo "    keeping your existing /etc/databrief/databrief.conf (port set to $PORT)"
  else
    run install -m 644 "$ROOT/deploy/databrief.conf" /etc/databrief/databrief.conf
  fi
  run sed -i "s/^DATABRIEF_PORT=.*/DATABRIEF_PORT=$PORT/" /etc/databrief/databrief.conf
  run install -m 644 "$ROOT/deploy/systemd/databrief-python.service" /etc/systemd/system/databrief-python.service
  # Pi-specific addition: allow the service (which does not run as root) to use a port below 1024, such as 80.
  run install -d /etc/systemd/system/databrief-python.service.d
  run install -m 644 "$ROOT/deploy/raspberry-pi/low-port.conf" /etc/systemd/system/databrief-python.service.d/low-port.conf
  run systemctl daemon-reload
  run systemctl enable databrief-python
  run systemctl restart databrief-python
  LOGS="journalctl -u databrief-python -f"
else
  step "DataBrief: Docker container (restarts automatically, also after a reboot)"
  run install -d -m 755 /opt/databrief
  run install -m 644 "$ROOT/deploy/raspberry-pi/docker-compose.yml" /opt/databrief/docker-compose.yml
  run systemctl enable --now docker
  run env DATABRIEF_PUBLIC_PORT="$PORT" docker compose -f /opt/databrief/docker-compose.yml up -d
  [ "$HTML" = "$ROOT/databrief.html" ] || echo "    Note: with Docker, settings come from DATABRIEF_* variables in /opt/databrief/docker-compose.yml; --html is ignored."
  LOGS="docker compose -f /opt/databrief/docker-compose.yml logs -f"
fi

if [ "$FIREWALL" = 1 ]; then
  step "Firewall: allow SSH, DataBrief (port $PORT) and mDNS; block everything else"
  # Keep SSH open first, so the firewall never locks you out of the Pi.
  if ufw app info OpenSSH >/dev/null 2>&1; then run ufw allow OpenSSH; else run ufw allow 22/tcp; fi
  run ufw allow "$PORT/tcp"
  run ufw allow 5353/udp
  run ufw --force enable
fi

step "Done"
SUFFIX="$([ "$PORT" = 80 ] || echo ":$PORT")"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "Open  http://$HOST_NAME.local$SUFFIX/   (or http://${IP:-<the Pi IP address>}$SUFFIX/)"
echo "Logs: $LOGS"
