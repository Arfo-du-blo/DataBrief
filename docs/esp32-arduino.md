# DataBrief on an ESP32 (and Arduino)

Turn a €5–10 microcontroller into a **pocket DataBrief server**. Plug it into any USB charger and it serves DataBrief
over Wi-Fi to every computer and phone around it. It can even **create its own Wi-Fi network**, so it works with no
router and no internet at all: the most offline version of DataBrief there is.

It's also a great lesson in **embedded constraints**: fitting a 2.3 MB web app into a chip with 520 KB of RAM.

**Contents**

1. [Which boards work (and why a classic Arduino can't)](#1-which-boards-work)
2. [How it works](#2-how-it-works)
3. [Prepare the page](#3-prepare-the-page)
4. [Choose your settings](#4-choose-your-settings)
5. [Path A: PlatformIO (VS Code)](#5-path-a-platformio-vs-code)
6. [Path B: Arduino IDE 2](#6-path-b-arduino-ide-2)
7. [Use it](#7-use-it)
8. [Security and limits](#8-security-and-limits)
9. [Troubleshooting](#9-troubleshooting)

[← Back to the README](../README.md) · [Learning path](learn.md) · Code: [`deploy/esp32/`](../deploy/esp32/)

---

## 1. Which boards work

**Minimum: an ESP32 with 4 MB of flash and Wi-Fi.** That's most ESP32 boards sold today. RAM isn't a problem: the
page is sent in small pieces straight from flash memory.

| Board | Works? | Why |
|---|---|---|
| **ESP32 DevKit / ESP32-WROOM-32** (4 MB) | ✅ Yes | The cheapest option. Uses about 2 MB of the 3 MB firmware space |
| **ESP32-S3 DevKitC** (8–16 MB) | ✅ Yes, recommended | More room, faster, native USB |
| **Arduino Nano ESP32** (ESP32-S3, 16 MB) | ✅ Yes | The official Arduino board that can do it, with the same sketch |
| Arduino Uno / Nano / Mega (classic) | ❌ No | See below |
| Arduino Uno R4 WiFi | ❌ No | Its main chip has 256 KB of flash; its small ESP32 only handles Wi-Fi for that chip |
| Arduino GIGA R1 WiFi | ⚠️ In theory | Enough memory, but a different platform and an expensive board; not covered here |
| ESP8266 | ❌ Not covered | Often only 1–4 MB of flash, slower; possible but cramped |

**Why a classic Arduino can't do it.** It's a good lesson in orders of magnitude:

| | Arduino Uno | Arduino Mega | ESP32 | DataBrief needs |
|---|---|---|---|---|
| Flash (storage) | 32 KB | 256 KB | 4–16 MB | **≈ 0.9 MB** (compressed page) |
| RAM | 2 KB | 8 KB | 520 KB | a few KB per connection |
| Wi-Fi | none | none | built in | required |

The compressed page alone is **28 times** the Uno's entire storage, and nearly 4 times the Mega's. Classic Arduinos
were designed to blink LEDs and read sensors, not to serve web apps. The ESP32 has 100 times more of everything,
plus Wi-Fi, for a similar price.

## 2. How it works

```
 databrief.html (2.3 MB) --gzip--> 0.9 MB --> databrief_html.h --compiled into--> firmware --> ESP32 flash
                                                                                                  |
 Browser <-- "Content-Encoding: gzip" + the 0.9 MB, sent as is <--- tiny web server on the ESP32 -+
 (decompresses it, then runs DataBrief: your files never go to the board)
```

- **Compression.** The page is compressed once on your computer (2.3 MB down to about 0.9 MB). The ESP32 never
  decompresses it: it sends the compressed bytes with the header `Content-Encoding: gzip`, and the browser
  decompresses them, as it does for most websites.
- **The page is part of the firmware.** `make_header` turns the compressed page into a C file
  (`databrief_html.h`) that is compiled into the program. So there's **a single upload**, with no file system to
  prepare and no extra plugin. The trade-off: changing the page means uploading again (about a minute).
- **Partition scheme.** An ESP32's flash is divided into *partitions*. The default gives the program 1.2 MB, which is
  too small, so on 4 MB boards we pick **"Huge APP"**: 3 MB for the program, no over-the-air updates. On 8–16 MB
  boards there's room either way.
- **Two network modes**, chosen at the top of the sketch: join your Wi-Fi, or create its own network.
- **Your data never reaches the board.** Like every other way of hosting DataBrief, the board only delivers the page.
  Files are read inside the browser ([check it yourself](verify-privacy.md)).

**Files** in [`deploy/esp32/`](../deploy/esp32/):

| File | Role |
|---|---|
| `DataBrief/DataBrief.ino` | The firmware: Wi-Fi, mDNS (`databrief.local`), web server. **One file for both toolchains** |
| `DataBrief/databrief_html.h` | The compressed page, **generated** (not in Git) |
| `make_header.ps1` / `make_header.py` | Generate `databrief_html.h` from a `databrief.html` (PowerShell or Python, same result) |
| `platformio.ini` | PlatformIO project: three boards ready |

## 3. Prepare the page

Generate `databrief_html.h` from the repository folder. Use one of:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\esp32\make_header.ps1          # Windows
```
```bash
python3 deploy/esp32/make_header.py                                          # macOS, Linux (or Windows: py)
```
```
Built deploy/esp32/DataBrief/databrief_html.h (page 2.27 MB -> 0.88 MB compressed)
```

- `build.ps1` also does this automatically, and **PlatformIO does it before each build**, so with Path A you can skip
  this step.
- **Your team's version:** make a `databrief.html` with your defaults using the
  [settings page](../README.md#team-defaults-settings-page), then pass it to the script:
  `make_header.ps1 -Html C:\path\to\databrief.html` or `make_header.py path/to/databrief.html`
  (PlatformIO: set the environment variable `DATABRIEF_HTML=/path/to/databrief.html`).
  The board serves **only the tool**; the settings page stays on your computer.

## 4. Choose your settings

Open `deploy/esp32/DataBrief/DataBrief.ino`. Everything you need is at the top:

```cpp
enum NetworkMode { JOIN_MY_WIFI, OWN_ACCESS_POINT };
const NetworkMode NETWORK_MODE = JOIN_MY_WIFI;

const char* WIFI_NAME     = "your-wifi-name";
const char* WIFI_PASSWORD = "your-wifi-password";
const unsigned long FALLBACK_TO_ACCESS_POINT_AFTER_MS = 30000;

const char* AP_NAME     = "DataBrief";
const char* AP_PASSWORD = "change-this-password";

const uint16_t PORT     = 80;
const char*    HOSTNAME = "databrief";
```

| Setting | Meaning |
|---|---|
| `NETWORK_MODE` | `JOIN_MY_WIFI`: the board joins your network (*station* mode). `OWN_ACCESS_POINT`: the board creates its own Wi-Fi network (*access point* mode) |
| `WIFI_NAME`, `WIFI_PASSWORD` | Your network (join mode). ESP32s use **2.4 GHz** Wi-Fi only |
| `FALLBACK_TO_ACCESS_POINT_AFTER_MS` | Join mode: if the board can't connect within this time, it creates its own network instead, so it's never unreachable. `0` = keep trying |
| `AP_NAME`, `AP_PASSWORD` | The network the board creates. **Change the password** (8 characters minimum) |
| `PORT` | `80` gives addresses without a port number. Any other value: `http://databrief.local:8080/` |
| `HOSTNAME` | The `.local` name: `databrief` gives `http://databrief.local` |

> ⚠️ Don't commit your real Wi-Fi password to a public repository. Edit your local copy only.

## 5. Path A: PlatformIO (VS Code)

[PlatformIO](https://platformio.org/) is a professional toolchain: it downloads the right compiler and libraries for
each board and generates the page automatically.

1. Install [VS Code](https://code.visualstudio.com/), then the **PlatformIO IDE** extension (Extensions panel,
   search "PlatformIO").
2. **File → Open Folder** → select `deploy/esp32` (the folder that contains `platformio.ini`).
3. Pick your board: click the environment name in the blue status bar (or the PlatformIO sidebar) and choose
   - `esp32dev`: classic ESP32 with 4 MB,
   - `esp32-s3`: ESP32-S3 with 8 MB or more,
   - `arduino_nano_esp32`: Arduino Nano ESP32.
4. Connect the board with a USB **data** cable.
5. Click **→ Upload** (status bar). The first build downloads the toolchain (a few hundred MB, once).
   Before compiling, PlatformIO runs `make_header.py`:
   ```
   Built .../DataBrief/databrief_html.h (page 2.27 MB -> 0.88 MB compressed)
   ...
   Flash: [======    ]  62.4% (used 1963032 bytes from 3145728 bytes)
   ```
6. Click **🔌 Serial Monitor** to see the board's address (next section).

The same from a terminal, with the `pio` command:

```bash
cd deploy/esp32
pio run -e esp32dev -t upload      # build + upload (replace esp32dev with your board)
pio device monitor                 # see the address; Ctrl+C to quit
```

## 6. Path B: Arduino IDE 2

1. Install the [Arduino IDE 2](https://www.arduino.cc/en/software).
2. **Add ESP32 support:**
   - **ESP32 / ESP32-S3 boards:** **File → Preferences → Additional boards manager URLs**, add
     `https://espressif.github.io/arduino-esp32/package_esp32_index.json`. Then **Tools → Board → Boards Manager**,
     search **esp32**, install **esp32 by Espressif Systems** (version 3.x).
   - **Arduino Nano ESP32:** in the Boards Manager, install **Arduino ESP32 Boards** (no URL needed).
3. **Generate the page**: run `make_header` as shown in [section 3](#3-prepare-the-page). The Arduino IDE doesn't do
   it for you.
4. **File → Open** → `deploy/esp32/DataBrief/DataBrief.ino`. Edit the settings ([section 4](#4-choose-your-settings)).
5. **Tools** menu:

   | | ESP32 (4 MB) | ESP32-S3 | Arduino Nano ESP32 |
   |---|---|---|---|
   | **Board** | ESP32 Dev Module | ESP32S3 Dev Module | Arduino Nano ESP32 |
   | **Partition Scheme** | **Huge APP (3MB No OTA/1MB SPIFFS)** | **Huge APP (3MB No OTA/1MB SPIFFS)** | default (With FAT partition) |
   | **Flash Size** | 4MB | your board's size | — |
   | **Port** | the board's port | the board's port | the board's port |

   Forgetting the partition scheme gives the error *"Sketch too big"*.
6. Click **→ Upload**. The first compilation takes a while: the page alone is 0.9 MB of data.
7. **Tools → Serial Monitor**, set to **115200 baud**, then press the board's **RST/EN** button to see the startup
   messages.

## 7. Use it

The Serial Monitor shows what the board is doing:

```
DataBrief on ESP32 - page 922657 bytes (gzip), SHA-256 of the page: 4cdc4737745d...
Joining "your-wifi-name"........ connected.
Open http://192.168.1.42/ or http://databrief.local/
Web server listening on port 80
```

**Join mode (`JOIN_MY_WIFI`).** On any device on the same network, open **<http://databrief.local>**.
If `.local` names don't work on a device (some Android phones, some company networks), use the IP address shown
instead. Tip: reserve that address for the board in your router's settings (*DHCP reservation*), so it never changes.

**Own network (`OWN_ACCESS_POINT`).** On your computer or phone, join the Wi-Fi network **DataBrief** with your
`AP_PASSWORD`, then open **<http://192.168.4.1>**. Your device may warn that this network has "no internet": that's
expected, so stay connected. This mode works anywhere: on a train, in a secure room, at a customer's site.

The first load takes **a few seconds** (0.9 MB over the ESP32's Wi-Fi). After that, the page runs entirely in the
browser, at full speed. The board isn't involved any more, even for huge files.

**Check what the board serves.** The `SHA-256 of the page` printed at startup is the fingerprint of the
`databrief.html` compiled into the firmware. Compare it with `SHA256SUMS.txt` from the release: identical means the
board serves the official page, byte for byte. See [Check it yourself](verify-privacy.md#6-spot-tampering-without-running-anything).

**Health check:** `http://databrief.local/healthz` answers `ok`. That's handy for monitoring tools.

## 8. Security and limits

- **HTTP only, local network only.** HTTPS on a microcontroller is slow and gives little benefit on a local network,
  because certificates for `.local` names aren't trusted by browsers anyway. Never expose the board directly to the
  internet (no port forwarding on your router). To reach it from outside, put a
  [Cloudflare Tunnel](../README.md#expose-it-outside-your-network-cloudflare-tunnel) on another machine on the
  same network, pointing to the board's IP address.
- **Access point mode:** anyone who knows the password can join the network. Use a strong `AP_PASSWORD`.
- **Your data never reaches the board.** It only delivers the page. The page's security policy forbids network
  connections, so files stay in the browser.
- **Updating the page** (new version, new team settings) = run `make_header` again and upload again.
- **One page, a few people at a time.** The little web server handles requests one after the other. That's fine
  for a team, since each person loads the page once, but it isn't for hundreds of simultaneous visitors.
- **What was tested:** the sketch compiles with PlatformIO and the Arduino-ESP32 core 3.3 for all three boards in
  `platformio.ini`, and the generated header decompresses to `databrief.html` exactly (automated in
  `tests/test_esp32.sh`). Flashing a real board, Wi-Fi and mDNS can't be tested automatically: that part is up to
  you, and feedback is welcome.

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| `databrief_html.h is missing` | Run `make_header` ([section 3](#3-prepare-the-page)) |
| *Sketch too big* / *text section exceeds available space* | Choose the **Huge APP** partition scheme (Arduino IDE), or use the right environment in PlatformIO |
| No port appears | Use a USB **data** cable (many are charge-only). Windows may need the USB driver for your board's chip (CP210x or CH340) |
| Upload fails, *"Failed to connect"* | Hold the **BOOT** button while the upload starts. Linux: add yourself to the `dialout` group (`sudo usermod -aG dialout $USER`, then log out and back in) |
| Stuck on `Joining...`, then creates its own network | Wrong Wi-Fi name or password, or a 5 GHz-only network: ESP32s need 2.4 GHz |
| `databrief.local` doesn't open | Use the IP address from the Serial Monitor; some devices don't support `.local` names |
| *Could not create the Wi-Fi network* | `AP_PASSWORD` must be at least 8 characters |
| Arduino Nano ESP32 won't upload | See Arduino's [Nano ESP32 documentation](https://docs.arduino.cc/hardware/nano-esp32/) for its bootloader mode |

[← Back to the README](../README.md) · [Learning path](learn.md)
