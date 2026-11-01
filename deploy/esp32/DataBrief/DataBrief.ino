/*
  DataBrief on an ESP32: a tiny web server that serves the DataBrief page from the board itself.
  Step-by-step guide: docs/esp32-arduino.md

  - Works with the Arduino IDE 2 (open this file) and with PlatformIO (deploy/esp32/platformio.ini).
  - Boards: any ESP32 with 4 MB of flash or more (ESP32, ESP32-S3, Arduino Nano ESP32...).
  - The page is stored gzip-compressed inside the firmware (databrief_html.h, about 1 MB) and sent as is:
    the browser decompresses it. Needs a "Huge APP" partition scheme on 4 MB boards (see the guide).
  - The board only sends the page. The data files people open never reach it: DataBrief works entirely
    in the browser.

  Make databrief_html.h first:  powershell -File deploy\esp32\make_header.ps1   or   python3 deploy/esp32/make_header.py
  (PlatformIO does it automatically.)

  DataBrief - GPL-3.0-or-later - https://github.com/Arfo-du-blo/DataBrief
*/
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>

#if __has_include("databrief_html.h")
#include "databrief_html.h"
#else
#error "databrief_html.h is missing: run deploy/esp32/make_header.ps1 (or make_header.py) first. See docs/esp32-arduino.md"
#endif

// ================================ SETTINGS: edit this part ================================

// How the board connects:
//   JOIN_MY_WIFI      joins your Wi-Fi network: open http://databrief.local (or the IP shown in the Serial Monitor)
//   OWN_ACCESS_POINT  creates its own Wi-Fi network: no router, no internet. Join it, then open http://192.168.4.1
enum NetworkMode { JOIN_MY_WIFI, OWN_ACCESS_POINT };
const NetworkMode NETWORK_MODE = JOIN_MY_WIFI;

// JOIN_MY_WIFI: your network. Do not commit real passwords to a public repository.
const char* WIFI_NAME     = "your-wifi-name";
const char* WIFI_PASSWORD = "your-wifi-password";
// If the board cannot join your network within this time, it creates its own network instead (0 = never).
const unsigned long FALLBACK_TO_ACCESS_POINT_AFTER_MS = 30000;

// OWN_ACCESS_POINT: the network the board creates. The password needs 8 characters or more.
const char* AP_NAME     = "DataBrief";
const char* AP_PASSWORD = "change-this-password";

const uint16_t PORT     = 80;           // 80 = no port in the address
const char*    HOSTNAME = "databrief";  // -> http://databrief.local (mDNS, on your network)

// ==========================================================================================

WebServer server(PORT);

String addressOf(IPAddress ip) {
  String a = "http://" + ip.toString();
  if (PORT != 80) a += ":" + String(PORT);
  return a + "/";
}

void addSecurityHeaders() {
  server.sendHeader("Content-Security-Policy", "frame-ancestors 'self'");
  server.sendHeader("X-Content-Type-Options", "nosniff");
  server.sendHeader("Referrer-Policy", "no-referrer");
}

// GET / : the page, compressed. "Content-Encoding: gzip" tells the browser to decompress it.
void handlePage() {
  addSecurityHeaders();
  server.sendHeader("Cache-Control", "no-cache");
  server.sendHeader("Content-Encoding", "gzip");
  server.send_P(200, "text/html; charset=utf-8", (const char*)DATABRIEF_HTML_GZ, DATABRIEF_HTML_GZ_LEN);
}

// GET /healthz : "ok" if the board is running (handy for monitoring).
void handleHealth() {
  addSecurityHeaders();
  server.send(200, "text/plain", "ok\n");
}

void handleNotFound() {
  addSecurityHeaders();
  server.send(404, "text/plain", "Not found\n");
}

void startAccessPoint() {
  WiFi.mode(WIFI_AP);
  if (!WiFi.softAP(AP_NAME, AP_PASSWORD)) {
    Serial.println("Could not create the Wi-Fi network: is AP_PASSWORD at least 8 characters?");
    return;
  }
  Serial.printf("Wi-Fi network \"%s\" created. Join it, then open %s\n", AP_NAME, addressOf(WiFi.softAPIP()).c_str());
}

bool joinWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(HOSTNAME);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);
  Serial.printf("Joining \"%s\"", WIFI_NAME);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (FALLBACK_TO_ACCESS_POINT_AFTER_MS > 0 && millis() - start > FALLBACK_TO_ACCESS_POINT_AFTER_MS) {
      Serial.println(" failed.");
      return false;
    }
    delay(500);
    Serial.print(".");
  }
  Serial.printf(" connected.\nOpen %s or http://%s.local", addressOf(WiFi.localIP()).c_str(), HOSTNAME);
  Serial.println(PORT != 80 ? ":" + String(PORT) + "/" : "/");
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.printf("\nDataBrief on ESP32 - page %u bytes (gzip), SHA-256 of the page: %s\n",
                (unsigned)DATABRIEF_HTML_GZ_LEN, DATABRIEF_HTML_SHA256);

  if (NETWORK_MODE == OWN_ACCESS_POINT || !joinWifi()) startAccessPoint();

  if (MDNS.begin(HOSTNAME)) MDNS.addService("http", "tcp", PORT);

  server.on("/", HTTP_GET, handlePage);
  server.on("/databrief.html", HTTP_GET, handlePage);
  server.on("/healthz", HTTP_GET, handleHealth);
  server.onNotFound(handleNotFound);
  server.begin();
  Serial.printf("Web server listening on port %u\n", PORT);
}

void loop() {
  server.handleClient();
  delay(2);  // lets the Wi-Fi stack breathe
}
