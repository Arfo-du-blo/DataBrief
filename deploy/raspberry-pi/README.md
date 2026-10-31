# DataBrief on a Raspberry Pi (Ubuntu Server 26.04 LTS)

**→ Step-by-step guide: [docs/raspberry-pi.md](../../docs/raspberry-pi.md)**

| File | Role |
|---|---|
| `setup.sh` | One-command setup: Python server + systemd (default) or `--docker`, `databrief.local`, firewall. `--help` for options, `--dry-run` to preview |
| `low-port.conf` | systemd drop-in that lets the service use port 80 without running as root |
| `docker-compose.yml` | Minimal Compose file for `--docker` (multi-architecture image) |

```bash
sudo bash deploy/raspberry-pi/setup.sh
```
