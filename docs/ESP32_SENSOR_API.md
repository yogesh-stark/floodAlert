# StreetFlood Alert — IoT Sensor Ingestion API & ESP32 Reference

## 1. Sensor Telemetry Ingestion Endpoint

**Endpoint:** `POST /api/sensors/ingest`  
**Content-Type:** `application/json`

### Request Body
```json
{
  "sensorId": "esp32-anna-salai",
  "waterLevelCm": 84.5,
  "rainfallMmHr": 48.2,
  "batteryPct": 91
}
```

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `sensorId` | `string` | Yes (or `streetId`) | Registered node ID (e.g. `esp32-anna-salai`) |
| `streetId` | `string` | Optional | Street corridor slug (`anna-salai`) |
| `waterLevelCm` | `number` | Yes | Water depth inside storm drain (`0–400 cm`) |
| `rainfallMmHr` | `number` | Yes | Tipping-bucket rain intensity (`0–300 mm/hr`) |
| `batteryPct` | `number` | Optional | Solar/LiFePO4 battery state of charge (`0–100`) |

### Response (`201 Created`)
Returns the updated `street` risk evaluation (`waterPct`, `riskScore`, `riskLevel`, `trend`, `etaDangerMinutes`) and any newly triggered `alert` object, while simultaneously broadcasting `street:update` and `alert:triggered` events to all connected WebSocket clients (`/ws`).

---

## 2. Hardware Bill of Materials (Per Street Node)
- **MCU:** ESP32-S3 DevKit (Wi-Fi / LTE-M uplink)
- **Water Level:** JSN-SR04T waterproof ultrasonic transducer mounted at the top of the storm drain inspection pit (`DRAIN_MOUNT_HEIGHT_CM - airGapCm = waterLevelCm`)
- **Rain Gauge:** Standard 0.2 mm tipping-bucket optical/reed-switch gauge wired to GPIO interrupt pin

---

## 3. Sample ESP32 / Arduino Sketch

```cpp
#include <WiFi.h>
#include <HTTPClient.h>

const char* SSID = "YOUR_MUNICIPAL_WIFI";
const char* PASSWORD = "YOUR_WIFI_PASSWORD";
const char* API_URL = "https://YOUR_APP_HOST/api/sensors/ingest";
const char* SENSOR_ID = "esp32-anna-salai";
const float DRAIN_MOUNT_HEIGHT_CM = 150.0;

volatile unsigned int rainTips = 0;
void IRAM_ATTR onRainTip() { rainTips++; } // 0.2 mm per tip

float readUltrasonicDistanceCm() {
  digitalWrite(5, LOW); delayMicroseconds(2);
  digitalWrite(5, HIGH); delayMicroseconds(10);
  digitalWrite(5, LOW);
  long duration = pulseIn(18, HIGH, 30000);
  return (duration * 0.0343) / 2.0;
}

void setup() {
  Serial.begin(115200);
  pinMode(5, OUTPUT);
  pinMode(18, INPUT);
  attachInterrupt(digitalPinToInterrupt(19), onRainTip, FALLING);
  WiFi.begin(SSID, PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(500);
}

void loop() {
  float airGapCm = readUltrasonicDistanceCm();
  float waterLevelCm = max(0.0f, DRAIN_MOUNT_HEIGHT_CM - airGapCm);
  float rainfallMmHr = rainTips * 0.2 * 60.0;
  rainTips = 0;

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(API_URL);
    http.addHeader("Content-Type", "application/json");
    String json = "{\"sensorId\":\"" + String(SENSOR_ID) +
                  "\",\"waterLevelCm\":" + String(waterLevelCm, 1) +
                  ",\"rainfallMmHr\":" + String(rainfallMmHr, 1) +
                  ",\"batteryPct\":91}";
    int code = http.POST(json);
    Serial.printf("Ingest HTTP %d\n", code);
    http.end();
  }
  delay(60000);
}
```
