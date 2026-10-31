# DataBrief on an ESP32 / Arduino Nano ESP32

Firmware that serves DataBrief from an ESP32 over Wi-Fi: it joins your network (`http://databrief.local`), or creates
its own.

**→ Step-by-step guide: [docs/esp32-arduino.md](../../docs/esp32-arduino.md)**

| File | Role |
|---|---|
| `DataBrief/DataBrief.ino` | The firmware (settings at the top). Open it in the Arduino IDE 2 |
| `platformio.ini` | The same firmware as a PlatformIO project (`esp32dev`, `esp32-s3`, `arduino_nano_esp32`) |
| `make_header.ps1`, `make_header.py` | Compress `databrief.html` into `DataBrief/databrief_html.h` (generated, not in Git) |

```bash
python3 make_header.py && pio run -e esp32dev -t upload && pio device monitor
```
