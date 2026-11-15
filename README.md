# StreetFlood Alert

**Hyper-local, street-level flood early warning system (Mobile-First PWA).**

Citywide weather alerts warn neighborhoods hours too late and fail to show which individual streets, subways, or storm drains are overflowing. **StreetFlood Alert** bridges that gap by combining curb-level ultrasonic drain depth sensors and tipping-bucket rain gauges with a real-time risk & rate-of-rise prediction engine—giving residents 20–45 minutes of actionable lead time, safe alternate routes, and bilingual (English + Tamil) warnings.

---

## How Street-Level Early Warnings Work

1. **Sensors (`ESP32 + JSN-SR04T + Rain Gauge`)**: Nodes transmit storm-drain water level (`cm`) and rainfall intensity (`mm/hr`) every 60 seconds to `POST /api/sensors/ingest`.
2. **Risk & ETA Prediction Engine (`src/lib/riskEngine.ts`)**: Combines drain fill percentage (`waterLevelCm / drainDepthCm`), rate of rise (`cm/min`), local rainfall intensity, and live Open-Meteo 3-hour precipitation forecasts to compute a `0–100` risk score (`Safe` → `Watch` → `Warning` → `Danger`) and estimated minutes until danger threshold is crossed.
3. **Real-Time Alerts & Safe Bypass**: WebSocket streams (`/ws`) update the Leaflet OpenStreetMap corridor colors immediately and trigger plain-language alerts in English and Tamil (`"Water rising on Anna Salai near Bus Stand. Expected to reach danger level in ~25 min. Avoid this street. Alternate route: ..."`), plus "All Clear" notices when drains recede.
4. **Community Verification & Shelters**: Residents/volunteers submit geotagged waterlogging photos (`unverified` until 3 peer confirmations or admin verification) and locate dry relief shelters/hospitals on elevated ground.

---

## Folder Structure

```
├── database/
│   └── schema.sql                 # PostgreSQL relational schema
├── docs/
│   └── ESP32_SENSOR_API.md        # IoT REST API docs & Arduino C++ sketch
├── public/                        # PWA icons & SVG emblem
├── server/
│   └── seedData.ts                # Chennai pilot streets, sensors, shelters, history
├── src/
│   ├── components/
│   │   ├── AdminDashboardView.tsx # Sensor health, thresholds, charts, ESP32 docs
│   │   ├── AlertsRoutesView.tsx   # Bilingual alert feed, subscriptions, safe routes
│   │   ├── CommunityReportView.tsx# Waterlogging photo reporting & verification
│   │   ├── HeroLandingSection.tsx # Value prop, search, geolocation, 4-step flow
│   │   ├── OfflineIndicator.tsx   # PWA offline banner
│   │   ├── PreparednessView.tsx   # Offline Before/During/After checklist & helplines
│   │   ├── PWAInstallButton.tsx   # In-app install prompt & iOS Safari guide
│   │   ├── RiskBadge.tsx          # Color-blind safe status icons + labels
│   │   ├── StreetInspector.tsx    # Telemetry card, Recharts trend, ETA & bypass
│   │   └── StreetMap.tsx          # Interactive Leaflet.js OpenStreetMap canvas
│   ├── hooks/
│   │   ├── useFloodSocket.ts      # WebSocket + REST + Firebase Auth/Firestore sync
│   │   ├── useOnlineStatus.ts
│   │   └── usePWAInstall.ts
│   ├── lib/
│   │   ├── assets.ts              # Generated documentary photo imports
│   │   ├── firebase.ts            # Firebase Auth + named Firestore DB setup
│   │   ├── i18n.ts                # English & Tamil translations
│   │   └── riskEngine.ts          # Rule-based risk score & ETA predictor
│   └── types/flood.ts
├── firebase-blueprint.json        # Firestore intermediate representation
├── firestore.rules                # Hardened Firestore security rules
├── server.ts                      # Express + WebSocket + Vite full-stack server
└── vite.config.ts                 # Vite + VitePWA service worker config
```

---

## Setup & Run Instructions

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Start full-stack dev server (Express + WebSockets + Vite on port 3000)**
   ```bash
   npm run dev
   ```
3. **Type-check & build for production**
   ```bash
   npm run lint
   npm run build
   npm start
   ```
4. **Try Demo Mode**
   - Click **Simulate Heavy Rain** in the top toolbar to run a 6-step monsoon surge via WebSockets—watch streets transition from **Safe (green)** → **Watch (yellow)** → **Warning (orange)** → **Danger (red)**, trigger bilingual alerts, and display dashed safe alternate routes on the map.
   - Click **Drain & Reset** to restore baseline levels and emit **All Clear** notices.
   - Switch to **Admin → IoT Sensor Ingestion API** and click **Send Live Test Ping** (or `POST /api/sensors/ingest` from an ESP32/curl) to test live telemetry ingestion.
